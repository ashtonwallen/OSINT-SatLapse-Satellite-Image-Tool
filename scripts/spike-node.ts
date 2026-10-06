// Runs the Phase 1 pipeline under Node (no browser) to prove src/core is
// portable to a future server worker, and writes PNGs for visual inspection.
// Usage: npx jiti scripts/spike-node.ts <lng> <lat> <km2> [sourceId] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { bboxOf, gridForPolygon, rasterizePolygon, squareAround, utmEpsgFor, type LngLat } from '../src/core/geo'
import { coverageStats, loadSceneBands, normalizedDifference, renderIndex, renderTrueColor } from '../src/core/scene'
import { searchScenes, type SourceId } from '../src/core/stac'

function png(rgba: Uint8ClampedArray, w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const [lng, lat, km2, sourceId = 'earth-search-c1', outDir = 'spike-out'] = process.argv.slice(2)
const center: LngLat = [Number(lng), Number(lat)]
const poly = squareAround(center, Number(km2))
const epsg = utmEpsgFor(center)
const [minX, minY, maxX, maxY] = bboxOf(poly.coordinates[0])
const t0 = performance.now()
const scenes = await searchScenes(sourceId as SourceId, poly, { datetime: `${new Date(Date.now() - 180 * 864e5).toISOString()}/..`, maxSceneCloudPct: 10, max: 30 })
const scene = scenes.find((s) => s.epsg === epsg && s.bbox[0] <= minX && s.bbox[1] <= minY && s.bbox[2] >= maxX && s.bbox[3] >= maxY)
if (!scene) throw new Error('no scene')
const grid = gridForPolygon(poly, epsg)
const mask0 = rasterizePolygon(poly, grid)
const bands = await loadSceneBands(scene, grid, mask0)
const mask = rasterizePolygon(poly, grid)
const cov = coverageStats(bands.scl, mask)
mkdirSync(outDir, { recursive: true })
const tag = `${sourceId}-${km2}`
writeFileSync(`${outDir}/${tag}-tc.png`, png(renderTrueColor(bands, mask), grid.width, grid.height))
writeFileSync(`${outDir}/${tag}-ndvi.png`, png(renderIndex(normalizedDifference(bands.refl.nir, bands.refl.red), bands.scl, mask), grid.width, grid.height))
const r = bands.refl.red.filter((v) => !Number.isNaN(v)).sort()
console.log(JSON.stringify({ scene: scene.id, date: scene.datetime, grid: [grid.width, grid.height], cov, redP50: r[r.length >> 1], ms: Math.round(performance.now() - t0) }))
