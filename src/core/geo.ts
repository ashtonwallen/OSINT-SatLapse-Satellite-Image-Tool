// Geometry helpers. Pure functions with no DOM dependencies so they can run in
// a Web Worker today and a Node worker later.
import proj4 from 'proj4'

export type LngLat = [number, number]

export interface PolygonGeometry {
  type: 'Polygon'
  coordinates: LngLat[][]
}

export type BBox = [minX: number, minY: number, maxX: number, maxY: number]

/** A north-up pixel grid in a projected CRS. x0/y0 is the top-left corner. */
export interface Grid {
  epsg: number
  x0: number
  y0: number
  res: number
  width: number
  height: number
}

const EARTH_RADIUS_M = 6378137

export function bboxOf(points: LngLat[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

/** Geodesic area of a lon/lat ring in km² (spherical approximation). */
export function ringAreaKm2(ring: LngLat[]): number {
  const rad = Math.PI / 180
  let total = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    total += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad))
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2) / 1e6
}

/** Closed square polygon of the given area centred on a point. */
export function squareAround([lng, lat]: LngLat, areaKm2: number): PolygonGeometry {
  const halfKm = Math.sqrt(areaKm2) / 2
  const dLat = halfKm / 110.574
  const dLng = halfKm / (111.32 * Math.cos((lat * Math.PI) / 180))
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
      [lng - dLng, lat - dLat],
    ]],
  }
}

/** Sentinel-2 tiles are always delivered in WGS84 / UTM. */
export function utmEpsgFor([lng, lat]: LngLat): number {
  const zone = Math.min(60, Math.floor((lng + 180) / 6) + 1)
  return (lat >= 0 ? 32600 : 32700) + zone
}

function projDef(epsg: number): string {
  if (epsg === 4326) return 'EPSG:4326'
  const north = epsg >= 32601 && epsg <= 32660
  const south = epsg >= 32701 && epsg <= 32760
  if (!north && !south) throw new Error(`Unsupported CRS EPSG:${epsg} (expected WGS84/UTM)`)
  const zone = epsg % 100
  return `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`
}

export function project(points: LngLat[], epsg: number): [number, number][] {
  const conv = proj4('EPSG:4326', projDef(epsg))
  return points.map((p) => conv.forward(p) as [number, number])
}

/**
 * Build the output grid for a polygon in a given UTM zone. The grid is
 * snapped to multiples of `snap` metres so 10 m and 20 m Sentinel-2 bands
 * align exactly, and so every scene of the same area lands on identical
 * pixels (a precondition for per-pixel change detection).
 */
export function gridForPolygon(poly: PolygonGeometry, epsg: number, res = 10, snap = 20, minSideM = 0): Grid {
  let [minX, minY, maxX, maxY] = bboxOf(project(poly.coordinates[0], epsg))
  // Small areas get surrounding context so the imagery is interpretable.
  const padX = Math.max(0, (minSideM - (maxX - minX)) / 2)
  const padY = Math.max(0, (minSideM - (maxY - minY)) / 2)
  minX -= padX; maxX += padX; minY -= padY; maxY += padY
  const x0 = Math.floor(minX / snap) * snap
  const y0 = Math.ceil(maxY / snap) * snap
  const x1 = Math.ceil(maxX / snap) * snap
  const y1 = Math.floor(minY / snap) * snap
  return { epsg, x0, y0, res, width: Math.round((x1 - x0) / res), height: Math.round((y0 - y1) / res) }
}

/** 1 for pixels whose centre is inside the polygon, else 0 (even-odd rule). */
export function rasterizePolygon(poly: PolygonGeometry, grid: Grid): Uint8Array {
  const mask = new Uint8Array(grid.width * grid.height)
  const rings = poly.coordinates.map((r) =>
    project(r, grid.epsg).map(([x, y]) => [(x - grid.x0) / grid.res, (grid.y0 - y) / grid.res] as const),
  )
  const xs: number[] = []
  for (let row = 0; row < grid.height; row++) {
    const cy = row + 0.5
    xs.length = 0
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [ax, ay] = ring[i]
        const [bx, by] = ring[i + 1]
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
          xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax))
        }
      }
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const start = Math.max(0, Math.ceil(xs[k] - 0.5))
      const end = Math.min(grid.width - 1, Math.floor(xs[k + 1] - 0.5))
      mask.fill(1, row * grid.width + start, row * grid.width + end + 1)
    }
  }
  return mask
}

export function unproject(points: [number, number][], epsg: number): LngLat[] {
  const conv = proj4('EPSG:4326', projDef(epsg))
  return points.map((p) => conv.inverse(p) as LngLat)
}

/** Grid corners in lon/lat: top-left, top-right, bottom-right, bottom-left
 *  (the order MapLibre image sources expect). */
export function gridCornersLngLat(g: Grid): [LngLat, LngLat, LngLat, LngLat] {
  const x1 = g.x0 + g.width * g.res
  const y1 = g.y0 - g.height * g.res
  const c = unproject([[g.x0, g.y0], [x1, g.y0], [x1, y1], [g.x0, y1]], g.epsg)
  return [c[0], c[1], c[2], c[3]]
}
