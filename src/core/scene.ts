// Load Sentinel-2 bands over an area (mosaicking same-day tiles) and render
// products. Pure TypedArray math; outputs raw RGBA buffers, never ImageData.
import { readBandToGrid } from './cog'
import { gridInCrs, type Grid } from './geo'
import { BAND_KEYS, resolveHref, type BandKey, type SceneRef } from './stac'

export type ReflBand = Exclude<BandKey, 'scl'>

export interface SceneBands {
  grid: Grid
  /** Surface reflectance (0..~1), NaN where nodata. */
  refl: Record<ReflBand, Float32Array>
  scl: Uint8Array<ArrayBufferLike>
}

/**
 * Read one band for an acquisition onto the grid. Items are tried in order;
 * later items only fill polygon pixels the earlier ones left empty, so an area
 * straddling two MGRS tiles is assembled from both.
 */
export async function readMosaicBand(
  items: SceneRef[],
  band: BandKey,
  grid: Grid,
  mask: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint16Array | Uint8Array> {
  let out: Uint16Array | Uint8Array | null = null
  for (const item of items) {
    const g = gridInCrs(grid, item.epsg)
    if (!g) continue
    const url = await resolveHref(item, band, signal)
    let { data } = await readBandToGrid(url, g, signal)
    if (band === 'scl' && item.sensor === 'landsat') data = qaPixelToScl(data)
    if (!out) {
      out = data
    } else {
      for (let i = 0; i < out.length; i++) if (out[i] === 0 && data[i] !== 0) out[i] = data[i]
    }
    let missing = false
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && out[i] === 0) { missing = true; break }
    }
    if (!missing) break
  }
  if (!out) throw new Error('Acquisition has no items')
  return out
}

/** Load all bands for an acquisition. Reflectance uses each item's own
 *  scale/offset, so mixed-source mosaics stay radiometrically consistent. */
export async function loadAcquisitionBands(items: SceneRef[], grid: Grid, mask: Uint8Array, signal?: AbortSignal): Promise<SceneBands> {
  for (const it of items) {
    if (!gridInCrs(grid, it.epsg)) throw new Error(`Scene CRS EPSG:${it.epsg} is not in the area's UTM zone (EPSG:${grid.epsg})`)
  }
  // Items in one acquisition may come from different sources with different
  // offsets, so convert per item before mosaicking.
  const refl = {} as SceneBands['refl']
  let scl: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  await Promise.all(
    BAND_KEYS.map(async (band) => {
      if (band === 'scl') {
        const d = await readMosaicBand(items, 'scl', grid, mask, signal)
        scl = d instanceof Uint8Array ? d : Uint8Array.from(d)
        return
      }
      const out = new Float32Array(grid.width * grid.height).fill(NaN)
      for (const item of items) {
        const { data } = await readBandToGrid(await resolveHref(item, band, signal), gridInCrs(grid, item.epsg)!, signal)
        const { scale, offset, harmonize } = item.bands[band]
        const slope = harmonize?.slope ?? 1
        const intercept = harmonize?.intercept ?? 0
        let missing = false
        for (let i = 0; i < out.length; i++) {
          if (!Number.isNaN(out[i])) continue
          const dn = data[i]
          if (dn !== 0) out[i] = (dn * scale + offset) * slope + intercept
          else if (mask[i]) missing = true
        }
        if (!missing) break
      }
      refl[band] = out
    }),
  )
  return { grid, refl, scl }
}

/** @deprecated single-scene helper kept for the Phase 1 spike. */
export async function loadSceneBands(scene: SceneRef, grid: Grid, mask: Uint8Array, signal?: AbortSignal) {
  return loadAcquisitionBands([scene], grid, mask, signal)
}

// Scene Classification Layer classes (ESA L2A).
export const SCL = {
  NO_DATA: 0, SATURATED: 1, DARK: 2, CLOUD_SHADOW: 3, VEGETATION: 4, NOT_VEGETATED: 5,
  WATER: 6, UNCLASSIFIED: 7, CLOUD_MEDIUM: 8, CLOUD_HIGH: 9, THIN_CIRRUS: 10, SNOW: 11,
} as const

/**
 * Landsat Collection 2 QA_PIXEL bits → SCL-equivalent classes, so screening,
 * masking and stats work identically for both sensors. Bits: 0 fill,
 * 1 dilated cloud, 2 cirrus (OLI), 3 cloud, 4 cloud shadow, 5 snow, 7 water.
 */
export function qaPixelToScl(qa: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(qa.length)
  for (let i = 0; i < qa.length; i++) {
    const v = qa[i]
    if (v & 1) out[i] = SCL.NO_DATA
    else if (v & (0b1110)) out[i] = SCL.CLOUD_HIGH
    else if (v & 0b10000) out[i] = SCL.CLOUD_SHADOW
    else if (v & 0b100000) out[i] = SCL.SNOW
    else if (v & 0b10000000) out[i] = SCL.WATER
    else out[i] = SCL.UNCLASSIFIED
  }
  return out
}

export type PixelClass = 'clear' | 'cloud' | 'nodata'

export function classifyScl(v: number): PixelClass {
  if (v === SCL.NO_DATA || v === SCL.SATURATED) return 'nodata'
  if (v === SCL.CLOUD_SHADOW || v === SCL.CLOUD_MEDIUM || v === SCL.CLOUD_HIGH || v === SCL.THIN_CIRRUS) return 'cloud'
  return 'clear'
}

export interface CoverageStats {
  polygonPx: number
  clearPx: number
  cloudPx: number
  nodataPx: number
  /** Cloud % of the polygon pixels that have data. */
  cloudPct: number
  /** % of polygon pixels with any data (tile edge / orbit swath coverage). */
  coveragePct: number
}

export function coverageStats(scl: ArrayLike<number>, mask: Uint8Array): CoverageStats {
  let polygonPx = 0, clearPx = 0, cloudPx = 0, nodataPx = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    polygonPx++
    const c = classifyScl(scl[i])
    if (c === 'clear') clearPx++
    else if (c === 'cloud') cloudPx++
    else nodataPx++
  }
  const withData = clearPx + cloudPx
  return {
    polygonPx, clearPx, cloudPx, nodataPx,
    cloudPct: withData ? (100 * cloudPx) / withData : 100,
    coveragePct: polygonPx ? (100 * withData) / polygonPx : 0,
  }
}

/** Normalized difference (a-b)/(a+b), NaN where undefined. */
export function normalizedDifference(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length)
  for (let i = 0; i < out.length; i++) {
    const s = a[i] + b[i]
    out[i] = s === 0 ? NaN : (a[i] - b[i]) / s
  }
  return out
}

/**
 * True-colour RGBA. Pixels outside the polygon are transparent; reflectance is
 * stretched with a fixed gain + gamma so brightness is comparable across dates.
 */
export function renderTrueColor(b: SceneBands, mask: Uint8Array, gain = 3.2, gamma = 1 / 1.25): Uint8ClampedArray<ArrayBuffer> {
  const { red, green, blue } = b.refl
  const out = new Uint8ClampedArray(mask.length * 4)
  const tone = (v: number) => 255 * Math.pow(Math.min(1, Math.max(0, v * gain)), gamma)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || Number.isNaN(red[i])) continue
    const o = i * 4
    out[o] = tone(red[i])
    out[o + 1] = tone(green[i])
    out[o + 2] = tone(blue[i])
    out[o + 3] = 255
  }
  return out
}

export type Stop = [value: number, r: number, g: number, b: number]

// Brown (bare) -> yellow -> green (dense vegetation); blue for water.
export const NDVI_RAMP: Stop[] = [
  [-0.5, 40, 80, 160], [0.0, 150, 110, 70], [0.2, 220, 200, 110], [0.4, 140, 190, 70], [0.7, 30, 130, 40], [1.0, 0, 70, 20],
]
// Dry land (tan) -> wet (cyan) -> open water (deep blue).
export const NDWI_RAMP: Stop[] = [
  [-0.8, 120, 90, 60], [-0.3, 190, 170, 130], [0.0, 220, 230, 230], [0.2, 80, 180, 220], [0.6, 20, 70, 170], [1.0, 10, 30, 110],
]
// Vegetation/water (dark) -> bare/built (orange -> white-hot).
export const NDBI_RAMP: Stop[] = [
  [-0.6, 20, 40, 60], [-0.2, 50, 70, 80], [0.0, 140, 110, 90], [0.1, 220, 120, 60], [0.3, 250, 200, 120], [0.5, 255, 245, 220],
]

export function ramp(stops: Stop[], v: number): [number, number, number] {
  if (v <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3]]
  for (let i = 1; i < stops.length; i++) {
    const [v1, r1, g1, b1] = stops[i]
    if (v <= v1) {
      const [v0, r0, g0, b0] = stops[i - 1]
      const t = (v - v0) / (v1 - v0)
      return [r0 + t * (r1 - r0), g0 + t * (g1 - g0), b0 + t * (b1 - b0)]
    }
  }
  const l = stops[stops.length - 1]
  return [l[1], l[2], l[3]]
}

/** Colour-mapped index RGBA; cloudy pixels rendered as translucent grey. */
export function renderIndex(index: Float32Array, scl: ArrayLike<number>, mask: Uint8Array, stops: Stop[] = NDVI_RAMP): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(mask.length * 4)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const o = i * 4
    const cls = classifyScl(scl[i])
    if (cls === 'nodata' || Number.isNaN(index[i])) continue
    if (cls === 'cloud') {
      out[o] = out[o + 1] = out[o + 2] = 200
      out[o + 3] = 140
      continue
    }
    const [r, g, b] = ramp(stops, index[i])
    out[o] = r
    out[o + 1] = g
    out[o + 2] = b
    out[o + 3] = 255
  }
  return out
}

export function meanOver(values: Float32Array, scl: ArrayLike<number>, mask: Uint8Array): number | null {
  let sum = 0, n = 0
  for (let i = 0; i < values.length; i++) {
    if (!mask[i] || classifyScl(scl[i]) !== 'clear' || Number.isNaN(values[i])) continue
    sum += values[i]
    n++
  }
  return n ? sum / n : null
}
