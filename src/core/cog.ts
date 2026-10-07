// Windowed reads from Cloud Optimized GeoTIFFs via HTTP range requests.
import { fromUrl } from 'geotiff'
import type { Grid } from './geo'

export interface WindowRead {
  data: Uint16Array | Uint8Array
  /** Time to fetch the COG header/IFD (ms). */
  headerMs: number
  /** Time to fetch + decode the pixel window (ms). */
  readMs: number
}

/**
 * Read one band of a COG resampled onto `grid`. The COG must share the grid's
 * CRS. Pixels outside the file's extent come back as 0 (Sentinel-2 nodata).
 */
export async function readBandToGrid(url: string, grid: Grid, signal?: AbortSignal): Promise<WindowRead> {
  const t0 = performance.now()
  const tiff = await fromUrl(url, { allowFullFile: false }, signal)
  const image = await tiff.getImage()
  const t1 = performance.now()

  const [ox, oy] = image.getOrigin()
  const [rx, ry] = image.getResolution()
  const resX = Math.abs(rx)
  const resY = Math.abs(ry)
  const left = Math.round((grid.x0 - ox) / resX)
  const top = Math.round((oy - grid.y0) / resY)
  const right = left + Math.round((grid.width * grid.res) / resX)
  const bottom = top + Math.round((grid.height * grid.res) / resY)

  const rasters = await image.readRasters({
    window: [left, top, right, bottom],
    width: grid.width,
    height: grid.height,
    resampleMethod: 'nearest',
    samples: [0],
    fillValue: 0,
    interleave: false,
    signal,
  })
  const t2 = performance.now()
  return { data: rasters[0] as Uint16Array | Uint8Array, headerMs: t1 - t0, readMs: t2 - t1 }
}

/**
 * Read selected samples of a COG onto `grid`, picking the coarsest overview
 * that is still at least as fine as the grid. Essential for high-resolution
 * sources (e.g. 0.3 m aerial imagery shown at 2.5 m), where reading full
 * resolution would download ~70× more data than needed.
 */
export async function readSamplesToGrid(url: string, grid: Grid, samples: number[], signal?: AbortSignal): Promise<(Uint8Array | Uint16Array)[]> {
  const tiff = await fromUrl(url, { allowFullFile: false }, signal)
  const base = await tiff.getImage(0)
  const [ox, oy] = base.getOrigin()
  const [brx, bry] = base.getResolution()
  // Older files may have fewer bands (e.g. RGB without NIR); read what exists.
  samples = samples.filter((i) => i < base.getSamplesPerPixel())
  let image = base
  let resX = Math.abs(brx)
  let resY = Math.abs(bry)
  const count = await tiff.getImageCount()
  for (let i = 1; i < count; i++) {
    const ov = await tiff.getImage(i)
    const rx = (Math.abs(brx) * base.getWidth()) / ov.getWidth()
    if (rx > grid.res * 1.001) break
    image = ov
    resX = rx
    resY = (Math.abs(bry) * base.getHeight()) / ov.getHeight()
  }
  const left = Math.round((grid.x0 - ox) / resX)
  const top = Math.round((oy - grid.y0) / resY)
  const right = left + Math.round((grid.width * grid.res) / resX)
  const bottom = top + Math.round((grid.height * grid.res) / resY)
  // Skip files that don't overlap the grid at all.
  if (right <= 0 || bottom <= 0 || left >= image.getWidth() || top >= image.getHeight()) {
    return samples.map(() => new Uint8Array(grid.width * grid.height))
  }
  const rasters = await image.readRasters({
    window: [left, top, right, bottom],
    width: grid.width,
    height: grid.height,
    resampleMethod: 'bilinear',
    samples,
    fillValue: 0,
    interleave: false,
    signal,
  })
  return Array.from(rasters as ArrayLike<Uint8Array | Uint16Array>)
}
