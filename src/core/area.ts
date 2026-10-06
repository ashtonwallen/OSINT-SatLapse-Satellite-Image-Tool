import { bboxOf, gridForPolygon, ringAreaKm2, utmEpsgFor, type LngLat, type PolygonGeometry } from './geo'
import { SCHEMA_VERSION, type Area, type AreaSettings } from './types'

/** Grids are at least this wide/tall so tiny areas are shown in context. */
export const CONTEXT_MIN_SIDE_M = 2000

export const DEFAULT_SETTINGS: AreaSettings = { historyDepth: '3y', sampling: 'month', maxCloudPct: 20 }

/** Keep output rasters around ≤ ~1.2 MP: 10 m up to ~120 km², coarser beyond. */
export function resolutionFor(areaKm2: number): number {
  return Math.max(10, Math.ceil(Math.sqrt((areaKm2 * 1e6) / 1.2e6) / 10) * 10)
}

export function polygonCentroid(poly: PolygonGeometry): LngLat {
  const [minX, minY, maxX, maxY] = bboxOf(poly.coordinates[0])
  return [(minX + maxX) / 2, (minY + maxY) / 2]
}

export function validatePolygon(poly: PolygonGeometry, maxAreaKm2: number): { ok: true; areaKm2: number } | { ok: false; reason: string } {
  const ring = poly.coordinates[0]
  if (!ring || ring.length < 4) return { ok: false, reason: 'A polygon needs at least three points.' }
  const areaKm2 = ringAreaKm2(ring)
  if (areaKm2 < 0.01) return { ok: false, reason: 'That area is too small to analyse (under 1 hectare).' }
  if (areaKm2 > maxAreaKm2) {
    return {
      ok: false,
      reason: `This area is ${areaKm2.toFixed(0)} km²; the limit is ${maxAreaKm2} km². Everything is downloaded and processed in your browser, so a larger area means proportionally more data per scene (about 10–30 MB per 100 km²) and more storage on your device. Try a smaller area around what you care about.`,
    }
  }
  const [minX, , maxX] = bboxOf(ring)
  if (maxX - minX > 6) return { ok: false, reason: 'Areas spanning more than one UTM zone are not supported.' }
  return { ok: true, areaKm2 }
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createArea(name: string, geometry: PolygonGeometry, settings: AreaSettings = DEFAULT_SETTINGS): Area {
  const areaKm2 = ringAreaKm2(geometry.coordinates[0])
  const epsg = utmEpsgFor(polygonCentroid(geometry))
  const res = resolutionFor(areaKm2)
  const now = new Date().toISOString()
  return {
    id: newId(),
    schemaVersion: SCHEMA_VERSION,
    name: name.trim() || 'Untitled area',
    geometry,
    areaKm2,
    grid: gridForPolygon(geometry, epsg, res, Math.max(20, res), CONTEXT_MIN_SIDE_M),
    settings,
    createdAt: now,
    updatedAt: now,
    sync: { status: 'queued', unseen: 0 },
  }
}
