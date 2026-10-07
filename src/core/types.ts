// Versioned data model shared by the engine, storage and UI.
// Bump SCHEMA_VERSION and add a migration in storage when shapes change.
import type { Grid, PolygonGeometry } from './geo'

export const SCHEMA_VERSION = 1

export type HistoryDepth = '1y' | '3y' | 'all'
export type Sampling = 'all' | 'month' | 'quarter'

export interface AreaSettings {
  historyDepth: HistoryDepth
  sampling: Sampling
  /** Max cloud % over the polygon for a scene to be usable. */
  maxCloudPct: number
}

export type SyncStatus = 'idle' | 'queued' | 'running' | 'error'

export interface AreaSync {
  status: SyncStatus
  /** When we last asked the catalogues for new scenes (ISO). */
  lastCheckedAt?: string
  /** Acquisition date (YYYY-MM-DD) of the newest processed scene. */
  latestDate?: string
  /** Number of scenes processed since the user last opened this area. */
  unseen: number
  error?: string
}

export interface Area {
  id: string
  schemaVersion: number
  name: string
  geometry: PolygonGeometry
  areaKm2: number
  grid: Grid
  settings: AreaSettings
  createdAt: string
  updatedAt: string
  sync: AreaSync
  /** Bundled demo area: read-only, never tracked. */
  example?: boolean
}

export type ImageKind = 'tc' | 'ndvi' | 'ndwi' | 'ndbi' | 'chgPrev' | 'chgBase'
export const IMAGE_KINDS: ImageKind[] = ['tc', 'ndvi', 'ndwi', 'ndbi', 'chgPrev', 'chgBase']

/** Per-pixel change between two scenes, as % of pixels clear in both. */
export interface ChangeStats {
  comparedTo: string
  comparedDate: string
  comparablePct: number
  vegLossPct: number
  vegGainPct: number
  waterGainPct: number
  waterLossPct: number
  builtGainPct: number
  changedPct: number
}

export interface SceneStats {
  /** Land-cover shares, % of clear polygon pixels. */
  vegPct: number
  waterPct: number
  builtPct: number
  meanNdvi: number | null
  meanNdwi: number | null
  meanNdbi: number | null
  vsPrev?: ChangeStats
  vsBaseline?: ChangeStats
}

export type SceneStatus = 'processed' | 'rejected' | 'skipped'

/** Imaging system that produced a scene. Missing means Sentinel-2 (schema v1). */
export type Sensor = 'sentinel-2' | 'naip' | 'landsat'
export const sensorOf = (s: { sensor?: Sensor }): Sensor => s.sensor ?? 'sentinel-2'

export interface SceneRecord {
  /** `${areaId}|${date}` */
  id: string
  areaId: string
  date: string
  datetime: string
  status: SceneStatus
  /** Why a scene was rejected or skipped. */
  reason?: string
  /** sourceId matches an entry in DATA_SOURCES (src/core/sources.ts). */
  sources: { sourceId: string; itemId: string; tile: string | null }[]
  cloudPct: number
  coveragePct: number
  stats?: SceneStats
  /** Absent for Sentinel-2 (the area's main grid). */
  sensor?: Sensor
  /** Own pixel grid for sources rendered at a different resolution (e.g. NAIP). */
  grid?: Grid
  /** Native ground sample distance in metres, when it differs from the grid. */
  gsd?: number
}

export type EventKind = 'veg_loss' | 'veg_gain' | 'water_gain' | 'water_loss' | 'built_gain'

export interface ChangeEvent {
  id: string
  areaId: string
  sceneId: string
  date: string
  previousDate: string
  kind: EventKind
  /** Affected area in km². */
  km2: number
  /** 0..1, used for marker sizing and sorting. */
  severity: number
  /** Likely seasonal (a similar change happened at this time in another year). */
  recurring: boolean
  title: string
  description: string
}

/** Quantized index rasters kept for the baseline and latest scenes so new
 *  scenes can be compared without re-downloading. Values are round(index*100),
 *  INVALID where the pixel was cloudy, nodata or outside the polygon. */
export interface IndexRaster {
  key: string
  areaId: string
  sceneId: string
  date: string
  ndvi: Int8Array
  ndwi: Int8Array
  ndbi: Int8Array
}
export const INVALID = -128

export const sceneId = (areaId: string, date: string) => `${areaId}|${date}`
