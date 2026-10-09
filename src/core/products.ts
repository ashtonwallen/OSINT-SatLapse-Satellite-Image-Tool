// Spectral indices, land-cover shares and per-pixel change between scenes.
import { classifyScl, meanOver, SCL, normalizedDifference, NDBI_RAMP, NDVI_RAMP, NDWI_RAMP, renderIndex, renderTrueColor, type SceneBands } from './scene'
import { INVALID, type ChangeStats, type SceneStats } from './types'

// Classification thresholds. Deliberately simple and documented on the
// methodology page; tuned for 10 m Sentinel-2 L2A surface reflectance.
export const THRESHOLDS = {
  /** NDVI above this = vegetated. */
  veg: 0.3,
  /** NDWI (McFeeters) above this = open water. */
  water: 0.0,
  /** NDBI above this, with low NDVI and no water = built-up / bare. */
  built: 0.0,
  builtMaxNdvi: 0.2,
  /** Minimum index change for a pixel to count as changed. */
  dNdvi: 0.2,
  dNdbi: 0.1,
}

const q = (v: number) => (Number.isNaN(v) ? INVALID : Math.max(-100, Math.min(100, Math.round(v * 100))))

export interface SceneProducts {
  stats: Omit<SceneStats, 'vsPrev' | 'vsBaseline'>
  /** RGBA buffers keyed by image kind. */
  images: { tc: Uint8ClampedArray<ArrayBuffer>; ndvi: Uint8ClampedArray<ArrayBuffer>; ndwi: Uint8ClampedArray<ArrayBuffer>; ndbi: Uint8ClampedArray<ArrayBuffer> }
  /** Quantized indices (round(x*100)), INVALID outside clear polygon pixels. */
  raster: { ndvi: Int8Array; ndwi: Int8Array; ndbi: Int8Array }
}

/** `mask` = polygon (stats, change rasters); `viewMask` = pixels to render
 *  (defaults to the polygon; the engine renders the whole grid for context). */
export function computeProducts(b: SceneBands, mask: Uint8Array, viewMask: Uint8Array = mask): SceneProducts {
  const { red, green, nir, swir16 } = b.refl
  const ndvi = normalizedDifference(nir, red)
  const ndwi = normalizedDifference(green, nir)
  const ndbi = normalizedDifference(swir16, nir)
  const n = mask.length
  const rNdvi = new Int8Array(n).fill(INVALID)
  const rNdwi = new Int8Array(n).fill(INVALID)
  const rNdbi = new Int8Array(n).fill(INVALID)
  let clear = 0, veg = 0, water = 0, built = 0
  for (let i = 0; i < n; i++) {
    if (!mask[i] || classifyScl(b.scl[i]) !== 'clear' || Number.isNaN(ndvi[i])) continue
    clear++
    rNdvi[i] = q(ndvi[i])
    rNdwi[i] = q(ndwi[i])
    rNdbi[i] = q(ndbi[i])
    const cls = landCover(ndvi[i], ndwi[i], ndbi[i])
    if (cls === 1) veg++
    else if (cls === 2) water++
    else if (cls === 3) built++
  }
  const pct = (x: number) => (clear ? (100 * x) / clear : 0)
  return {
    stats: {
      haze: hazeRatio(b, mask),
      vegPct: pct(veg),
      waterPct: pct(water),
      builtPct: pct(built),
      meanNdvi: meanOver(ndvi, b.scl, mask),
      meanNdwi: meanOver(ndwi, b.scl, mask),
      meanNdbi: meanOver(ndbi, b.scl, mask),
    },
    images: {
      tc: renderTrueColor(b, viewMask),
      ndvi: renderIndex(ndvi, b.scl, viewMask, NDVI_RAMP),
      ndwi: renderIndex(ndwi, b.scl, viewMask, NDWI_RAMP),
      ndbi: renderIndex(ndbi, b.scl, viewMask, NDBI_RAMP),
    },
    raster: { ndvi: rNdvi, ndwi: rNdwi, ndbi: rNdbi },
  }
}

/** Median blue / median red over clear vegetation and soil pixels (SCL 4/5),
 *  sampled for speed. Typically ~0.5–0.65; smoke and haze push it to ~0.9–1.1. */
export function hazeRatio(b: SceneBands, mask: Uint8Array): number | null {
  const blues: number[] = [], reds: number[] = []
  const step = Math.max(1, Math.floor(mask.length / 40000))
  for (let i = 0; i < mask.length; i += step) {
    const s = b.scl[i]
    if (!mask[i] || (s !== SCL.VEGETATION && s !== SCL.NOT_VEGETATED)) continue
    const bl = b.refl.blue[i], rd = b.refl.red[i]
    if (Number.isNaN(bl) || Number.isNaN(rd)) continue
    blues.push(bl); reds.push(rd)
  }
  if (blues.length < 50) return null
  const med = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1]
  const r = med(reds)
  return r > 0.005 ? med(blues) / r : null
}

/** 0 other, 1 vegetation, 2 water, 3 built-up/bare. Water wins over the rest. */
export function landCover(ndvi: number, ndwi: number, ndbi: number): 0 | 1 | 2 | 3 {
  if (ndwi > THRESHOLDS.water) return 2
  if (ndvi > THRESHOLDS.veg) return 1
  if (ndbi > THRESHOLDS.built && ndvi < THRESHOLDS.builtMaxNdvi) return 3
  return 0
}

export const CHANGE_COLORS = {
  vegLoss: [239, 68, 68],
  vegGain: [34, 197, 94],
  waterGain: [59, 130, 246],
  waterLoss: [245, 158, 11],
  builtGain: [217, 70, 239],
} as const

export interface RasterLike { ndvi: Int8Array; ndwi: Int8Array; ndbi: Int8Array }

/** Compare an earlier and a later scene pixel by pixel. */
export function compareRasters(
  earlier: RasterLike,
  later: RasterLike,
  meta: { comparedTo: string; comparedDate: string; polygonPx: number },
): { stats: ChangeStats; rgba: Uint8ClampedArray<ArrayBuffer> } {
  const n = later.ndvi.length
  const rgba = new Uint8ClampedArray(n * 4)
  let comparable = 0, vegLoss = 0, vegGain = 0, waterGain = 0, waterLoss = 0, builtGain = 0
  const dV = THRESHOLDS.dNdvi * 100
  const dB = THRESHOLDS.dNdbi * 100
  for (let i = 0; i < n; i++) {
    const a = earlier.ndvi[i], b = later.ndvi[i]
    if (a === INVALID || b === INVALID) continue
    comparable++
    const ca = landCover(a / 100, earlier.ndwi[i] / 100, earlier.ndbi[i] / 100)
    const cb = landCover(b / 100, later.ndwi[i] / 100, later.ndbi[i] / 100)
    let color: readonly number[] | null = null
    if (ca !== 2 && cb === 2) { waterGain++; color = CHANGE_COLORS.waterGain }
    else if (ca === 2 && cb !== 2) { waterLoss++; color = CHANGE_COLORS.waterLoss }
    else if (cb === 3 && ca !== 3 && later.ndbi[i] - earlier.ndbi[i] >= dB) { builtGain++; color = CHANGE_COLORS.builtGain }
    else if (ca === 1 && b - a <= -dV) { vegLoss++; color = CHANGE_COLORS.vegLoss }
    else if (cb === 1 && b - a >= dV) { vegGain++; color = CHANGE_COLORS.vegGain }
    if (color) {
      const o = i * 4
      rgba[o] = color[0]; rgba[o + 1] = color[1]; rgba[o + 2] = color[2]; rgba[o + 3] = 220
    }
  }
  const pct = (x: number) => (comparable ? (100 * x) / comparable : 0)
  return {
    stats: {
      comparedTo: meta.comparedTo,
      comparedDate: meta.comparedDate,
      comparablePct: meta.polygonPx ? (100 * comparable) / meta.polygonPx : 0,
      vegLossPct: pct(vegLoss),
      vegGainPct: pct(vegGain),
      waterGainPct: pct(waterGain),
      waterLossPct: pct(waterLoss),
      builtGainPct: pct(builtGain),
      changedPct: pct(vegLoss + vegGain + waterGain + waterLoss + builtGain),
    },
    rgba,
  }
}
