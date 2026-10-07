// Versioned data model shared by the engine, storage and UI.
// Bump SCHEMA_VERSION and add a migration in storage when shapes change.
import type { Grid, PolygonGeometry } from './geo'

// v1: areas at top level. v2: investigations contain areas, notes, annotations.
export const SCHEMA_VERSION = 2

/** 'all' = Sentinel-2 era (2015→); 'landsat' adds Landsat 4/5/7/8 back to 1984. */
export type HistoryDepth = '1y' | '3y' | 'all' | 'landsat'
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

/** Top-level container shown in the UI as a "project": one or more areas, notes,
 *  annotations and an event log. (Named Investigation in code and storage for
 *  schema compatibility.) */
export interface Investigation {
  id: string
  schemaVersion: number
  name: string
  /** Free-form Markdown notes. */
  notes: string
  /** AI provider/model chosen for this investigation (no keys here). */
  ai?: { provider: string; model: string }
  createdAt: string
  updatedAt: string
}

/** A user (or user-approved AI) note pinned to a place and a scene date. */
export interface Annotation {
  id: string
  investigationId: string
  areaId?: string
  lngLat: [number, number]
  /** Scene date the observation refers to (YYYY-MM-DD). */
  date: string
  sceneId?: string
  text: string
  author: 'user' | 'ai'
  createdAt: string
}

export interface Area {
  id: string
  schemaVersion: number
  /** Owning investigation (schema v2+). */
  investigationId: string
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
export type Confidence = 'high' | 'medium' | 'low'
export type LandCoverMetric = 'vegPct' | 'waterPct' | 'builtPct'

/**
 * A flagged change. Plain JSON, produced by the pure detector in
 * src/core/detect.ts; this is also the payload alert channels consume
 * (src/core/alerts.ts), so keep it serialisable and self-describing.
 */
export interface ChangeEvent {
  id: string
  areaId: string
  sceneId: string
  date: string
  /** Earliest date the change could have started (previous usable scene). */
  previousDate: string
  kind: EventKind
  metric: LandCoverMetric
  /** 'seasonal': compared with the same time of year in prior years.
   *  'previous': not enough history, compared with the previous scene only. */
  method: 'seasonal' | 'previous'
  confidence: Confidence
  /** Land-cover share (%) observed on this date. */
  observed: number
  /** Typical share for this time of year (seasonal) or previous value. */
  expected: number
  /** Typical range for this time of year, when seasonal. */
  expectedRange?: [number, number]
  /** Prior years and scenes the comparison was based on. */
  reference: { years: number[]; sceneIds: string[] }
  /** Later scene that confirmed the change persisted, if any. */
  confirmedBy?: string
  /** Affected area in km². */
  km2: number
  /** 0..1, used for marker sizing and sorting. */
  severity: number
  /** Data provenance of the flagged scene, for reports. */
  sources: { sourceId: string; itemId: string }[]
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
