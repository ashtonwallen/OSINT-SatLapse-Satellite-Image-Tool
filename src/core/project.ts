// Single-file project export/import (.satlapse): a zip with a manifest, every
// area's processed images and its baseline/latest index rasters (so tracking
// can continue after import), plus notes and annotations. Pure data in,
// bytes out: works in the browser and in Node.
//
// Format v2 (current): one project with N areas under areas/<n>/...
// Format v1 (legacy, single area at the root) is still importable.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { createInvestigation, newId } from './area'
import { rasterKey, type Storage } from './storage'
import { IMAGE_KINDS, SCHEMA_VERSION, sceneId, type Annotation, type Area, type ChangeEvent, type ImageKind, type IndexRaster, type Investigation, type SceneRecord } from './types'

export const PROJECT_FORMAT = 'satlapse-project'
export const PROJECT_EXT = '.satlapse'

interface AreaManifest {
  area: Area
  scenes: SceneRecord[]
  events: ChangeEvent[]
  rasters: { which: 'baseline' | 'latest'; sceneId: string; date: string; length: number; path: string }[]
  images: { sceneId: string; kind: ImageKind; path: string }[]
}

interface ManifestV2 {
  format: typeof PROJECT_FORMAT
  formatVersion: 2
  schemaVersion: number
  exportedAt: string
  project: Investigation
  annotations: Annotation[]
  areas: AreaManifest[]
}

/** v1 files: a single area at the root. */
interface ManifestV1 extends Omit<AreaManifest, 'rasters'> {
  format: typeof PROJECT_FORMAT
  schemaVersion: 1
  rasters: { which: 'baseline' | 'latest'; sceneId: string; date: string; length: number }[]
}

const extFor = (b: Blob) => (b.type === 'image/png' ? 'png' : b.type === 'image/jpeg' ? 'jpg' : 'webp')
const typeFor = (path: string) => (path.endsWith('.png') ? 'image/png' : path.endsWith('.jpg') ? 'image/jpeg' : 'image/webp')

async function exportArea(storage: Storage, area: Area, prefix: string, files: Record<string, Uint8Array>): Promise<AreaManifest> {
  const scenes = await storage.listScenes(area.id)
  const events = await storage.listEvents(area.id)
  const images: AreaManifest['images'] = []
  for (const s of scenes.filter((x) => x.status === 'processed')) {
    for (const kind of IMAGE_KINDS) {
      const blob = await storage.getImage(s.id, kind)
      if (!blob) continue
      const tag = s.sensor === 'naip' ? `${s.date}_naip` : s.date
      const path = `${prefix}images/${tag}_${kind}.${extFor(blob)}`
      files[path] = new Uint8Array(await blob.arrayBuffer())
      images.push({ sceneId: s.id, kind, path })
    }
  }
  const rasters: AreaManifest['rasters'] = []
  for (const which of ['baseline', 'latest'] as const) {
    const r = await storage.getRaster(rasterKey(area.id, which))
    if (!r) continue
    const n = r.ndvi.length
    const buf = new Uint8Array(n * 3)
    buf.set(new Uint8Array(r.ndvi.buffer, r.ndvi.byteOffset, n), 0)
    buf.set(new Uint8Array(r.ndwi.buffer, r.ndwi.byteOffset, n), n)
    buf.set(new Uint8Array(r.ndbi.buffer, r.ndbi.byteOffset, n), 2 * n)
    const path = `${prefix}rasters/${which}.bin`
    files[path] = buf
    rasters.push({ which, sceneId: r.sceneId, date: r.date, length: n, path })
  }
  return { area: { ...area, sync: { ...area.sync, status: 'idle', unseen: 0 } }, scenes, events, rasters, images }
}

export async function exportProjectFile(storage: Storage, projectId: string): Promise<Uint8Array> {
  const project = await storage.getInvestigation(projectId)
  if (!project) throw new Error('Project not found')
  const areas = (await storage.listAreas()).filter((a) => a.investigationId === projectId)
  const files: Record<string, Uint8Array> = {}
  const manifest: ManifestV2 = {
    format: PROJECT_FORMAT,
    formatVersion: 2,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    project,
    annotations: await storage.listAnnotations(projectId),
    areas: [],
  }
  for (const [i, a] of areas.entries()) manifest.areas.push(await exportArea(storage, a, `areas/${i}/`, files))
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 1))
  // Images are already compressed; only compress JSON and rasters.
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: k.includes('/images/') ? 0 : 6 }]])))
}

async function importArea(storage: Storage, m: Omit<AreaManifest, 'rasters'> & { rasters: (AreaManifest['rasters'][number] | ManifestV1['rasters'][number])[] }, files: Record<string, Uint8Array>, projectId: string, opts: ImportOptions): Promise<Area> {
  const oldId = m.area.id
  const id = opts.keepIds ? oldId : newId()
  const remap = (sid: string) => sceneId(id, sid.slice(oldId.length + 1))
  const area: Area = {
    ...m.area,
    id,
    investigationId: projectId,
    schemaVersion: SCHEMA_VERSION,
    example: opts.example || undefined,
    sync: { ...m.area.sync, status: 'idle', unseen: 0 },
    updatedAt: new Date().toISOString(),
  }
  await storage.deleteArea(id)
  await storage.putArea(area)
  await storage.putScenes(m.scenes.map((s) => ({ ...s, id: remap(s.id), areaId: id })))
  await storage.replaceEvents(id, m.events.map((e) => ({ ...e, id: `${remap(e.sceneId)}|${e.kind}`, areaId: id, sceneId: remap(e.sceneId), confirmedBy: e.confirmedBy && remap(e.confirmedBy) })))
  for (const img of m.images) {
    const data = files[img.path]
    if (data) await storage.putImage(remap(img.sceneId), img.kind, new Blob([data as Uint8Array<ArrayBuffer>], { type: typeFor(img.path) }))
  }
  for (const r of m.rasters) {
    const buf = files['path' in r ? r.path : `rasters/${r.which}.bin`]
    if (!buf) continue
    const n = r.length
    const slice = (k: number) => new Int8Array(buf.slice(k * n, (k + 1) * n).buffer)
    const raster: IndexRaster = { key: rasterKey(id, r.which), areaId: id, sceneId: remap(r.sceneId), date: r.date, ndvi: slice(0), ndwi: slice(1), ndbi: slice(2) }
    await storage.putRaster(raster)
  }
  return area
}

export interface ImportOptions {
  /** Mark as the bundled example (read-only, not tracked). */
  example?: boolean
  /** Keep stored ids instead of minting new ones (bundled example). */
  keepIds?: boolean
}

export async function importProjectFile(storage: Storage, bytes: Uint8Array, opts: ImportOptions = {}): Promise<Investigation> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new Error('This file is not a SatLapse project (not a zip archive).')
  }
  if (!files['manifest.json']) throw new Error('This file is not a SatLapse project (no manifest).')
  const raw = JSON.parse(strFromU8(files['manifest.json'])) as ManifestV2 | ManifestV1
  if (raw.format !== PROJECT_FORMAT) throw new Error('This file is not a SatLapse project.')
  if (raw.schemaVersion > SCHEMA_VERSION) throw new Error('This project was made by a newer version of SatLapse. Please update.')

  if ('formatVersion' in raw && raw.formatVersion === 2) {
    const now = new Date().toISOString()
    const project: Investigation = opts.keepIds
      ? { ...raw.project, schemaVersion: SCHEMA_VERSION, updatedAt: now }
      : { ...raw.project, id: newId(), schemaVersion: SCHEMA_VERSION, name: raw.project.name, updatedAt: now }
    if (opts.keepIds) await storage.deleteInvestigation(project.id)
    await storage.putInvestigation(project)
    const areaIds = new Map<string, string>()
    for (const am of raw.areas) {
      const a = await importArea(storage, am, files, project.id, opts)
      areaIds.set(am.area.id, a.id)
    }
    for (const an of raw.annotations) {
      const areaId = an.areaId && areaIds.get(an.areaId)
      const sid = an.sceneId && areaId && an.areaId ? sceneId(areaId, an.sceneId.slice(an.areaId.length + 1)) : undefined
      await storage.putAnnotation({ ...an, id: opts.keepIds ? an.id : newId(), investigationId: project.id, areaId: areaId || undefined, sceneId: sid })
    }
    return project
  }

  // v1: wrap the single area in a new project.
  const v1 = raw as ManifestV1
  const project = createInvestigation(v1.area.name)
  await storage.putInvestigation(project)
  await importArea(storage, v1, files, project.id, opts)
  return project
}
