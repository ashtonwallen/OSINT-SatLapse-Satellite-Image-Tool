/// <reference lib="webworker" />
// Runs backfill / tracking jobs off the main thread, one at a time.
import { syncArea, type SyncMode, type SyncProgress, type SyncResult } from '../core/engine'
import type { SceneRecord } from '../core/types'
import { canvasEncoder } from '../storage/encoder'
import { storage } from '../storage/idb'

export type EngineRequest =
  | { type: 'sync'; areaId: string; mode: SyncMode }
  | { type: 'cancel'; areaId: string }

export type EngineEvent =
  | { type: 'started'; areaId: string; mode: SyncMode }
  | { type: 'progress'; areaId: string; progress: SyncProgress }
  | { type: 'scene'; areaId: string; scene: SceneRecord }
  | { type: 'finished'; areaId: string; result: SyncResult }
  | { type: 'failed'; areaId: string; error: string; cancelled: boolean }

const post = (e: EngineEvent) => self.postMessage(e)
const queue: { areaId: string; mode: SyncMode }[] = []
let current: { areaId: string; ctrl: AbortController } | null = null

async function pump() {
  if (current || !queue.length) return
  const job = queue.shift()!
  const ctrl = new AbortController()
  current = { areaId: job.areaId, ctrl }
  post({ type: 'started', areaId: job.areaId, mode: job.mode })
  try {
    const area = await storage.getArea(job.areaId)
    if (area) await storage.putArea({ ...area, sync: { ...area.sync, status: 'running', error: undefined } })
    let last = 0
    const result = await syncArea(job.areaId, storage, canvasEncoder, {
      mode: job.mode,
      signal: ctrl.signal,
      onProgress: (progress) => {
        // Throttle chatty screening updates.
        const now = performance.now()
        if (progress.done === progress.total || progress.phase !== 'screen' || now - last > 150) {
          last = now
          post({ type: 'progress', areaId: job.areaId, progress })
        }
      },
      onScene: (scene) => post({ type: 'scene', areaId: job.areaId, scene }),
    })
    post({ type: 'finished', areaId: job.areaId, result })
  } catch (e) {
    const cancelled = ctrl.signal.aborted
    const error = cancelled ? 'Cancelled' : e instanceof Error ? e.message : String(e)
    const area = await storage.getArea(job.areaId).catch(() => undefined)
    if (area) {
      await storage.putArea({ ...area, sync: { ...area.sync, status: cancelled ? 'idle' : 'error', error: cancelled ? undefined : error } })
    }
    post({ type: 'failed', areaId: job.areaId, error, cancelled })
  } finally {
    current = null
    void pump()
  }
}

self.onmessage = (ev: MessageEvent<EngineRequest>) => {
  const msg = ev.data
  if (msg.type === 'sync') {
    if (current?.areaId === msg.areaId || queue.some((q) => q.areaId === msg.areaId)) return
    queue.push({ areaId: msg.areaId, mode: msg.mode })
    void pump()
  } else if (msg.type === 'cancel') {
    const i = queue.findIndex((q) => q.areaId === msg.areaId)
    if (i >= 0) queue.splice(i, 1)
    if (current?.areaId === msg.areaId) current.ctrl.abort()
  }
}
