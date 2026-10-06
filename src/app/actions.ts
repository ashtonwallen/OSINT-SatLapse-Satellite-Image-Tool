import { createArea } from '../core/area'
import type { PolygonGeometry } from '../core/geo'
import type { Area, AreaSettings } from '../core/types'
import { storage } from '../storage/idb'
import { engine } from './engineClient'

/** Fired after the UI itself writes to storage, so lists can refresh. */
export const localChanges = new EventTarget()
const changed = () => localChanges.dispatchEvent(new Event('change'))

export async function createAndBackfill(name: string, geometry: PolygonGeometry, settings: AreaSettings): Promise<Area> {
  const area = createArea(name, geometry, settings)
  await storage.putArea(area)
  changed()
  // Ask the browser not to evict our data under storage pressure.
  void navigator.storage?.persist?.().catch(() => {})
  engine.sync(area.id, 'backfill')
  return area
}

/**
 * Called on app start: resume unfinished backfills and look for new scenes on
 * every tracked area. Jobs run one at a time in the worker.
 */
export async function trackAllAreas(): Promise<void> {
  const areas = await storage.listAreas()
  for (const a of areas) {
    if (a.example) continue
    // No completed check yet means the backfill never finished: resume it.
    engine.sync(a.id, a.sync.lastCheckedAt ? 'track' : 'backfill')
  }
}

export async function markSeen(area: Area): Promise<void> {
  if (!area.sync.unseen) return
  const fresh = await storage.getArea(area.id)
  if (fresh) await storage.putArea({ ...fresh, sync: { ...fresh.sync, unseen: 0 } })
  changed()
}

export async function deleteArea(id: string): Promise<void> {
  engine.cancel(id)
  await storage.deleteArea(id)
  changed()
}
