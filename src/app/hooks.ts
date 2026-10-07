import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyncProgress } from '../core/engine'
import type { Annotation, Area, ChangeEvent, ImageKind, Investigation, SceneRecord } from '../core/types'
import { storage } from '../storage/idb'
import { localChanges } from './actions'
import { engine } from './engineClient'

/** Re-run `load` whenever the engine reports activity (debounced). */
function useEngineRefresh(filter: (areaId: string) => boolean, load: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filterRef = useRef(filter)
  filterRef.current = filter
  useEffect(
    () =>
      engine.subscribe((e) => {
        if (e.type === 'progress' || !filterRef.current(e.areaId)) return
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(load, 250)
      }),
    [load],
  )
}

export function useAreas() {
  const [areas, setAreas] = useState<Area[] | null>(null)
  const load = useCallback(() => {
    void storage.listAreas().then((a) => setAreas(a.sort((x, y) => y.createdAt.localeCompare(x.createdAt))))
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    localChanges.addEventListener('change', load)
    return () => localChanges.removeEventListener('change', load)
  }, [load])
  useEngineRefresh(() => true, load)
  return { areas, reload: load }
}

export function useAreaData(areaId: string | null) {
  const [scenes, setScenes] = useState<SceneRecord[]>([])
  const [events, setEvents] = useState<ChangeEvent[]>([])
  const load = useCallback(() => {
    if (!areaId) return
    void storage.listScenes(areaId).then(setScenes)
    void storage.listEvents(areaId).then(setEvents)
  }, [areaId])
  useEffect(() => {
    setScenes([])
    setEvents([])
    load()
  }, [load])
  useEngineRefresh((id) => id === areaId, load)
  return { scenes, events, reload: load }
}

export function useProgress(areaId: string | null): SyncProgress | null {
  const [p, setP] = useState<SyncProgress | null>(areaId ? engine.progress.get(areaId) ?? null : null)
  useEffect(() => {
    setP(areaId ? engine.progress.get(areaId) ?? null : null)
    return engine.subscribe((e) => {
      if (e.areaId !== areaId) return
      if (e.type === 'progress') setP(e.progress)
      if (e.type === 'finished' || e.type === 'failed') setP(null)
    })
  }, [areaId])
  return p
}

/** Object URLs for stored images, cached and revoked when the cache is dropped. */
export class ImageUrlCache {
  private urls = new Map<string, Promise<string | null>>()
  get(sceneId: string, kind: ImageKind): Promise<string | null> {
    const key = `${sceneId}|${kind}`
    let p = this.urls.get(key)
    if (!p) {
      p = storage.getImage(sceneId, kind).then((b) => (b ? URL.createObjectURL(b) : null))
      this.urls.set(key, p)
    }
    return p
  }
  clear() {
    for (const p of this.urls.values()) void p.then((u) => u && URL.revokeObjectURL(u))
    this.urls.clear()
  }
}

export function useImageCache(areaId: string | null): ImageUrlCache {
  const cache = useRef(new ImageUrlCache())
  useEffect(() => {
    const c = cache.current
    return () => c.clear()
  }, [areaId])
  return cache.current
}

/** Re-run `load` after UI-side writes. */
function useLocalRefresh(load: () => void) {
  useEffect(() => {
    localChanges.addEventListener('change', load)
    return () => localChanges.removeEventListener('change', load)
  }, [load])
}

export function useInvestigations() {
  const [items, setItems] = useState<Investigation[] | null>(null)
  const load = useCallback(() => {
    void storage.listInvestigations().then((a) => setItems(a.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))))
  }, [])
  useEffect(load, [load])
  useLocalRefresh(load)
  return items
}

export function useAnnotations(investigationId: string | null) {
  const [items, setItems] = useState<Annotation[]>([])
  const load = useCallback(() => {
    if (investigationId) void storage.listAnnotations(investigationId).then(setItems)
    else setItems([])
  }, [investigationId])
  useEffect(load, [load])
  useLocalRefresh(load)
  return items
}

/** Change events across several areas (for an investigation's timeline). */
export function useEventsFor(areaIds: string[]) {
  const key = areaIds.join(',')
  const [items, setItems] = useState<ChangeEvent[]>([])
  const load = useCallback(() => {
    void Promise.all(key ? key.split(',').map((id) => storage.listEvents(id)) : []).then((r) => setItems(r.flat()))
  }, [key])
  useEffect(load, [load])
  useEngineRefresh((id) => key.split(',').includes(id), load)
  return items
}
