/// <reference lib="webworker" />
// Feasibility spike worker: STAC search -> windowed COG reads -> products.
import { bboxOf, gridForPolygon, rasterizePolygon, ringAreaKm2, squareAround, utmEpsgFor, type LngLat } from '../core/geo'
import { coverageStats, loadSceneBands, meanOver, normalizedDifference, renderIndex, renderTrueColor } from '../core/scene'
import { searchScenes, type SourceId } from '../core/stac'

export interface SpikeRequest {
  runId: number
  sourceId: SourceId
  center: LngLat
  areaKm2: number
}

export interface SpikeResult {
  runId: number
  ok: true
  sourceId: SourceId
  areaKm2: number
  sceneId: string
  datetime: string
  sceneCloudPct: number | null
  polygonCloudPct: number
  coveragePct: number
  meanNdvi: number | null
  width: number
  height: number
  searchMs: number
  headerMs: number
  bandsMs: number
  processMs: number
  totalMs: number
  requests: number
  bytes: number
  bandTimings: { band: string; headerMs: number; readMs: number }[]
  trueColor: Uint8ClampedArray
  ndvi: Uint8ClampedArray
}

export interface SpikeError { runId: number; ok: false; stage: string; message: string }

// Count network usage. geotiff.js resolves `fetch` at call time, so wrapping
// the global here captures every range request it makes.
let requests = 0
let bytes = 0
const realFetch = self.fetch.bind(self)
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  requests++
  const res = await realFetch(input, init)
  bytes += Number(res.headers.get('content-length') ?? 0)
  return res
}

self.onmessage = async (ev: MessageEvent<SpikeRequest>) => {
  const { runId, sourceId, center, areaKm2 } = ev.data
  let stage = 'search'
  try {
    const t0 = performance.now()
    const poly = squareAround(center, areaKm2)
    const epsg = utmEpsgFor(center)
    const [minX, minY, maxX, maxY] = bboxOf(poly.coordinates[0])
    const since = new Date(Date.now() - 180 * 86400_000).toISOString()
    const scenes = await searchScenes(sourceId, poly, { datetime: `${since}/..`, maxSceneCloudPct: 10, max: 30 })
    // Prefer a scene in the polygon's own UTM zone whose tile covers it fully.
    const scene = scenes.find((s) => s.epsg === epsg && s.bbox[0] <= minX && s.bbox[1] <= minY && s.bbox[2] >= maxX && s.bbox[3] >= maxY)
    if (!scene) throw new Error(`No suitable scene among ${scenes.length} results`)
    const t1 = performance.now()

    stage = 'read'
    requests = 0
    bytes = 0
    const grid = gridForPolygon(poly, epsg)
    const mask = rasterizePolygon(poly, grid)
    const bands = await loadSceneBands(scene, grid, mask)
    const timings: SpikeResult['bandTimings'] = []
    const t2 = performance.now()

    stage = 'process'
    const cov = coverageStats(bands.scl, mask)
    const ndviVals = normalizedDifference(bands.refl.nir, bands.refl.red)
    const trueColor = renderTrueColor(bands, mask)
    const ndvi = renderIndex(ndviVals, bands.scl, mask)
    const meanNdvi = meanOver(ndviVals, bands.scl, mask)
    const t3 = performance.now()

    const result: SpikeResult = {
      runId, ok: true, sourceId,
      areaKm2: ringAreaKm2(poly.coordinates[0]),
      sceneId: scene.id,
      datetime: scene.datetime,
      sceneCloudPct: scene.sceneCloudPct,
      polygonCloudPct: cov.cloudPct,
      coveragePct: cov.coveragePct,
      meanNdvi,
      width: grid.width,
      height: grid.height,
      searchMs: t1 - t0,
      headerMs: 0,
      bandsMs: t2 - t1,
      processMs: t3 - t2,
      totalMs: t3 - t0,
      requests,
      bytes,
      bandTimings: timings,
      trueColor,
      ndvi,
    }
    self.postMessage(result, [trueColor.buffer, ndvi.buffer])
  } catch (e) {
    const err: SpikeError = { runId, ok: false, stage, message: e instanceof Error ? e.message : String(e) }
    self.postMessage(err)
  }
}
