// Tools the model can call. Read-only tools return data; draft_* tools never
// write anything: they create pending drafts the user must approve.
import type { Part, ToolDef } from './types'

export const IMAGE_VIEWS = ['true_color', 'vegetation', 'water', 'built', 'change_since_previous', 'change_since_first'] as const
export type ImageView = (typeof IMAGE_VIEWS)[number]

export const TOOLS: ToolDef[] = [
  {
    name: 'get_stats',
    description: 'Land-cover time series (vegetation, water, built/bare as % of clear pixels, plus cloud %) for one area, optionally limited to a date range. Use for precise numbers beyond the summary table.',
    parameters: { type: 'object', additionalProperties: false, required: ['area_id'], properties: {
      area_id: { type: 'string' },
      from: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
      to: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
    } },
  },
  {
    name: 'list_events',
    description: 'Flagged changes, including low-confidence ones, with full descriptions. Filter by area, kind or date range.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      area_id: { type: 'string' },
      kind: { type: 'string', enum: ['veg_loss', 'veg_gain', 'water_gain', 'water_loss', 'built_gain'] },
      from: { type: 'string' }, to: { type: 'string' },
      min_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    } },
  },
  {
    name: 'get_scene_image',
    description: 'Fetch one processed image of an area for the date nearest to `date`. Views: true_color, vegetation (NDVI), water (NDWI), built (NDBI), change_since_previous, change_since_first (change overlays: red veg loss, green veg gain, blue new water, amber water lost, magenta new built/bare). Set aerial=true for NAIP high-res aerial photos (US only, true_color or vegetation). Request only the images you need.',
    parameters: { type: 'object', additionalProperties: false, required: ['area_id', 'date'], properties: {
      area_id: { type: 'string' },
      date: { type: 'string', description: 'YYYY-MM-DD; the nearest available scene is used' },
      view: { type: 'string', enum: [...IMAGE_VIEWS] },
      aerial: { type: 'boolean' },
    } },
  },
  {
    name: 'list_annotations',
    description: "The researcher's annotations (place, date, text).",
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'draft_annotation',
    description: 'Propose an annotation pinned to a location and scene date. It is NOT saved: the user reviews and approves or discards it.',
    parameters: { type: 'object', additionalProperties: false, required: ['area_id', 'lat', 'lon', 'date', 'text'], properties: {
      area_id: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' },
      date: { type: 'string', description: 'Scene date (YYYY-MM-DD) the observation refers to' },
      text: { type: 'string', description: 'Short observation, e.g. "New structure appears here"' },
    } },
  },
  {
    name: 'draft_report_section',
    description: "Propose a Markdown section for the project's notes/report. It is NOT saved until the user approves it. Cite scene dates and sensors for every finding.",
    parameters: { type: 'object', additionalProperties: false, required: ['title', 'markdown'], properties: {
      title: { type: 'string' }, markdown: { type: 'string' },
    } },
  },
]

/** Minimal schema check (types, required, enums). Model output is untrusted. */
export function validateInput(name: string, input: Record<string, unknown>): string | null {
  const def = TOOLS.find((t) => t.name === name)
  if (!def) return `Unknown tool ${name}`
  if ('__invalid_json' in input) return 'Arguments were not valid JSON'
  const props = def.parameters.properties as Record<string, { type: string; enum?: string[] }>
  for (const r of def.parameters.required ?? []) if (input[r] === undefined || input[r] === '') return `Missing required argument "${r}"`
  for (const [k, v] of Object.entries(input)) {
    const p = props[k]
    if (!p) return `Unexpected argument "${k}"`
    if (p.type === 'string' && typeof v !== 'string') return `"${k}" must be a string`
    if (p.type === 'number' && typeof v !== 'number') return `"${k}" must be a number`
    if (p.type === 'boolean' && typeof v !== 'boolean') return `"${k}" must be a boolean`
    if (p.enum && !p.enum.includes(v as string)) return `"${k}" must be one of ${p.enum.join(', ')}`
    if ((k === 'date' || k === 'from' || k === 'to') && !/^\d{4}-\d{2}-\d{2}$/.test(v as string)) return `"${k}" must be YYYY-MM-DD`
  }
  if (name === 'draft_annotation') {
    const lat = input.lat as number, lon = input.lon as number
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'lat/lon out of range'
  }
  return null
}

export type DraftKind = 'annotation' | 'report'
export interface Draft {
  id: string
  kind: DraftKind
  title: string
  body: string
  /** For annotations. */
  areaId?: string
  lngLat?: [number, number]
  date?: string
  status: 'pending' | 'approved' | 'discarded'
}

/** Implemented by the app: answers tool calls from local data. */
export interface ToolHost {
  run(name: string, input: Record<string, unknown>): Promise<Part[]>
}
