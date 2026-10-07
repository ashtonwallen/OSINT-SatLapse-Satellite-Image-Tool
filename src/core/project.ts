// Single-file project export/import: a zip with manifest.json, the processed
// images, and the baseline/latest index rasters (so tracking can continue
// after import). Pure data in, bytes out: works in browser and Node.
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import { newId } from './area'
import { rasterKey, type Storage } from './storage'
import { IMAGE_KINDS, SCHEMA_VERSION, sceneId, type Area, type ChangeEvent, type ImageKind, type IndexRaster, type SceneRecord } from './types'

export const PROJECT_FORMAT = 'satlapse-project'
export const PROJECT_EXT = '.satlapse'

interface Manifest {
  format: typeof PROJECT_FORMAT
  schemaVersion: number
  exportedAt: string
  area: Area
  scenes: SceneRecord[]
  events: ChangeEvent[]
  rasters: { which: 'baseline' | 'latest'; sceneId: string; date: string; length: number }[]
  images: { sceneId: string; kind: ImageKind; path: string }[]
}

const extFor = (b: Blob) => (b.type === 'image/png' ? 'png' : b.type === 'image/jpeg' ? 'jpg' : 'webp')
const typeFor = (path: string) => (path.endsWith('.png') ? 'image/png' : path.endsWith('.jpg') ? 'image/jpeg' : 'image/webp')

export async function exportProject(storage: Storage, areaId: string): Promise<Uint8Array> {
  const area = await storage.getArea(areaId)
  if (!area) throw new Error('Area not found')
  const scenes = await storage.listScenes(areaId)
  const events = await storage.listEvents(areaId)
  const files: Record<string, Uint8Array> = {}
  const images: Manifest['images'] = []
  for (const s of scenes.filter((x) => x.status === 'processed')) {
    for (const kind of IMAGE_KINDS) {
      const blob = await storage.getImage(s.id, kind)
      if (!blob) continue
      const path = `images/${s.date}_${kind}.${extFor(blob)}`
      files[path] = new Uint8Array(await blob.arrayBuffer())
      images.push({ sceneId: s.id, kind, path })
    }
  }
  const rasters: Manifest['rasters'] = []
  for (const which of ['baseline', 'latest'] as const) {
    const r = await storage.getRaster(rasterKey(areaId, which))
    if (!r) continue
    const n = r.ndvi.length
    const buf = new Uint8Array(n * 3)
    buf.set(new Uint8Array(r.ndvi.buffer, r.ndvi.byteOffset, n), 0)
    buf.set(new Uint8Array(r.ndwi.buffer, r.ndwi.byteOffset, n), n)
    buf.set(new Uint8Array(r.ndbi.buffer, r.ndbi.byteOffset, n), 2 * n)
    files[`rasters/${which}.bin`] = buf
    rasters.push({ which, sceneId: r.sceneId, date: r.date, length: n })
  }
  const manifest: Manifest = {
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    area: { ...area, sync: { ...area.sync, status: 'idle', unseen: 0 } },
    scenes,
    events,
    rasters,
    images,
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 1))
  // Images are already compressed; only compress the JSON and rasters.
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: k.startsWith('images/') ? 0 : 6 }]])))
}

export interface ImportOptions {
  /** Mark as the bundled example (read-only, not tracked). */
  example?: boolean
  /** Keep the stored id instead of minting a new one. */
  keepId?: boolean
  /** Investigation to import the area into (v1 files have none). */
  investigationId?: string
}

export async function importProject(storage: Storage, bytes: Uint8Array, opts: ImportOptions = {}): Promise<Area> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new Error('This file is not a SatLapse project (not a zip archive).')
  }
  if (!files['manifest.json']) throw new Error('This file is not a SatLapse project (no manifest).')
  const m = JSON.parse(strFromU8(files['manifest.json'])) as Manifest
  if (m.format !== PROJECT_FORMAT) throw new Error('This file is not a SatLapse project.')
  if (m.schemaVersion > SCHEMA_VERSION) throw new Error('This project was made by a newer version of SatLapse. Please update.')

  const oldId = m.area.id
  const id = opts.keepId ? oldId : newId()
  const remap = (sid: string) => sceneId(id, sid.slice(oldId.length + 1))
  const area: Area = {
    ...m.area,
    id,
    schemaVersion: SCHEMA_VERSION,
    investigationId: opts.investigationId ?? m.area.investigationId ?? '',
    example: opts.example || undefined,
    sync: { ...m.area.sync, status: 'idle', unseen: 0 },
    updatedAt: new Date().toISOString(),
  }
  await storage.deleteArea(id)
  await storage.putArea(area)
  await storage.putScenes(m.scenes.map((s) => ({ ...s, id: remap(s.id), areaId: id })))
  await storage.replaceEvents(id, m.events.map((e) => ({ ...e, id: `${remap(e.sceneId)}|${e.kind}`, areaId: id, sceneId: remap(e.sceneId) })))
  for (const img of m.images) {
    const data = files[img.path]
    if (data) await storage.putImage(remap(img.sceneId), img.kind, new Blob([data as Uint8Array<ArrayBuffer>], { type: typeFor(img.path) }))
  }
  for (const r of m.rasters) {
    const buf = files[`rasters/${r.which}.bin`]
    if (!buf) continue
    const n = r.length
    const slice = (k: number) => new Int8Array(buf.slice(k * n, (k + 1) * n).buffer)
    const raster: IndexRaster = { key: rasterKey(id, r.which), areaId: id, sceneId: remap(r.sceneId), date: r.date, ndvi: slice(0), ndwi: slice(1), ndbi: slice(2) }
    await storage.putRaster(raster)
  }
  return area
}
