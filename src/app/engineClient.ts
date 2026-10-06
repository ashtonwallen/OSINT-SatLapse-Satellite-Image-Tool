// Main-thread side of the engine worker: a singleton with a tiny pub/sub.
import type { SyncMode, SyncProgress } from '../core/engine'
import type { EngineEvent, EngineRequest } from '../workers/engine.worker'

type Listener = (e: EngineEvent) => void

class EngineClient {
  private worker: Worker | null = null
  private listeners = new Set<Listener>()
  /** Latest progress per area, for components that mount mid-run. */
  readonly progress = new Map<string, SyncProgress>()

  private get w(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (ev: MessageEvent<EngineEvent>) => {
        const e = ev.data
        if (e.type === 'progress') this.progress.set(e.areaId, e.progress)
        if (e.type === 'finished' || e.type === 'failed') this.progress.delete(e.areaId)
        this.listeners.forEach((l) => l(e))
      }
    }
    return this.worker
  }

  private send(msg: EngineRequest) {
    this.w.postMessage(msg)
  }

  sync(areaId: string, mode: SyncMode) {
    this.send({ type: 'sync', areaId, mode })
  }

  cancel(areaId: string) {
    this.send({ type: 'cancel', areaId })
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}

export const engine = new EngineClient()
