// NAIP: USDA National Agriculture Imagery Program aerial photography over the
// contiguous US. 0.3–1 m, 4 bands (R, G, B, NIR), roughly every 2–3 years per
// state. Served as COGs by Microsoft Planetary Computer (key-free).
//
// NAIP frames are not part of the Sentinel-2 change chain: they live on their
// own, much finer grid and carry no land-cover stats (8-bit, uncalibrated).
import { CONTEXT_MIN_SIDE_M } from './area'
import { readSamplesToGrid } from './cog'
import { bboxOf, gridForPolygon, project, rasterizePolygon, type Grid, type PolygonGeometry } from './geo'
import { pool } from './sampling'
import { NDVI_RAMP, ramp } from './scene'
import { pcSign } from './stac'
import type { ImageEncoder, Storage } from './storage'
import type { Area, SceneRecord } from './types'

const SEARCH_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
/** Largest output dimension; keeps a 100 km² area at ~2.5 m and memory sane. */
const MAX_DIM = 4096

export interface NaipItem {
  id: string
  datetime: string
  year: number
  gsd: number
  /** WGS84/UTM equivalent of the item's NAD83/UTM CRS. */
  epsg: number
  href: string
  state: string | null
}

export interface NaipAcquisition {
  year: number
  date: string
  gsd: number
  items: NaipItem[]
}

/** NAD83 / UTM (EPSG:269xx) and WGS84 / UTM (EPSG:326xx) differ by ~1–2 m in
 *  CONTUS, well below NAIP's display resolution here, so treat them as one. */
function toWgs84Utm(epsg: number): number {
  return epsg >= 26901 && epsg <= 26923 ? 32600 + (epsg - 26900) : epsg
}

export async function searchNaip(aoi: PolygonGeometry, signal?: AbortSignal): Promise<NaipItem[]> {
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collections: ['naip'], intersects: aoi, limit: 250 }),
    signal,
  })
  if (!res.ok) throw new Error(`NAIP search failed: HTTP ${res.status}`)
  const j = (await res.json()) as { features: { id: string; properties: Record<string, unknown>; assets: Record<string, { href: string }> }[] }
  return j.features.flatMap((f) => {
    const p = f.properties
    const raw = p['proj:epsg'] ?? p['proj:code']
    const epsg = typeof raw === 'string' ? Number(raw.replace(/^EPSG:/i, '')) : Number(raw)
    const href = f.assets.image?.href
    if (!href || !Number.isFinite(epsg)) return []
    const datetime = String(p.datetime)
    return [{
      id: f.id,
      datetime,
      year: Number(p['naip:year'] ?? datetime.slice(0, 4)),
      gsd: Number(p.gsd ?? 1),
      epsg: toWgs84Utm(epsg),
      href,
      state: (p['naip:state'] as string | undefined) ?? null,
    }]
  })
}

/** One acquisition per year, using only quads in the area's UTM zone. */
export function groupNaip(items: NaipItem[], epsg: number): NaipAcquisition[] {
  const byYear = new Map<number, NaipItem[]>()
  for (const it of items) {
    if (it.epsg !== epsg) continue
    byYear.set(it.year, [...(byYear.get(it.year) ?? []), it])
  }
  return [...byYear.entries()]
    .map(([year, its]) => ({
      year,
      items: its.sort((a, b) => a.gsd - b.gsd),
      gsd: Math.min(...its.map((i) => i.gsd)),
      date: its.map((i) => i.datetime.slice(0, 10)).sort()[0],
    }))
    .sort((a, b) => a.year - b.year)
}

/** Grid for a NAIP frame: native resolution where possible, capped at MAX_DIM. */
export function naipGrid(area: Area, gsd: number): Grid {
  const [minX, minY, maxX, maxY] = bboxOf(project(area.geometry.coordinates[0], area.grid.epsg))
  const side = Math.max(maxX - minX, maxY - minY, CONTEXT_MIN_SIDE_M)
  const res = Math.max(gsd, Math.ceil((side / MAX_DIM) * 10) / 10)
  return gridForPolygon(area.geometry, area.grid.epsg, res, res, CONTEXT_MIN_SIDE_M)
}

export interface NaipFrame {
  tc: Uint8ClampedArray<ArrayBuffer>
  ndvi: Uint8ClampedArray<ArrayBuffer> | null
  coveragePct: number
}

/** Mosaic all quads of one acquisition onto the grid and render it. */
export async function loadNaip(acq: NaipAcquisition, grid: Grid, mask: Uint8Array, signal?: AbortSignal): Promise<NaipFrame> {
  const n = grid.width * grid.height
  const r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n), nir = new Uint8Array(n)
  const filled = new Uint8Array(n)
  let hasNir = true
  for (const item of acq.items) {
    const bands = await readSamplesToGrid(await pcSign(item.href, 'naip', signal), grid, [0, 1, 2, 3], signal)
    if (bands.length < 4) hasNir = false
    const [br, bg, bb, bn] = bands
    for (let i = 0; i < n; i++) {
      if (filled[i] || (br[i] === 0 && bg[i] === 0 && bb[i] === 0)) continue
      r[i] = br[i]; g[i] = bg[i]; b[i] = bb[i]
      if (bn) nir[i] = bn[i]
      filled[i] = 1
    }
  }
  const tc = new Uint8ClampedArray(n * 4)
  const ndvi = hasNir ? new Uint8ClampedArray(n * 4) : null
  let inside = 0, covered = 0
  for (let i = 0; i < n; i++) {
    if (mask[i]) { inside++; if (filled[i]) covered++ }
    if (!filled[i]) continue
    const o = i * 4
    tc[o] = r[i]; tc[o + 1] = g[i]; tc[o + 2] = b[i]; tc[o + 3] = 255
    if (ndvi) {
      const s = nir[i] + r[i]
      const [cr, cg, cb] = ramp(NDVI_RAMP, s ? (nir[i] - r[i]) / s : 0)
      ndvi[o] = cr; ndvi[o + 1] = cg; ndvi[o + 2] = cb; ndvi[o + 3] = 255
    }
  }
  return { tc, ndvi, coveragePct: inside ? (100 * covered) / inside : 0 }
}

export const naipSceneId = (areaId: string, year: number) => `${areaId}|naip-${year}`

/**
 * Fetch any NAIP years not yet stored for the area. Cheap when nothing is new
 * (one STAC query), so it runs on every backfill and tracking pass.
 */
export async function syncNaip(
  area: Area,
  storage: Storage,
  encoder: ImageEncoder,
  opts: { signal?: AbortSignal; onProgress?(done: number, total: number, message: string): void; onScene?(s: SceneRecord): void },
): Promise<number> {
  const { signal } = opts
  const known = new Set((await storage.listScenes(area.id)).filter((s) => s.sensor === 'naip').map((s) => s.id))
  const acqs = groupNaip(await searchNaip(area.geometry, signal), area.grid.epsg).filter((a) => !known.has(naipSceneId(area.id, a.year)))
  let done = 0
  opts.onProgress?.(0, acqs.length, acqs.length ? `Fetching ${acqs.length} years of high-res aerial imagery…` : 'No new aerial imagery')
  // Sequential-ish: each frame can be tens of MB.
  await pool(acqs, 2, async (acq) => {
    const grid = naipGrid(area, acq.gsd)
    const mask = rasterizePolygon(area.geometry, grid)
    const frame = await loadNaip(acq, grid, mask, signal)
    const id = naipSceneId(area.id, acq.year)
    const usable = frame.coveragePct >= 50
    if (usable) {
      await storage.putImage(id, 'tc', await encoder.encode(frame.tc, grid.width, grid.height, 'photo'))
      if (frame.ndvi) await storage.putImage(id, 'ndvi', await encoder.encode(frame.ndvi, grid.width, grid.height, 'photo'))
    }
    const rec: SceneRecord = {
      id,
      areaId: area.id,
      date: acq.date,
      datetime: `${acq.date}T00:00:00Z`,
      status: usable ? 'processed' : 'rejected',
      reason: usable ? undefined : `Only ${frame.coveragePct.toFixed(0)}% of the area imaged`,
      sources: acq.items.map((i) => ({ sourceId: 'pc-naip', itemId: i.id, tile: i.state })),
      cloudPct: 0,
      coveragePct: frame.coveragePct,
      sensor: 'naip',
      grid,
      gsd: acq.gsd,
    }
    await storage.putScenes([rec])
    opts.onScene?.(rec)
    done++
    opts.onProgress?.(done, acqs.length, `Aerial imagery: ${done} of ${acqs.length} years (${acq.year}, ${acq.gsd} m)`)
  }, signal)
  return done
}
