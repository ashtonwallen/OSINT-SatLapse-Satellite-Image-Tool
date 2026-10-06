// Persistence interface. IndexedDB (src/storage/idb.ts) is the only browser
// implementation today; a server could implement the same interface over a
// database + object store without touching the engine.
import type { Area, ChangeEvent, ImageKind, IndexRaster, SceneRecord } from './types'

export interface Storage {
  listAreas(): Promise<Area[]>
  getArea(id: string): Promise<Area | undefined>
  putArea(area: Area): Promise<void>
  /** Deletes the area and everything derived from it. */
  deleteArea(id: string): Promise<void>

  listScenes(areaId: string): Promise<SceneRecord[]>
  putScenes(scenes: SceneRecord[]): Promise<void>

  putImage(sceneId: string, kind: ImageKind, blob: Blob): Promise<void>
  getImage(sceneId: string, kind: ImageKind): Promise<Blob | undefined>

  putRaster(raster: IndexRaster): Promise<void>
  getRaster(key: string): Promise<IndexRaster | undefined>

  listEvents(areaId: string): Promise<ChangeEvent[]>
  /** Replaces all events for the area. */
  replaceEvents(areaId: string, events: ChangeEvent[]): Promise<void>
}

/** Encodes raw RGBA into a compact image. The browser uses OffscreenCanvas;
 *  Node scripts use sharp. */
export interface ImageEncoder {
  encode(rgba: Uint8ClampedArray, width: number, height: number, kind: 'photo' | 'overlay'): Promise<Blob>
}

export const rasterKey = (areaId: string, which: 'baseline' | 'latest') => `${areaId}|${which}`

/** In-memory Storage, used by tests and the Node example generator. */
export class MemoryStorage implements Storage {
  areas = new Map<string, Area>()
  scenes = new Map<string, SceneRecord>()
  images = new Map<string, Blob>()
  rasters = new Map<string, IndexRaster>()
  events = new Map<string, ChangeEvent[]>()
  async listAreas() { return [...this.areas.values()] }
  async getArea(id: string) { return this.areas.get(id) }
  async putArea(a: Area) { this.areas.set(a.id, structuredClone(a)) }
  async deleteArea(id: string) {
    this.areas.delete(id)
    for (const k of this.scenes.keys()) if (k.startsWith(`${id}|`)) this.scenes.delete(k)
    for (const k of this.images.keys()) if (k.startsWith(`${id}|`)) this.images.delete(k)
    for (const k of this.rasters.keys()) if (k.startsWith(`${id}|`)) this.rasters.delete(k)
    this.events.delete(id)
  }
  async listScenes(areaId: string) { return [...this.scenes.values()].filter((s) => s.areaId === areaId).sort((a, b) => a.date.localeCompare(b.date)) }
  async putScenes(ss: SceneRecord[]) { for (const s of ss) this.scenes.set(s.id, structuredClone(s)) }
  async putImage(sceneId: string, kind: ImageKind, blob: Blob) { this.images.set(`${sceneId}|${kind}`, blob) }
  async getImage(sceneId: string, kind: ImageKind) { return this.images.get(`${sceneId}|${kind}`) }
  async putRaster(r: IndexRaster) { this.rasters.set(r.key, r) }
  async getRaster(key: string) { return this.rasters.get(key) }
  async listEvents(areaId: string) { return this.events.get(areaId) ?? [] }
  async replaceEvents(areaId: string, ev: ChangeEvent[]) { this.events.set(areaId, ev) }
}
