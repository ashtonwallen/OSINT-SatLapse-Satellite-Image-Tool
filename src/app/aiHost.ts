// Connects the AI layer to local project data: loads everything the model
// may see, answers tool calls, and builds the "Copy to AI" image bundle.
import { strToU8, zipSync } from 'fflate'
import { copernicusAttribution } from '../core/attribution'
import { copyPrompt, type ProjectData } from '../ai/context'
import type { Draft, ImageView, ToolHost } from '../ai/tools'
import type { Part } from '../ai/types'
import { newId } from '../core/area'
import type { ImageKind, SceneRecord } from '../core/types'
import { storage } from '../storage/idb'

export async function loadProjectData(projectId: string): Promise<ProjectData> {
  const project = await storage.getInvestigation(projectId)
  if (!project) throw new Error('Project not found')
  const areas = (await storage.listAreas()).filter((a) => a.investigationId === projectId)
  return {
    project,
    areas: await Promise.all(areas.map(async (area) => ({ area, scenes: await storage.listScenes(area.id), events: await storage.listEvents(area.id) }))),
    annotations: await storage.listAnnotations(projectId),
  }
}

const VIEW_KIND: Record<ImageView, ImageKind> = {
  true_color: 'tc', vegetation: 'ndvi', water: 'ndwi', built: 'ndbi', change_since_previous: 'chgPrev', change_since_first: 'chgBase',
}
const VIEW_LABEL: Record<ImageView, string> = {
  true_color: 'true colour', vegetation: 'vegetation (NDVI)', water: 'water (NDWI)', built: 'built/bare (NDBI)',
  change_since_previous: 'change since previous scene', change_since_first: 'change since first scene',
}

const sensorText = (s: SceneRecord) => s.sensor === 'naip' ? `NAIP aerial ${s.gsd} m` : s.sensor === 'landsat' ? 'Landsat 30 m' : 'Sentinel-2 10 m'
const attribution = (s: SceneRecord) => s.sensor === 'naip' ? 'NAIP imagery: USDA (public domain)' : s.sensor === 'landsat' ? 'Landsat imagery courtesy of the U.S. Geological Survey' : copernicusAttribution(Number(s.date.slice(0, 4)))

function nearest(scenes: SceneRecord[], date: string): SceneRecord | undefined {
  const t = Date.parse(date)
  return scenes.reduce<SceneRecord | undefined>((best, s) => (!best || Math.abs(Date.parse(s.date) - t) < Math.abs(Date.parse(best.date) - t) ? s : best), undefined)
}

/** Downscale to ≤maxDim on a dark background, optionally with a burned-in label bar. */
async function encode(blob: Blob, maxDim: number, label?: string, credit?: string): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s)
  const bar = label ? 40 : 0
  const c = new OffscreenCanvas(w, h + bar)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#0b0c0e'
  ctx.fillRect(0, 0, w, h + bar)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  if (label) {
    ctx.fillStyle = '#e7e7ea'
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.fillText(label, 8, h + 17, w - 16)
    ctx.fillStyle = '#9b9ba3'
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillText(credit ?? '', 8, h + 33, w - 16)
  }
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
}

async function toBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function createToolHost(data: ProjectData, onDraft: (d: Draft) => void): ToolHost {
  const areaOf = (id: unknown) => {
    const a = data.areas.find((x) => x.area.id === id || x.area.name === id)
    if (!a) throw new Error(`Unknown area_id "${String(id)}". Valid ids: ${data.areas.map((x) => `${x.area.id} (${x.area.name})`).join(', ')}`)
    return a
  }
  const inRange = (d: string, i: Record<string, unknown>) => (!i.from || d >= String(i.from)) && (!i.to || d <= String(i.to))
  const text = (t: string): Part[] => [{ type: 'text', text: t }]

  return {
    async run(name, input) {
      switch (name) {
        case 'get_stats': {
          const a = areaOf(input.area_id)
          const rows = a.scenes.filter((s) => s.status === 'processed' && s.stats && inRange(s.date, input))
          if (!rows.length) return text('No processed scenes in that range.')
          return text(['date,sensor,vegetation_pct,water_pct,built_pct,cloud_pct',
            ...rows.map((s) => `${s.date},${s.sensor ?? 'sentinel-2'},${s.stats!.vegPct.toFixed(1)},${s.stats!.waterPct.toFixed(1)},${s.stats!.builtPct.toFixed(1)},${s.cloudPct.toFixed(1)}`)].join('\n'))
        }
        case 'list_events': {
          const rank = { low: 0, medium: 1, high: 2 }
          const min = rank[(input.min_confidence as keyof typeof rank) ?? 'low']
          const ev = data.areas.filter((x) => !input.area_id || x.area.id === input.area_id).flatMap((x) => x.events)
            .filter((e) => (!input.kind || e.kind === input.kind) && inRange(e.date, input) && rank[e.confidence ?? 'low'] >= min)
          return text(ev.length ? ev.map((e) => `${e.date} [${e.confidence}, ${e.method}] (${areaOf(e.areaId).area.name}) ${e.title}: ${e.description}`).join('\n') : 'No matching events.')
        }
        case 'list_annotations':
          return text(data.annotations.length ? data.annotations.map((a) => `${a.date} at ${a.lngLat[1].toFixed(5)},${a.lngLat[0].toFixed(5)}: ${a.text}`).join('\n') : 'No annotations yet.')
        case 'get_scene_image': {
          const a = areaOf(input.area_id)
          const aerial = input.aerial === true
          const view = (input.view as ImageView | undefined) ?? 'true_color'
          if (aerial && view !== 'true_color' && view !== 'vegetation') throw new Error('Aerial images are only available as true_color or vegetation.')
          const pool = a.scenes.filter((s) => s.status === 'processed' && (aerial ? s.sensor === 'naip' : s.sensor !== 'naip'))
          const s = nearest(pool, String(input.date))
          if (!s) throw new Error(aerial ? 'No aerial imagery for this area (NAIP covers the contiguous US only).' : 'No processed scenes for this area.')
          const blob = await storage.getImage(s.id, VIEW_KIND[view])
          if (!blob) throw new Error(`No ${VIEW_LABEL[view]} image stored for ${s.date}${view.startsWith('change') ? ' (the first scene has no change overlay)' : ''}.`)
          const caption = `${a.area.name}: ${VIEW_LABEL[view]}, ${s.date} (${sensorText(s)}). North is up; image covers the area plus surrounding context.`
          const jpg = await encode(blob, 1024)
          return [{ type: 'text', text: caption }, { type: 'image', mediaType: 'image/jpeg', data: await toBase64(jpg), caption }]
        }
        case 'draft_annotation': {
          const a = areaOf(input.area_id)
          onDraft({ id: newId(), kind: 'annotation', status: 'pending', title: `Annotation for ${a.area.name}, ${input.date}`, body: String(input.text),
            areaId: a.area.id, lngLat: [Number(input.lon), Number(input.lat)], date: String(input.date) })
          return text('Draft created. It will only be saved if the user approves it.')
        }
        case 'draft_report_section':
          onDraft({ id: newId(), kind: 'report', status: 'pending', title: String(input.title), body: String(input.markdown) })
          return text('Draft section created. It will only be added to the notes if the user approves it.')
        default:
          throw new Error(`Unknown tool ${name}`)
      }
    },
  }
}

/** Images worth attaching for models without tool use: baseline, latest and
 *  the dates of the largest confident changes (3–6 total). */
export function keyScenes(data: ProjectData, max = 6): { area: string; scene: SceneRecord; why: string }[] {
  const out: { area: string; scene: SceneRecord; why: string }[] = []
  for (const { area, scenes, events } of data.areas) {
    const opt = scenes.filter((s) => s.status === 'processed' && s.stats)
    if (!opt.length) continue
    out.push({ area: area.name, scene: opt[0], why: 'baseline (first clear scene)' })
    if (opt.length > 1) out.push({ area: area.name, scene: opt.at(-1)!, why: 'latest' })
    const big = [...events].filter((e) => e.confidence !== 'low').sort((a, b) => b.severity - a.severity)
    for (const e of big) {
      const s = opt.find((x) => x.id === e.sceneId)
      if (s && !out.some((o) => o.scene.id === s.id)) out.push({ area: area.name, scene: s, why: `${e.title} (${e.confidence})` })
      if (out.length >= max) break
    }
  }
  return out.slice(0, Math.max(3, max))
}

export async function buildBundle(data: ProjectData): Promise<Blob> {
  const files: Record<string, Uint8Array> = {}
  const picks = keyScenes(data)
  const lines: string[] = []
  for (const [i, p] of picks.entries()) {
    const blob = await storage.getImage(p.scene.id, 'tc')
    if (!blob) continue
    const name = `${String(i + 1).padStart(2, '0')}_${p.scene.date}_${p.area.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.jpg`
    const labelled = await encode(blob, 1600, `${p.area} · ${p.scene.date} · ${sensorText(p.scene)} · ${p.why}`, attribution(p.scene))
    files[`images/${name}`] = new Uint8Array(await labelled.arrayBuffer())
    lines.push(`- images/${name}: ${p.area}, ${p.scene.date}, ${sensorText(p.scene)}, ${p.why}`)
  }
  const prompt = `${copyPrompt(data)}\n\n## Attached images\n${lines.join('\n')}\n`
  files['prompt.md'] = strToU8(prompt)
  files['README.txt'] = strToU8('Upload prompt.md (or paste its text) and the images in images/ to your AI chat of choice.\nAttribution is burned into each image.\n')
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}
