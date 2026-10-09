// Seasonal-aware change detection.
//
// Pure and deterministic: input is plain scene records (with per-scene
// land-cover stats), output is plain ChangeEvent JSON. No browser APIs, so the
// same code can run in a server worker to power alerts.
//
// For each scene and each land-cover metric:
//   1. Seasonal reference: scenes from earlier years within ±SEASON_DAYS of the
//      same day-of-year. Each prior year contributes its median; the reference
//      is the median of those, and the spread is a robust MAD with a floor.
//   2. With ≥2 prior years, flag the scene when it departs from that seasonal
//      norm by at least MIN_PTS and ≥Z_MIN spreads. Only the onset of a
//      departure is flagged, not every scene while it persists.
//   3. The next scene confirms (persists) or contradicts (transient) the change.
//   4. Confidence: high = ≥3 reference years and confirmed; medium = 2 years,
//      or not yet confirmable; transient changes drop one level.
//   5. With <2 prior years, fall back to the pixel-level comparison with the
//      previous scene (vsPrev stats). These are always low confidence.
import type { ChangeEvent, Confidence, EventKind, LandCoverMetric, SceneRecord } from './types'

const DAY = 86400_000
export const SEASON_DAYS = 35
/** A prior scene must be at least this old to count as "an earlier year". */
const MIN_YEAR_GAP_DAYS = 300
/** Next scene must be within this many days to confirm or contradict. */
const CONFIRM_WITHIN_DAYS = 150
export const Z_MIN = 2.5

interface MetricRule {
  metric: LandCoverMetric
  label: string
  /** Minimum departure from the seasonal norm, in percentage points. */
  minPts: number
  /** Floor on the seasonal spread so near-constant series don't over-trigger. */
  spreadFloor: number
  up?: { kind: EventKind; title: string }
  down?: { kind: EventKind; title: string }
}

export const METRIC_RULES: MetricRule[] = [
  { metric: 'vegPct', label: 'Vegetation cover', minPts: 8, spreadFloor: 3,
    up: { kind: 'veg_gain', title: 'Unusual vegetation growth' }, down: { kind: 'veg_loss', title: 'Unusual vegetation loss' } },
  { metric: 'waterPct', label: 'Water extent', minPts: 2.5, spreadFloor: 1,
    up: { kind: 'water_gain', title: 'Unusually high water extent' }, down: { kind: 'water_loss', title: 'Unusually low water extent' } },
  { metric: 'builtPct', label: 'Built-up & bare ground', minPts: 4, spreadFloor: 2,
    up: { kind: 'built_gain', title: 'New built-up or bare ground' } },
]

// Previous-scene fallback thresholds (pixel-level, % of comparable area).
const PREV_RULES: { kind: EventKind; metric: LandCoverMetric; pick: (c: NonNullable<NonNullable<SceneRecord['stats']>['vsPrev']>) => number; minPct: number; title: string; verb: string }[] = [
  { kind: 'veg_loss', metric: 'vegPct', pick: (c) => c.vegLossPct, minPct: 8, title: 'Vegetation loss', verb: 'lost vegetation' },
  { kind: 'veg_gain', metric: 'vegPct', pick: (c) => c.vegGainPct, minPct: 12, title: 'Vegetation growth', verb: 'became newly vegetated' },
  { kind: 'water_gain', metric: 'waterPct', pick: (c) => c.waterGainPct, minPct: 3, title: 'Water extent increased', verb: 'became water' },
  { kind: 'water_loss', metric: 'waterPct', pick: (c) => c.waterLossPct, minPct: 3, title: 'Water extent decreased', verb: 'changed from water to land' },
  { kind: 'built_gain', metric: 'builtPct', pick: (c) => c.builtGainPct, minPct: 2, title: 'New built-up or bare ground', verb: 'turned into built-up or bare ground' },
]

const t = (d: string) => Date.parse(`${d}T00:00:00Z`)
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function dayOfYear(d: string): number {
  const x = new Date(`${d}T00:00:00Z`)
  return Math.floor((x.getTime() - Date.UTC(x.getUTCFullYear(), 0, 1)) / DAY)
}

export function seasonalDistance(a: string, b: string): number {
  const diff = Math.abs(dayOfYear(a) - dayOfYear(b))
  return Math.min(diff, 365 - diff)
}

export interface SeasonalReference {
  expected: number
  range: [number, number]
  spread: number
  years: number[]
  sceneIds: string[]
}

/** Seasonal norm for `scene` from strictly earlier years, or null if <2 years. */
export function seasonalReference(scenes: SceneRecord[], scene: SceneRecord, metric: LandCoverMetric, spreadFloor: number): SeasonalReference | null {
  const byYear = new Map<number, { vals: number[]; ids: string[] }>()
  for (const s of scenes) {
    if (!s.stats || s.id === scene.id) continue
    const gap = t(scene.date) - t(s.date)
    if (gap < MIN_YEAR_GAP_DAYS * DAY || seasonalDistance(s.date, scene.date) > SEASON_DAYS) continue
    const yearsBack = Math.round(gap / (365.25 * DAY))
    const y = new Date(t(scene.date)).getUTCFullYear() - yearsBack
    const g = byYear.get(y) ?? { vals: [], ids: [] }
    g.vals.push(s.stats[metric])
    g.ids.push(s.id)
    byYear.set(y, g)
  }
  if (byYear.size < 2) return null
  const yearVals = [...byYear.values()].map((g) => median(g.vals))
  const expected = median(yearVals)
  const mad = median(yearVals.map((v) => Math.abs(v - expected))) * 1.4826
  const spread = Math.max(mad, spreadFloor)
  return {
    expected,
    range: [Math.min(...yearVals), Math.max(...yearVals)],
    spread,
    years: [...byYear.keys()].sort(),
    sceneIds: [...byYear.values()].flatMap((g) => g.ids),
  }
}

type Direction = 1 | -1 | 0

function departure(scenes: SceneRecord[], s: SceneRecord, rule: MetricRule, minPtsScale = 1): { dir: Direction; ref: SeasonalReference | null; delta: number } {
  const ref = seasonalReference(scenes, s, rule.metric, rule.spreadFloor)
  if (!ref || !s.stats) return { dir: 0, ref, delta: 0 }
  const delta = s.stats[rule.metric] - ref.expected
  const big = Math.abs(delta) >= rule.minPts * minPtsScale && Math.abs(delta) / ref.spread >= Z_MIN * minPtsScale
  return { dir: big ? (delta > 0 ? 1 : -1) : 0, ref, delta }
}

const downgrade = (c: Confidence): Confidence => (c === 'high' ? 'medium' : 'low')

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export function seasonPhrase(d: string): string {
  const x = new Date(`${d}T00:00:00Z`)
  const day = x.getUTCDate()
  return `${day <= 10 ? 'early' : day <= 20 ? 'mid' : 'late'} ${MONTHS[x.getUTCMonth()]}`
}
export function fmtDay(d: string): string {
  const x = new Date(`${d}T00:00:00Z`)
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()].slice(0, 3)} ${x.getUTCFullYear()}`
}
const fmtKm2 = (km2: number) => (km2 < 0.1 ? `${Math.max(1, Math.round(km2 * 100))} ha` : `${km2 < 10 ? km2.toFixed(1) : Math.round(km2)} km²`)
const yearsText = (ys: number[]) => (ys.length > 3 ? `${ys[0]}–${ys[ys.length - 1]}` : ys.join(', '))

/**
 * Scenes that look hazy or smoky compared with this area's own history
 * (blue/red ratio far above its norm). Relative, so naturally grey surfaces
 * like cities don't trigger it. Hazy scenes stay in the timeline but are
 * excluded from flagged changes and from seasonal baselines.
 */
export function hazyScenes(scenes: SceneRecord[]): Set<string> {
  const vals = scenes.map((s) => s.stats?.haze).filter((v): v is number => typeof v === 'number')
  if (vals.length < 4) return new Set()
  const med = median(vals)
  const mad = median(vals.map((v) => Math.abs(v - med))) * 1.4826
  const cut = med + Math.max(0.15, 4 * mad)
  return new Set(scenes.filter((s) => typeof s.stats?.haze === 'number' && s.stats.haze > cut).map((s) => s.id))
}

export function detectEvents(areaId: string, areaKm2: number, allScenes: SceneRecord[]): ChangeEvent[] {
  const optical = allScenes.filter((s) => s.status === 'processed' && s.stats && s.sensor !== 'naip')
  const hazy = hazyScenes(optical)
  const scenes = optical.filter((s) => !hazy.has(s.id)).sort((a, b) => a.date.localeCompare(b.date))
  const events: ChangeEvent[] = []

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]
    const prev = scenes[i - 1]
    const next = scenes[i + 1] && t(scenes[i + 1].date) - t(s.date) <= CONFIRM_WITHIN_DAYS * DAY ? scenes[i + 1] : undefined
    const sources = s.sources.map((x) => ({ sourceId: x.sourceId, itemId: x.itemId }))
    const seasonalMetrics = new Set<LandCoverMetric>()

    for (const rule of METRIC_RULES) {
      const cur = departure(scenes, s, rule)
      if (!cur.ref) continue
      seasonalMetrics.add(rule.metric)
      if (cur.dir === 0) continue
      const side = cur.dir > 0 ? rule.up : rule.down
      if (!side) continue
      // Only the onset: skip if the previous scene already departed the same way.
      if (prev && departure(scenes, prev, rule).dir === cur.dir) continue

      let confidence: Confidence = cur.ref.years.length >= 3 ? 'high' : 'medium'
      let confirmation = ''
      let confirmedBy: string | undefined
      if (!next) {
        if (confidence === 'high') confidence = 'medium'
        confirmation = ' This is the latest usable image, so it is not yet confirmed by a later one.'
      } else {
        const nx = departure(scenes, next, rule, 0.5)
        if (nx.dir === cur.dir) {
          confirmedBy = next.id
          confirmation = ` The next image (${fmtDay(next.date)}) confirms it.`
        } else {
          confidence = downgrade(confidence)
          confirmation = ` The next image (${fmtDay(next.date)}) no longer shows it, so it may be temporary (for example flooding, harvest timing or a misclassified cloud shadow).`
        }
      }
      const observed = s.stats![rule.metric]
      const km2 = (Math.abs(cur.delta) / 100) * areaKm2
      events.push({
        id: `${s.id}|${side.kind}`,
        areaId,
        sceneId: s.id,
        date: s.date,
        previousDate: prev?.date ?? s.date,
        kind: side.kind,
        metric: rule.metric,
        method: 'seasonal',
        confidence,
        observed,
        expected: cur.ref.expected,
        expectedRange: cur.ref.range,
        reference: { years: cur.ref.years, sceneIds: cur.ref.sceneIds },
        confirmedBy,
        km2,
        severity: Math.min(1, Math.abs(cur.delta) / 30) * (confidence === 'high' ? 1 : confidence === 'medium' ? 0.7 : 0.4),
        sources,
        title: side.title,
        description:
          `${rule.label} was ${observed.toFixed(0)}% on ${fmtDay(s.date)}, versus a typical ${cur.ref.expected.toFixed(0)}% ` +
          `(range ${cur.ref.range[0].toFixed(0)}–${cur.ref.range[1].toFixed(0)}%) for ${seasonPhrase(s.date)} in ${yearsText(cur.ref.years)}. ` +
          `That is about ${fmtKm2(km2)} ${cur.delta < 0 ? 'less' : 'more'} than usual for this time of year.` + confirmation,
      })
    }

    // Fallback: not enough history for a seasonal comparison.
    const c = s.stats!.vsPrev
    if (!prev || !c || c.comparablePct < 50) continue
    const comparableKm2 = (areaKm2 * c.comparablePct) / 100
    for (const r of PREV_RULES) {
      if (seasonalMetrics.has(r.metric)) continue
      const pct = r.pick(c)
      const km2 = (pct / 100) * comparableKm2
      if (pct < r.minPct || km2 < 0.02) continue
      const gapDays = Math.round((t(s.date) - t(prev.date)) / DAY)
      events.push({
        id: `${s.id}|${r.kind}`,
        areaId,
        sceneId: s.id,
        date: s.date,
        previousDate: prev.date,
        kind: r.kind,
        metric: r.metric,
        method: 'previous',
        confidence: 'low',
        observed: s.stats![r.metric],
        expected: prev.stats![r.metric],
        reference: { years: [], sceneIds: [prev.id] },
        km2,
        severity: Math.min(1, pct / 30) * 0.4,
        sources,
        title: r.title,
        description:
          `About ${fmtKm2(km2)} (${pct.toFixed(1)}% of the clear area) ${r.verb} between ${fmtDay(prev.date)} and ${fmtDay(s.date)}` +
          (gapDays > 120 ? `, a ${Math.round(gapDays / 30)}-month gap between usable images.` : '.') +
          ' There is not yet enough history (two earlier years) to tell this apart from normal seasonal change, so treat it as low confidence.',
      })
    }
  }
  return events
}
