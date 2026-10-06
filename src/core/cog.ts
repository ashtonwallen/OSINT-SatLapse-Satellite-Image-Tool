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
