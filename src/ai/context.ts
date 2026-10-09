// Builds the analysis context for a project: metadata, compact time series,
// flagged events, annotations and notes. Used both for "Copy to AI" (pasted
// into any chat) and as the system context for connected providers. Images
// are never embedded here; models request them through tools.
import type { Annotation, Area, ChangeEvent, Investigation, SceneRecord } from '../core/types'
import { polygonCentroid } from '../core/area'
import { hazyScenes } from '../core/detect'

export interface ProjectData {
  project: Investigation
  areas: { area: Area; scenes: SceneRecord[]; events: ChangeEvent[] }[]
  annotations: Annotation[]
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** Downsample a long series to at most `max` rows, always keeping first/last
 *  and every flagged date. */
function thin<T extends { date: string }>(rows: T[], max: number, keep: Set<string>): T[] {
  if (rows.length <= max) return rows
  const step = rows.length / max
  const out = new Map<string, T>()
  for (let i = 0; i < max; i++) { const r = rows[Math.floor(i * step)]; out.set(r.date, r) }
  for (const r of rows) if (keep.has(r.date)) out.set(r.date, r)
  out.set(rows[0].date, rows[0])
  out.set(rows[rows.length - 1].date, rows[rows.length - 1])
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const sensorName = (s: SceneRecord) => s.sensor === 'landsat' ? 'Landsat (30 m)' : s.sensor === 'naip' ? 'NAIP aerial' : 'Sentinel-2 (10 m)'

export function describeProject(d: ProjectData, opts: { maxRowsPerArea?: number } = {}): string {
  const lines: string[] = []
  lines.push(`# Project: ${d.project.name}`)
  lines.push(`Areas: ${d.areas.length}. Annotations: ${d.annotations.length}. Generated ${new Date().toISOString().slice(0, 10)}.`)
  for (const { area, scenes, events } of d.areas) {
    const optical = scenes.filter((s) => s.status === 'processed' && s.stats)
    const aerial = scenes.filter((s) => s.status === 'processed' && s.sensor === 'naip')
    const [lng, lat] = polygonCentroid(area.geometry)
    lines.push('')
    lines.push(`## Area "${area.name}" (id: ${area.id})`)
    lines.push(`- Centre ${lat.toFixed(5)}, ${lng.toFixed(5)}; ${r1(area.areaKm2)} km²; analysis grid ${area.grid.res} m.`)
    if (optical.length) {
      const sensors = [...new Set(optical.map(sensorName))].join(', ')
      lines.push(`- ${optical.length} clear satellite scenes from ${optical[0].date} to ${optical.at(-1)!.date} (${sensors}); sampling: ${area.settings.sampling === 'all' ? 'every clear scene' : `clearest per ${area.settings.sampling}`}.`)
    }
    if (aerial.length) lines.push(`- High-res aerial (NAIP) years: ${aerial.map((s) => `${s.date} (${s.gsd} m)`).join(', ')}.`)
    const hazy = hazyScenes(optical)
    const keep = new Set(events.map((e) => e.date))
    const rows = thin(optical, opts.maxRowsPerArea ?? 60, keep)
    if (rows.length) {
      lines.push('')
      lines.push('Land cover over time (% of clear pixels; "built" includes bare soil):')
      lines.push('date | sensor | vegetation | water | built | cloud% | note')
      for (const s of rows) lines.push(`${s.date} | ${s.sensor === 'landsat' ? 'L' : 'S2'} | ${r1(s.stats!.vegPct)} | ${r1(s.stats!.waterPct)} | ${r1(s.stats!.builtPct)} | ${r1(s.cloudPct)} | ${hazy.has(s.id) ? 'possible smoke/haze; values unreliable' : ''}`)
      if (rows.length < optical.length) lines.push(`(${optical.length - rows.length} more rows omitted; use the get_stats tool for full detail.)`)
    }
    const conf = events.filter((e) => e.confidence !== 'low')
    lines.push('')
    lines.push(`Flagged changes: ${conf.length} high/medium confidence${events.length > conf.length ? `, ${events.length - conf.length} low confidence (use list_events to see them)` : ''}.`)
    for (const e of conf) lines.push(`- ${e.date} [${e.confidence}, ${e.method}] ${e.title}: ${e.description}`)
  }
  if (d.annotations.length) {
    lines.push('')
    lines.push('## User annotations')
    for (const a of d.annotations) {
      const area = d.areas.find((x) => x.area.id === a.areaId)?.area.name
      lines.push(`- ${a.date}${area ? ` (${area})` : ''} at ${a.lngLat[1].toFixed(5)}, ${a.lngLat[0].toFixed(5)}: ${a.text}`)
    }
  }
  if (d.project.notes.trim()) {
    lines.push('')
    lines.push('## Researcher notes')
    lines.push(d.project.notes.trim())
  }
  return lines.join('\n')
}

export const ANALYSIS_INSTRUCTIONS = `You are assisting with open-source satellite imagery research using SatLapse.
The data comes from Sentinel-2 (10 m) and, where present, Landsat (30 m) surface reflectance and NAIP aerial photos (0.3–1 m, US only).
Land-cover shares are threshold classifications from spectral indices (NDVI, NDWI, NDBI) over clear pixels; "built" also captures bare soil, and seasonal cycles (crops, snow, reservoir levels) are normal.
Flagged changes are compared against the same season in earlier years where possible; their confidence levels explain how solid each is.

When you analyse:
- Distinguish what the data shows from what you infer. Cite the scene dates (and sensor) behind every claim.
- Consider seasonal and benign explanations before concluding something unusual happened.
- State the resolution limits: at 10 m, individual buildings and vehicles are not resolvable.
- Be concise and structured. Say clearly when the evidence is insufficient.`

export const STARTER_PROMPTS = [
  'What changed here in the last year?',
  'When did construction start, if any?',
  'Summarise the biggest changes over the whole history.',
  'Which flagged changes are most likely real, and which are seasonal?',
  'Draft a short findings section for my report.',
]

export function copyPrompt(d: ProjectData): string {
  return `${ANALYSIS_INSTRUCTIONS}

Below is the data exported from my SatLapse project. Please analyse it and tell me what changed, when, and how confident we can be.${'\n'}
---
${describeProject(d)}
---

If I attach images, they are labelled with their date, sensor and view. Contains modified Copernicus Sentinel data; Landsat imagery courtesy of the U.S. Geological Survey; NAIP imagery from USDA where present.`
}
