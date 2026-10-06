// IndexedDB implementation of the Storage interface. Usable from the main
// thread and from workers. Keys are prefixed with the area id so an area's
// data can be range-deleted.
import type { Storage } from '../core/storage'
import { SCHEMA_VERSION, type Area, type ChangeEvent, type ImageKind, type IndexRaster, type SceneRecord } from '../core/types'

const DB_NAME = 'satlapse'
const DB_VERSION = 1
const STORES = ['areas', 'scenes', 'images', 'rasters', 'events'] as const
type StoreName = (typeof STORES)[number]

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

let dbPromise: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION)
    r.onupgradeneeded = () => {
      const db = r.result
      if (!db.objectStoreNames.contains('areas')) db.createObjectStore('areas', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('scenes')) db.createObjectStore('scenes', { keyPath: 'id' }).createIndex('areaId', 'areaId')
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images')
      if (!db.objectStoreNames.contains('rasters')) db.createObjectStore('rasters', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'areaId' })
    }
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close()
        dbPromise = null
      }
      resolve(r.result)
    }
    r.onerror = () => reject(r.error)
    r.onblocked = () => reject(new Error('Database upgrade blocked by another open tab'))
  })
  return dbPromise
}

async function tx(stores: StoreName | StoreName[], mode: IDBTransactionMode) {
  return (await open()).transaction(stores, mode)
}

const prefix = (id: string) => IDBKeyRange.bound(`${id}|`, `${id}|￿`)

/** Upgrade records written by older schema versions. */
function migrateArea(a: Area): Area {
  if (a.schemaVersion === SCHEMA_VERSION) return a
  // v1 is the first schema; future migrations go here.
  return { ...a, schemaVersion: SCHEMA_VERSION }
}

export class IdbStorage implements Storage {
  async listAreas() {
    const t = await tx('areas', 'readonly')
    return ((await req(t.objectStore('areas').getAll())) as Area[]).map(migrateArea)
  }
  async getArea(id: string) {
    const t = await tx('areas', 'readonly')
    const a = (await req(t.objectStore('areas').get(id))) as Area | undefined
    return a && migrateArea(a)
  }
  async putArea(area: Area) {
    const t = await tx('areas', 'readwrite')
    t.objectStore('areas').put(area)
    await done(t)
  }
  async deleteArea(id: string) {
    const t = await tx([...STORES], 'readwrite')
    t.objectStore('areas').delete(id)
    t.objectStore('scenes').delete(prefix(id))
    t.objectStore('images').delete(prefix(id))
    t.objectStore('rasters').delete(prefix(id))
    t.objectStore('events').delete(id)
    await done(t)
  }
  async listScenes(areaId: string) {
    const t = await tx('scenes', 'readonly')
    const all = (await req(t.objectStore('scenes').index('areaId').getAll(areaId))) as SceneRecord[]
    return all.sort((a, b) => a.date.localeCompare(b.date))
  }
  async putScenes(scenes: SceneRecord[]) {
    if (!scenes.length) return
    const t = await tx('scenes', 'readwrite')
    const s = t.objectStore('scenes')
    for (const sc of scenes) s.put(sc)
    await done(t)
  }
  async putImage(sceneId: string, kind: ImageKind, blob: Blob) {
    const t = await tx('images', 'readwrite')
    t.objectStore('images').put(blob, `${sceneId}|${kind}`)
    await done(t)
  }
  async getImage(sceneId: string, kind: ImageKind) {
    const t = await tx('images', 'readonly')
    return (await req(t.objectStore('images').get(`${sceneId}|${kind}`))) as Blob | undefined
  }
  async putRaster(r: IndexRaster) {
    const t = await tx('rasters', 'readwrite')
    t.objectStore('rasters').put(r)
    await done(t)
  }
  async getRaster(key: string) {
    const t = await tx('rasters', 'readonly')
    return (await req(t.objectStore('rasters').get(key))) as IndexRaster | undefined
  }
  async listEvents(areaId: string) {
    const t = await tx('events', 'readonly')
    const row = (await req(t.objectStore('events').get(areaId))) as { areaId: string; events: ChangeEvent[] } | undefined
    return row?.events ?? []
  }
  async replaceEvents(areaId: string, events: ChangeEvent[]) {
    const t = await tx('events', 'readwrite')
    t.objectStore('events').put({ areaId, events })
    await done(t)
  }
}

export const storage = new IdbStorage()
