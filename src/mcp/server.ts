// SatLapse as an MCP server: the same engine as the web app (src/core),
// exposed as tools any MCP client (Claude Code, Claude Desktop, Cursor, …) can
// call. Node-only; it is never part of the browser bundle.
//
// Typical flow: search_place → create_area → sync_area → describe_project →
// list_events / get_scene_image → add_annotation / add_note → export_project.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { z } from 'zod'
import { ANALYSIS_INSTRUCTIONS, describeProject, type ProjectData } from '../ai/context'
import { eventLine, filterEvents, nearestScene, sceneAttribution, sensorText, statsCsv, VIEW_KIND, VIEW_LABEL } from '../ai/format'
import { IMAGE_VIEWS } from '../ai/tools'
import { LIMITS } from '../config/entitlements'
import { createArea, createInvestigation, newId, polygonCentroid, validatePolygon } from '../core/area'
import { findAcquisitions } from '../core/catalog'
import { syncArea, type SyncMode } from '../core/engine'
import { utmEpsgFor, type PolygonGeometry } from '../core/geo'
import { exportProjectFile, importProjectFile, PROJECT_EXT } from '../core/project'
import { historyStart } from '../core/sampling'
import type { ImageEncoder } from '../core/storage'
import type { Area, Investigation } from '../core/types'
import { geocoder } from '../geocode'
import type { DiskStore } from './store'

export interface ServerOptions {
  /** Largest area an agent may create, km². Defaults to the free-tier limit. */
  maxAreaKm2?: number
  version?: string
}

/** Same encoding as scripts/sync-node.ts: WebP photos, palette PNG overlays. */
export const sharpEncoder: ImageEncoder = {
  async encode(rgba, width, height, kind) {
    const img = sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } })
    const buf = kind === 'overlay' ? await img.png({ compressionLevel: 9, palette: true }).toBuffer() : await img.webp({ quality: 82, alphaQuality: 90 }).toBuffer()
    return new Blob([new Uint8Array(buf)], { type: kind === 'overlay' ? 'image/png' : 'image/webp' })
  },
}

const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] })
const fail = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }], isError: true })
const r1 = (n: number) => Math.round(n * 10) / 10
type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const bbox = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .describe('[minLon, minLat, maxLon, maxLat] in WGS84 degrees')

const bboxPolygon = ([x0, y0, x1, y1]: number[]): PolygonGeometry => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] })

export function createServer(store: DiskStore, opts: ServerOptions = {}): McpServer {
  const { storage } = store
  const maxAreaKm2 = opts.maxAreaKm2 ?? LIMITS.free.maxAreaKm2
  const running = new Set<string>()
  const server = new McpServer(
    { name: 'satlapse', version: opts.version ?? '0.1.0' },
    {
      instructions: `${ANALYSIS_INSTRUCTIONS}

Workflow: find a place (search_place), create an area of up to ${maxAreaKm2} km² (create_area), download and process its history (sync_area; this can take minutes for long histories), then read describe_project for the summary and use list_events, get_stats and get_scene_image to dig in. Record findings with add_annotation and add_note. Projects are saved as .satlapse files that open in the SatLapse web app (https://satlapse.ashtonwilliamallen.com).`,
    },
  )

  async function areaOf(id: string): Promise<Area> {
    const a = await storage.getArea(id) ?? (await storage.listAreas()).find((x) => x.name === id)
    if (!a) throw new Error(`Unknown area "${id}". Call list_projects to see area ids.`)
    return a
  }
  async function projectData(projectId: string): Promise<ProjectData> {
    const project = await storage.getInvestigation(projectId) ?? (await storage.listInvestigations()).find((p) => p.name === projectId)
    if (!project) throw new Error(`Unknown project "${projectId}". Call list_projects to see project ids.`)
    const areas = (await storage.listAreas()).filter((a) => a.investigationId === project.id)
    return {
      project,
      areas: await Promise.all(areas.map(async (area) => ({ area, scenes: await storage.listScenes(area.id), events: await storage.listEvents(area.id) }))),
      annotations: await storage.listAnnotations(project.id),
    }
  }
  /** Runs a handler, turning thrown errors into tool errors the model can read. */
  const safe = <A>(fn: (args: A, extra: Extra) => Promise<CallToolResult>) => async (args: A, extra: Extra): Promise<CallToolResult> => {
    try {
      return await fn(args, extra)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  }

  server.registerTool('search_place', {
    title: 'Search for a place',
    description: 'Find a place by name (OpenStreetMap via Photon). Returns centre points and bounding boxes to use with create_area or find_imagery.',
    inputSchema: { query: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ query }) => {
    const places = await geocoder.search(query)
    if (!places.length) return text('No places found.')
    return text(places.map((p) => `- ${p.name}${p.detail ? ` (${p.detail})` : ''}: centre ${p.center[1].toFixed(5)}, ${p.center[0].toFixed(5)}${p.bbox ? `; bbox [${p.bbox.map((v) => v.toFixed(5)).join(', ')}]` : ''}`).join('\n')
      + `\n\n${geocoder.attribution}`)
  }))

  server.registerTool('find_imagery', {
    title: 'Find available imagery',
    description: 'Quick catalogue search (no downloads): which Sentinel-2 acquisitions exist over a bounding box in a date range, with scene-level cloud cover. Scene-level cloud is only a hint; sync_area measures cloud over the exact area.',
    inputSchema: {
      bbox,
      from: date.optional().describe('Default: one year ago'),
      to: date.optional().describe('Default: today'),
      max_scene_cloud_pct: z.number().min(0).max(100).optional().describe('Default 100'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ bbox: b, from, to, max_scene_cloud_pct }, extra) => {
    const aoi = bboxPolygon(b)
    const start = from ?? historyStart('1y').slice(0, 10)
    const res = await findAcquisitions({
      aoi, epsg: utmEpsgFor(polygonCentroid(aoi)), datetime: `${start}T00:00:00Z/${to ? `${to}T23:59:59Z` : '..'}`,
      maxSceneCloudPct: max_scene_cloud_pct, signal: extra.signal,
    })
    const rows = res.acquisitions.map((a) => `${a.date} | ${a.items.length} tile(s) | scene cloud ${a.sceneCloudPct == null ? '?' : `${r1(a.sceneCloudPct)}%`}`)
    const shown = rows.length > 200 ? [...rows.slice(0, 100), `… ${rows.length - 200} more …`, ...rows.slice(-100)] : rows
    return text(`${res.acquisitions.length} acquisitions from ${start} to ${to ?? 'today'}.\n${shown.join('\n')}${res.warnings.length ? `\nWarnings: ${res.warnings.join('; ')}` : ''}`)
  }))

  server.registerTool('list_projects', {
    title: 'List projects and areas',
    description: 'Every saved project with its areas, their size, processed history and sync state.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => {
    const projects = await storage.listInvestigations()
    if (!projects.length) return text('No projects yet. Use create_area to start one.')
    const areas = await storage.listAreas()
    const lines: string[] = []
    for (const p of projects) {
      lines.push(`Project "${p.name}" (id: ${p.id})`)
      for (const a of areas.filter((x) => x.investigationId === p.id)) {
        const done = (await storage.listScenes(a.id)).filter((s) => s.status === 'processed' && s.sensor !== 'naip')
        const events = await storage.listEvents(a.id)
        lines.push(`  - Area "${a.name}" (id: ${a.id}): ${r1(a.areaKm2)} km², history ${a.settings.historyDepth}, sampling ${a.settings.sampling}; `
          + (done.length ? `${done.length} scenes ${done[0].date} to ${done.at(-1)!.date}, ${events.length} flagged changes` : 'not synced yet')
          + (a.sync.lastCheckedAt ? `; last checked ${a.sync.lastCheckedAt.slice(0, 10)}` : ''))
      }
    }
    return text(lines.join('\n'))
  }))

  server.registerTool('create_area', {
    title: 'Create an area',
    description: `Create an area to monitor from a bounding box or polygon (max ${maxAreaKm2} km²). Adds it to an existing project, or creates a new project. Does not download anything; call sync_area next.`,
    inputSchema: {
      name: z.string().min(1),
      bbox: bbox.optional(),
      polygon: z.array(z.tuple([z.number(), z.number()])).min(3).optional().describe('Ring of [lon, lat] points; closed automatically'),
      project_id: z.string().optional().describe('Existing project id or name'),
      project_name: z.string().optional().describe('Name for a new project (default: the area name)'),
      history_depth: z.enum(['1y', '3y', 'all', 'landsat']).optional().describe('1y, 3y (default), all (Sentinel-2 since 2015) or landsat (back to 1984)'),
      sampling: z.enum(['all', 'month', 'quarter']).optional().describe('Every clear scene, or the clearest per month (default) or quarter'),
      max_cloud_pct: z.number().min(0).max(100).optional().describe('Max cloud over the area for a usable scene (default 20)'),
    },
  }, safe(async (i) => {
    if (!i.bbox === !i.polygon) return fail('Give exactly one of bbox or polygon.')
    let geometry: PolygonGeometry
    if (i.bbox) geometry = bboxPolygon(i.bbox)
    else {
      const ring = i.polygon!.map(([x, y]) => [x, y] as [number, number])
      const [f, l] = [ring[0], ring.at(-1)!]
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]])
      geometry = { type: 'Polygon', coordinates: [ring] }
    }
    const v = validatePolygon(geometry, maxAreaKm2)
    if (!v.ok) return fail(v.reason)
    let project: Investigation | undefined
    if (i.project_id) project = (await projectData(i.project_id)).project
    else {
      project = createInvestigation(i.project_name ?? i.name)
      await storage.putInvestigation(project)
    }
    const area = createArea(i.name, geometry, { historyDepth: i.history_depth ?? '3y', sampling: i.sampling ?? 'month', maxCloudPct: i.max_cloud_pct ?? 20 }, project.id)
    await storage.putArea(area)
    await store.save(project.id)
    return text(`Created area "${area.name}" (id: ${area.id}) in project "${project.name}" (id: ${project.id}): ${r1(area.areaKm2)} km², ${area.grid.res} m grid. Call sync_area to download its imagery.`)
  }))

  server.registerTool('sync_area', {
    title: 'Download and process imagery',
    description: 'Search the catalogues, screen clouds over the area, download and process clear scenes, and detect changes. The first run backfills the full history (minutes for long histories); later runs only fetch new scenes. Reports progress while it runs.',
    inputSchema: {
      area_id: z.string(),
      mode: z.enum(['backfill', 'track']).optional().describe('Default: backfill if never synced, otherwise track (new scenes only)'),
      skip_aerial: z.boolean().optional().describe('Skip high-res NAIP aerial photos (US only); faster'),
    },
    annotations: { openWorldHint: true },
  }, safe(async ({ area_id, mode, skip_aerial }, extra) => {
    const area = await areaOf(area_id)
    if (area.example) return fail('The bundled example area is read-only.')
    if (running.has(area.id)) return fail('This area is already syncing.')
    running.add(area.id)
    try {
      const before = new Set((await storage.listEvents(area.id)).map((e) => e.id))
      const synced = (await storage.listScenes(area.id)).some((s) => s.status === 'processed')
      const token = extra._meta?.progressToken
      let step = 0
      const res = await syncArea(area.id, storage, sharpEncoder, {
        mode: mode ?? (synced ? 'track' : 'backfill') as SyncMode,
        skipAerial: skip_aerial,
        signal: extra.signal,
        onProgress: (p) => {
          if (token === undefined) return
          void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: ++step, message: `[${p.phase}] ${p.message}` } }).catch(() => {})
        },
      })
      await store.save(area.investigationId)
      const fresh = (await storage.listEvents(area.id)).filter((e) => !before.has(e.id))
      return text([
        `Synced "${area.name}": ${res.found} new acquisitions found, ${res.processed} processed, ${res.rejected} rejected (cloud, coverage or read errors), ${res.skipped} skipped (a clearer scene was chosen).`,
        fresh.length ? `New flagged changes:\n${fresh.map((e) => eventLine(e, area.name)).join('\n')}` : 'No new flagged changes.',
        res.warnings.length ? `Warnings: ${res.warnings.join('; ')}` : '',
        'Use describe_project for the full picture.',
      ].filter(Boolean).join('\n'))
    } finally {
      running.delete(area.id)
    }
  }))

  server.registerTool('describe_project', {
    title: 'Describe a project',
    description: 'The full analysis context for a project: areas, land-cover time series, flagged changes with confidence, annotations and notes. Start here before analysing.',
    inputSchema: { project_id: z.string().describe('Project id or name') },
    annotations: { readOnlyHint: true },
  }, safe(async ({ project_id }) => text(describeProject(await projectData(project_id)))))

  server.registerTool('get_stats', {
    title: 'Land-cover time series',
    description: 'Vegetation, water and built/bare as % of clear pixels, plus cloud %, per processed scene of one area (CSV).',
    inputSchema: { area_id: z.string(), from: date.optional(), to: date.optional() },
    annotations: { readOnlyHint: true },
  }, safe(async (i) => {
    const area = await areaOf(i.area_id)
    return text(statsCsv(await storage.listScenes(area.id), i) ?? 'No processed scenes in that range.')
  }))

  server.registerTool('list_events', {
    title: 'List flagged changes',
    description: 'Flagged changes, including low-confidence ones, with full descriptions. Filter by area, kind, date range or confidence.',
    inputSchema: {
      area_id: z.string().optional(),
      kind: z.enum(['veg_loss', 'veg_gain', 'water_gain', 'water_loss', 'built_gain']).optional(),
      from: date.optional(), to: date.optional(),
      min_confidence: z.enum(['low', 'medium', 'high']).optional(),
    },
    annotations: { readOnlyHint: true },
  }, safe(async (i) => {
    const areas = i.area_id ? [await areaOf(i.area_id)] : await storage.listAreas()
    const lines: string[] = []
    for (const a of areas) lines.push(...filterEvents(await storage.listEvents(a.id), i).map((e) => eventLine(e, a.name)))
    return text(lines.length ? lines.join('\n') : 'No matching events.')
  }))

  server.registerTool('get_scene_image', {
    title: 'Get a scene image',
    description: 'One processed image of an area for the scene nearest to `date`. Views: true_color, vegetation (NDVI), water (NDWI), built (NDBI), change_since_previous, change_since_first (overlays: red veg loss, green veg gain, blue new water, amber water lost, magenta new built/bare). aerial=true gives NAIP high-res photos (US only; true_color or vegetation). North is up.',
    inputSchema: {
      area_id: z.string(),
      date,
      view: z.enum(IMAGE_VIEWS).optional(),
      aerial: z.boolean().optional(),
      max_size: z.number().int().min(128).max(2048).optional().describe('Longest side in pixels (default 1024)'),
    },
    annotations: { readOnlyHint: true },
  }, safe(async (i) => {
    const area = await areaOf(i.area_id)
    const view = i.view ?? 'true_color'
    if (i.aerial && view !== 'true_color' && view !== 'vegetation') return fail('Aerial images are only available as true_color or vegetation.')
    const pool = (await storage.listScenes(area.id)).filter((s) => s.status === 'processed' && (i.aerial ? s.sensor === 'naip' : s.sensor !== 'naip'))
    const s = nearestScene(pool, i.date)
    if (!s) return fail(i.aerial ? 'No aerial imagery for this area (NAIP covers the contiguous US only).' : 'No processed scenes for this area. Run sync_area first.')
    const blob = await storage.getImage(s.id, VIEW_KIND[view])
    if (!blob) return fail(`No ${VIEW_LABEL[view]} image stored for ${s.date}${view.startsWith('change') ? ' (the first scene has no change overlay)' : ''}.`)
    const size = i.max_size ?? 1024
    const jpg = await sharp(Buffer.from(await blob.arrayBuffer())).flatten({ background: '#0b0c0e' })
      .resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
    return {
      content: [
        { type: 'text', text: `${area.name}: ${VIEW_LABEL[view]}, ${s.date} (${sensorText(s)}). Image covers the area plus surrounding context. ${sceneAttribution(s)}.` },
        { type: 'image', mimeType: 'image/jpeg', data: jpg.toString('base64') },
      ],
    }
  }))

  server.registerTool('list_annotations', {
    title: 'List annotations',
    description: 'Annotations (place, date, text) in a project.',
    inputSchema: { project_id: z.string() },
    annotations: { readOnlyHint: true },
  }, safe(async ({ project_id }) => {
    const { annotations } = await projectData(project_id)
    return text(annotations.length ? annotations.map((a) => `${a.date} at ${a.lngLat[1].toFixed(5)},${a.lngLat[0].toFixed(5)} (${a.author}): ${a.text}`).join('\n') : 'No annotations yet.')
  }))

  server.registerTool('add_annotation', {
    title: 'Add an annotation',
    description: 'Pin an observation to a place and scene date, e.g. "New structure appears here". Saved to the project and marked as AI-authored.',
    inputSchema: { area_id: z.string(), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), date, text: z.string().min(1) },
  }, safe(async (i) => {
    const area = await areaOf(i.area_id)
    const scene = nearestScene((await storage.listScenes(area.id)).filter((s) => s.status === 'processed'), i.date)
    await storage.putAnnotation({
      id: newId(), investigationId: area.investigationId, areaId: area.id, lngLat: [i.lon, i.lat], date: i.date,
      sceneId: scene?.date === i.date ? scene.id : undefined, text: i.text, author: 'ai', createdAt: new Date().toISOString(),
    })
    await store.save(area.investigationId)
    return text(`Annotation added to "${area.name}" for ${i.date}.`)
  }))

  server.registerTool('add_note', {
    title: 'Append to project notes',
    description: "Append a Markdown section to a project's notes (shown in the app and included in reports). Cite scene dates and sensors for every finding.",
    inputSchema: { project_id: z.string(), title: z.string().min(1), markdown: z.string().min(1) },
  }, safe(async (i) => {
    const { project } = await projectData(i.project_id)
    const notes = `${project.notes.trim()}\n\n## ${i.title}\n\n${i.markdown.trim()}\n`.trimStart()
    await storage.putInvestigation({ ...project, notes, updatedAt: new Date().toISOString() })
    await store.save(project.id)
    return text(`Added "${i.title}" to the notes of "${project.name}".`)
  }))

  server.registerTool('export_project', {
    title: 'Export a project file',
    description: `Write a project to a ${PROJECT_EXT} file. Open it in the SatLapse web app ("Open project file") to replay, compare and export GIF/MP4 or reports.`,
    inputSchema: { project_id: z.string(), path: z.string().describe(`Output file path ending in ${PROJECT_EXT}`) },
  }, safe(async ({ project_id, path }) => {
    if (!path.endsWith(PROJECT_EXT)) return fail(`The path must end in ${PROJECT_EXT}.`)
    const { project } = await projectData(project_id)
    const bytes = await exportProjectFile(storage, project.id)
    writeFileSync(path, bytes)
    return text(`Wrote ${path} (${(bytes.length / 1e6).toFixed(1)} MB).`)
  }))

  server.registerTool('import_project', {
    title: 'Import a project file',
    description: `Load a ${PROJECT_EXT} file exported from the web app (or by export_project) so its areas can be analysed and tracked here.`,
    inputSchema: { path: z.string() },
  }, safe(async ({ path }) => {
    const project = await importProjectFile(storage, new Uint8Array(readFileSync(path)))
    await store.save(project.id)
    const areas = (await storage.listAreas()).filter((a) => a.investigationId === project.id)
    return text(`Imported "${project.name}" (id: ${project.id}) with ${areas.length} area(s): ${areas.map((a) => `${a.name} (${a.id})`).join(', ')}.`)
  }))

  return server
}
