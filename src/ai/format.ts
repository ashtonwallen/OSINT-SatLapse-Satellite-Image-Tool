// Pure formatting shared by every tool host (the in-app AI panel and the MCP
// server), so models see the same data whichever way they connect.
import { copernicusAttribution } from '../core/attribution'
import type { ChangeEvent, ImageKind, SceneRecord } from '../core/types'
import type { ImageView } from './tools'

export const VIEW_KIND: Record<ImageView, ImageKind> = {
  true_color: 'tc', vegetation: 'ndvi', water: 'ndwi', built: 'ndbi', change_since_previous: 'chgPrev', change_since_first: 'chgBase',
}
export const VIEW_LABEL: Record<ImageView, string> = {
  true_color: 'true colour', vegetation: 'vegetation (NDVI)', water: 'water (NDWI)', built: 'built/bare (NDBI)',
  change_since_previous: 'change since previous scene', change_since_first: 'change since first scene',
}

export const sensorText = (s: SceneRecord) => s.sensor === 'naip' ? `NAIP aerial ${s.gsd} m` : s.sensor === 'landsat' ? 'Landsat 30 m' : 'Sentinel-2 10 m'
export const sceneAttribution = (s: SceneRecord) => s.sensor === 'naip' ? 'NAIP imagery: USDA (public domain)' : s.sensor === 'landsat' ? 'Landsat imagery courtesy of the U.S. Geological Survey' : copernicusAttribution(Number(s.date.slice(0, 4)))

export function nearestScene(scenes: SceneRecord[], date: string): SceneRecord | undefined {
  const t = Date.parse(date)
  return scenes.reduce<SceneRecord | undefined>((best, s) => (!best || Math.abs(Date.parse(s.date) - t) < Math.abs(Date.parse(best.date) - t) ? s : best), undefined)
}

export interface DateRange { from?: unknown; to?: unknown }
export const inRange = (d: string, r: DateRange) => (!r.from || d >= String(r.from)) && (!r.to || d <= String(r.to))

/** Land-cover time series as CSV, or null when nothing matches. */
export function statsCsv(scenes: SceneRecord[], range: DateRange): string | null {
  const rows = scenes.filter((s) => s.status === 'processed' && s.stats && inRange(s.date, range))
  if (!rows.length) return null
  return ['date,sensor,vegetation_pct,water_pct,built_pct,cloud_pct',
    ...rows.map((s) => `${s.date},${s.sensor ?? 'sentinel-2'},${s.stats!.vegPct.toFixed(1)},${s.stats!.waterPct.toFixed(1)},${s.stats!.builtPct.toFixed(1)},${s.cloudPct.toFixed(1)}`)].join('\n')
}

const RANK = { low: 0, medium: 1, high: 2 }
export interface EventFilter extends DateRange { kind?: unknown; min_confidence?: unknown }

export function filterEvents(events: ChangeEvent[], f: EventFilter): ChangeEvent[] {
  const min = RANK[(f.min_confidence as keyof typeof RANK) ?? 'low']
  return events.filter((e) => (!f.kind || e.kind === f.kind) && inRange(e.date, f) && RANK[e.confidence ?? 'low'] >= min)
}

export const eventLine = (e: ChangeEvent, areaName: string) => `${e.date} [${e.confidence}, ${e.method}] (${areaName}) ${e.title}: ${e.description}`
