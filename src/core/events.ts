// Flag significant changes from the per-scene change statistics and write a
// short plain-language description for each. Works on stats only (no pixels),
// so it is cheap to recompute over the whole history after every sync.
import type { ChangeEvent, EventKind, SceneRecord } from './types'

interface Rule {
  kind: EventKind
  /** % of comparable pixels that changed in this way vs the previous scene. */
  pick: (s: NonNullable<NonNullable<SceneRecord['stats']>['vsPrev']>) => number
  /** Minimum % of the area for an event. */
  minPct: number
  /** Minimum absolute area in km². */
  minKm2: number
  title: string
  verb: string
}

const RULES: Rule[] = [
  { kind: 'veg_loss', pick: (c) => c.vegLossPct, minPct: 6, minKm2: 0.05, title: 'Vegetation loss', verb: 'lost vegetation' },
  { kind: 'veg_gain', pick: (c) => c.vegGainPct, minPct: 10, minKm2: 0.05, title: 'Vegetation growth', verb: 'became newly vegetated' },
  { kind: 'water_gain', pick: (c) => c.waterGainPct, minPct: 2, minKm2: 0.02, title: 'Water extent increased', verb: 'became water' },
  { kind: 'water_loss', pick: (c) => c.waterLossPct, minPct: 2, minKm2: 0.02, title: 'Water extent decreased', verb: 'changed from water to land' },
  { kind: 'built_gain', pick: (c) => c.builtGainPct, minPct: 1.5, minKm2: 0.02, title: 'New built-up or bare ground', verb: 'turned into built-up or bare ground' },
]

const DAY = 86400_000

function fmtKm2(km2: number): string {
  if (km2 < 0.1) return `${Math.round(km2 * 100)} ha`
  return `${km2 < 10 ? km2.toFixed(1) : Math.round(km2)} km²`
}

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Day-of-year distance, wrapping around the year end. */
function seasonalDistance(a: string, b: string): number {
  const doy = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`)
    return Math.floor((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY)
  }
  const diff = Math.abs(doy(a) - doy(b))
  return Math.min(diff, 365 - diff)
}

export function detectEvents(areaId: string, areaKm2: number, scenes: SceneRecord[]): ChangeEvent[] {
  const processed = scenes.filter((s) => s.status === 'processed' && s.stats).sort((a, b) => a.date.localeCompare(b.date))
  const raw: (ChangeEvent & { pct: number })[] = []
  for (let i = 0; i < processed.length; i++) {
    const s = processed[i]
    const c = s.stats!.vsPrev
    if (!c || c.comparablePct < 50) continue
    const comparableKm2 = (areaKm2 * c.comparablePct) / 100
    for (const r of RULES) {
      const pct = r.pick(c)
      const km2 = (pct / 100) * comparableKm2
      if (pct < r.minPct || km2 < r.minKm2) continue
      raw.push({
        id: `${s.id}|${r.kind}`,
        areaId,
        sceneId: s.id,
        date: s.date,
        previousDate: c.comparedDate,
        kind: r.kind,
        km2,
        severity: Math.min(1, pct / 30),
        recurring: false,
        title: r.title,
        description: '',
        pct,
      })
    }
  }

  // An event is "recurring" if the same kind of change of similar size
  // happened within ~6 weeks of the same calendar date in another year:
  // harvests, seasonal flooding, snow-melt and dry seasons look like this.
  for (const e of raw) {
    e.recurring = raw.some(
      (o) => o !== e && o.kind === e.kind && o.date.slice(0, 4) !== e.date.slice(0, 4) &&
        seasonalDistance(o.date, e.date) <= 45 && o.pct >= e.pct * 0.5,
    )
    if (e.recurring) e.severity *= 0.5
    const rule = RULES.find((r) => r.kind === e.kind)!
    const gapDays = Math.round((Date.parse(e.date) - Date.parse(e.previousDate)) / DAY)
    e.description =
      `About ${fmtKm2(e.km2)} (${e.pct.toFixed(1)}% of the clear area) ${rule.verb} between ${fmtDate(e.previousDate)} and ${fmtDate(e.date)}` +
      (gapDays > 120 ? ` — a ${Math.round(gapDays / 30)}-month gap between usable images, so the change may have happened gradually.` : '.') +
      (e.recurring ? ' A similar change happened around this time in another year, so this is probably seasonal.' : '')
  }
  return raw.map(({ pct: _pct, ...e }) => e)
}
