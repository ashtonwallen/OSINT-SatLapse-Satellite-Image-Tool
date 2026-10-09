import { createArea, createInvestigation, newId } from '../core/area'
import type { LngLat, PolygonGeometry } from '../core/geo'
import type { Annotation, Area, AreaSettings, Investigation } from '../core/types'
import { exportProjectFile, importProjectFile } from '../core/project'
import type { SharedProject } from '../core/share'
import { storage } from '../storage/idb'
import { engine } from './engineClient'

/** Fired after the UI itself writes to storage, so lists can refresh. */
export const localChanges = new EventTarget()
const changed = () => localChanges.dispatchEvent(new Event('change'))

// --- Investigations ---------------------------------------------------------

export async function newInvestigation(name: string): Promise<Investigation> {
  const inv = createInvestigation(name)
  await storage.putInvestigation(inv)
  changed()
  return inv
}

/** The investigation new areas go into when the user hasn't picked one. */
export async function ensureInvestigation(): Promise<Investigation> {
  const all = await storage.listInvestigations()
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? newInvestigation('My project')
}

export async function updateInvestigation(id: string, patch: Partial<Pick<Investigation, 'name' | 'notes' | 'ai'>>): Promise<void> {
  const cur = await storage.getInvestigation(id)
  if (!cur) return
  await storage.putInvestigation({ ...cur, ...patch, updatedAt: new Date().toISOString() })
  changed()
}

export async function deleteInvestigation(id: string): Promise<void> {
  for (const a of (await storage.listAreas()).filter((x) => x.investigationId === id)) engine.cancel(a.id)
  await storage.deleteInvestigation(id)
  changed()
}

const touch = (investigationId: string) => updateInvestigation(investigationId, {})

// --- Areas ------------------------------------------------------------------

export async function createAndBackfill(investigationId: string, name: string, geometry: PolygonGeometry, settings: AreaSettings): Promise<Area> {
  const area = createArea(name, geometry, settings, investigationId)
  await storage.putArea(area)
  await touch(investigationId)
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
  // One-off: the default container was briefly named "My investigation".
  const legacy = (await storage.listInvestigations()).find((i) => i.name === 'My investigation')
  if (legacy) await updateInvestigation(legacy.id, { name: 'My project' })
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

export async function renameArea(id: string, name: string): Promise<void> {
  const fresh = await storage.getArea(id)
  if (!fresh || !name.trim()) return
  await storage.putArea({ ...fresh, name: name.trim().slice(0, 120), updatedAt: new Date().toISOString() })
  changed()
}

// --- Annotations ------------------------------------------------------------

export async function addAnnotation(a: { investigationId: string; areaId?: string; lngLat: LngLat; date: string; sceneId?: string; text: string; author?: 'user' | 'ai' }): Promise<Annotation> {
  const ann: Annotation = { id: newId(), author: 'user', createdAt: new Date().toISOString(), ...a, text: a.text.trim().slice(0, 2000) }
  await storage.putAnnotation(ann)
  await touch(a.investigationId)
  return ann
}

export async function editAnnotation(a: Annotation, text: string): Promise<void> {
  await storage.putAnnotation({ ...a, text: text.trim().slice(0, 2000) })
  changed()
}

export async function removeAnnotation(id: string): Promise<void> {
  await storage.deleteAnnotation(id)
  changed()
}

// --- Portability ------------------------------------------------------------

export async function exportProjectBytes(projectId: string): Promise<Uint8Array> {
  return exportProjectFile(storage, projectId)
}

export async function importProjectBytes(bytes: Uint8Array): Promise<Investigation> {
  const p = await importProjectFile(storage, bytes)
  changed()
  return p
}

/** Create a project from a share link and start each area's backfill. */
export async function createFromShare(shared: SharedProject, settings: AreaSettings): Promise<Investigation> {
  const inv = await newInvestigation(shared.name)
  for (const a of shared.areas) await createAndBackfill(inv.id, a.name, a.geometry, settings)
  return inv
}

/** Bundled, pre-processed example (served with the site, no imagery fetch). */
export const EXAMPLE_URL = `${import.meta.env.BASE_URL}examples/oroville.satlapse`

export async function loadExample(): Promise<Investigation> {
  const res = await fetch(EXAMPLE_URL)
  if (!res.ok) throw new Error(`Couldn't load the example (HTTP ${res.status})`)
  const p = await importProjectFile(storage, new Uint8Array(await res.arrayBuffer()), { example: true, keepIds: true })
  changed()
  return p
}
