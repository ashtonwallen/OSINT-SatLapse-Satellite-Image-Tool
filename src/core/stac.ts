// STAC search across key-free optical catalogues (Sentinel-2 L2A, Landsat
// Collection 2 L2), normalized into a single SceneRef shape. No DOM
// dependencies (uses only fetch).
import type { BBox, PolygonGeometry } from './geo'

export type BandKey = 'blue' | 'green' | 'red' | 'nir' | 'swir16' | 'scl'
export const BAND_KEYS: BandKey[] = ['blue', 'green', 'red', 'nir', 'swir16', 'scl']

export interface BandAsset {
  href: string
  /** reflectance = DN * scale + offset (ignored for SCL) */
  scale: number
  offset: number
  /** Cross-sensor harmonisation applied after scaling: r' = r * slope + intercept. */
  harmonize?: { slope: number; intercept: number }
}

export type OpticalSensor = 'sentinel-2' | 'landsat'

export interface SceneRef {
  id: string
  sourceId: SourceId
  datetime: string
  /** Scene-level cloud cover from metadata. Only a pre-filter; real cloud
   *  cover over the polygon is computed from the SCL band. */
  sceneCloudPct: number | null
  epsg: number
  bbox: BBox
  tile: string | null
  platform: string | null
  sensor: OpticalSensor
  /** Native resolution of the reflectance bands, metres. */
  resolutionM: number
  bands: Record<BandKey, BandAsset>
}

export type SourceId = 'earth-search-c1' | 'earth-search' | 'planetary-computer' | 'pc-landsat'

interface StacSource {
  id: SourceId
  label: string
  searchUrl: string
  collection: string
  assetKeys: Record<BandKey, string>
  datetimeSortField: string
  normalize(item: StacItem): SceneRef
  /** Turn a raw asset href into a fetchable URL (e.g. SAS signing). */
  sign?(href: string, signal?: AbortSignal): Promise<string>
}

// Minimal subset of the STAC item shape we rely on.
interface StacItem {
  id: string
  bbox: BBox
  properties: Record<string, unknown>
  assets: Record<string, { href: string; 'raster:bands'?: { scale?: number; offset?: number }[]; 'proj:code'?: string; 'proj:epsg'?: number }>
}

interface StacLink { rel: string; href: string; method?: string; body?: unknown; merge?: boolean }
interface StacSearchResponse { features: StacItem[]; links?: StacLink[]; context?: { matched?: number }; numberMatched?: number }

function epsgOf(item: StacItem, assetKey: string): number {
  const p = item.properties
  const a = item.assets[assetKey]
  const raw = p['proj:epsg'] ?? a?.['proj:epsg'] ?? p['proj:code'] ?? a?.['proj:code']
  const n = typeof raw === 'string' ? Number(raw.replace(/^EPSG:/i, '')) : Number(raw)
  if (!Number.isFinite(n)) throw new Error(`Item ${item.id} has no projection metadata`)
  return n
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

const EARTH_SEARCH_KEYS: Record<BandKey, string> = {
  blue: 'blue', green: 'green', red: 'red', nir: 'nir', swir16: 'swir16', scl: 'scl',
}

function normalizeEarthSearch(sourceId: SourceId) {
  return (item: StacItem): SceneRef => {
    const p = item.properties
    // Legacy Earth Search items from baseline 04.00 set this flag when the
    // +1000 DN offset was already removed from the pixels, yet still publish
    // offset -0.1 in raster:bands. Honouring both would subtract it twice.
    const alreadyApplied = p['earthsearch:boa_offset_applied'] === true
    const bands = {} as Record<BandKey, BandAsset>
    for (const k of BAND_KEYS) {
      const a = item.assets[EARTH_SEARCH_KEYS[k]]
      if (!a) throw new Error(`Item ${item.id} is missing asset ${k}`)
      const rb = a['raster:bands']?.[0]
      bands[k] = { href: a.href, scale: rb?.scale ?? 1e-4, offset: alreadyApplied ? 0 : rb?.offset ?? 0 }
    }
    return {
      id: item.id,
      sourceId,
      datetime: String(p.datetime),
      sceneCloudPct: num(p['eo:cloud_cover']),
      epsg: epsgOf(item, 'red'),
      bbox: item.bbox,
      tile: (p['grid:code'] as string | undefined)?.replace(/^MGRS-/, '') ?? null,
      platform: (p.platform as string | undefined) ?? null,
      sensor: 'sentinel-2',
      resolutionM: 10,
      bands,
    }
  }
}

const PC_KEYS: Record<BandKey, string> = {
  blue: 'B02', green: 'B03', red: 'B04', nir: 'B08', swir16: 'B11', scl: 'SCL',
}

function normalizePlanetaryComputer(item: StacItem): SceneRef {
  const p = item.properties
  // PC serves raw L2A DNs. From processing baseline 04.00 (Jan 2022) ESA adds
  // a +1000 DN offset (BOA_ADD_OFFSET) that must be removed.
  const baseline = Number(p['s2:processing_baseline'] ?? 0)
  const offset = baseline >= 4 ? -0.1 : 0
  const bands = {} as Record<BandKey, BandAsset>
  for (const k of BAND_KEYS) {
    const a = item.assets[PC_KEYS[k]]
    if (!a) throw new Error(`Item ${item.id} is missing asset ${k}`)
    bands[k] = { href: a.href, scale: 1e-4, offset }
  }
  return {
    id: item.id,
    sourceId: 'planetary-computer',
    datetime: String(p.datetime),
    sceneCloudPct: num(p['eo:cloud_cover']),
    epsg: epsgOf(item, 'B04'),
    bbox: item.bbox,
    tile: (p['s2:mgrs_tile'] as string | undefined) ?? null,
    platform: (p.platform as string | undefined) ?? null,
    sensor: 'sentinel-2',
    resolutionM: 10,
    bands,
  }
}

// Landsat Collection 2 Level-2 (Planetary Computer). Common-name asset keys
// are the same across TM, ETM+ and OLI; "scl" maps to QA_PIXEL, which the
// scene loader converts to SCL-equivalent classes (see qaPixelToScl).
const LANDSAT_KEYS: Record<BandKey, string> = {
  blue: 'blue', green: 'green', red: 'red', nir: 'nir08', swir16: 'swir16', scl: 'qa_pixel',
}

/**
 * TM/ETM+ → OLI harmonisation using the *surface reflectance* OLS coefficients
 * of Roy et al. (2016), Remote Sensing of Environment 185, Table 2. (The same
 * paper's top-of-atmosphere set has large intercepts, e.g. +0.041 in NIR, that
 * push dark water above the NDWI threshold; it must not be used on L2 data.)
 * OLI is then treated as equivalent to Sentinel-2 MSI: HLS bandpass
 * adjustments between them are within ~2–3%, below our thresholds.
 */
export const ETM_TO_OLI: Record<Exclude<BandKey, 'scl'>, { slope: number; intercept: number }> = {
  blue: { slope: 0.9785, intercept: -0.0095 },
  green: { slope: 0.9542, intercept: -0.0016 },
  red: { slope: 0.9825, intercept: -0.0022 },
  nir: { slope: 1.0073, intercept: -0.0021 },
  swir16: { slope: 1.0171, intercept: -0.003 },
}

function normalizeLandsat(item: StacItem): SceneRef {
  const p = item.properties
  const platform = (p.platform as string | undefined) ?? null
  const olderSensor = platform === 'landsat-4' || platform === 'landsat-5' || platform === 'landsat-7'
  const bands = {} as Record<BandKey, BandAsset>
  for (const k of BAND_KEYS) {
    const a = item.assets[LANDSAT_KEYS[k]]
    if (!a) throw new Error(`Item ${item.id} is missing asset ${k}`)
    const rb = a['raster:bands']?.[0]
    bands[k] = {
      href: a.href,
      scale: rb?.scale ?? 0.0000275,
      offset: rb?.offset ?? -0.2,
      harmonize: k !== 'scl' && olderSensor ? ETM_TO_OLI[k] : undefined,
    }
  }
  return {
    id: item.id,
    sourceId: 'pc-landsat',
    datetime: String(p.datetime),
    sceneCloudPct: num(p['eo:cloud_cover']),
    epsg: epsgOf(item, 'red'),
    bbox: item.bbox,
    tile: p['landsat:wrs_path'] ? `${p['landsat:wrs_path']}/${p['landsat:wrs_row']}` : null,
    platform,
    sensor: 'landsat',
    resolutionM: 30,
    bands,
  }
}

// Planetary Computer blobs need a short-lived, anonymous SAS token, issued
// per collection and cached until shortly before expiry.
const pcTokens = new Map<string, Promise<{ token: string; expires: number }>>()
export async function pcSign(href: string, collection: string, signal?: AbortSignal): Promise<string> {
  let p = pcTokens.get(collection)
  const cur = p && (await p.catch(() => null))
  if (!cur || cur.expires - Date.now() < 5 * 60_000) {
    p = fetch(`https://planetarycomputer.microsoft.com/api/sas/v1/token/${collection}`, { signal }).then(async (res) => {
      if (!res.ok) throw new Error(`Planetary Computer token request failed: HTTP ${res.status}`)
      const j = (await res.json()) as { token: string; 'msft:expiry': string }
      return { token: j.token, expires: Date.parse(j['msft:expiry']) }
    })
    pcTokens.set(collection, p)
    p.catch(() => pcTokens.delete(collection))
  }
  const { token } = await p!
  return `${href}${href.includes('?') ? '&' : '?'}${token}`
}
const signPlanetaryComputer = (href: string, signal?: AbortSignal) => pcSign(href, 'sentinel-2-l2a', signal)

export const SOURCES: Record<SourceId, StacSource> = {
  'earth-search-c1': {
    id: 'earth-search-c1',
    label: 'Element84 Earth Search (Collection 1)',
    searchUrl: 'https://earth-search.aws.element84.com/v1/search',
    collection: 'sentinel-2-c1-l2a',
    assetKeys: EARTH_SEARCH_KEYS,
    datetimeSortField: 'properties.datetime',
    normalize: normalizeEarthSearch('earth-search-c1'),
  },
  'earth-search': {
    id: 'earth-search',
    label: 'Element84 Earth Search (legacy L2A)',
    searchUrl: 'https://earth-search.aws.element84.com/v1/search',
    collection: 'sentinel-2-l2a',
    assetKeys: EARTH_SEARCH_KEYS,
    datetimeSortField: 'properties.datetime',
    normalize: normalizeEarthSearch('earth-search'),
  },
  'planetary-computer': {
    id: 'planetary-computer',
    label: 'Microsoft Planetary Computer',
    searchUrl: 'https://planetarycomputer.microsoft.com/api/stac/v1/search',
    collection: 'sentinel-2-l2a',
    assetKeys: PC_KEYS,
    datetimeSortField: 'datetime',
    normalize: normalizePlanetaryComputer,
    sign: signPlanetaryComputer,
  },
  'pc-landsat': {
    id: 'pc-landsat',
    label: 'Landsat Collection 2 L2 (Planetary Computer)',
    searchUrl: 'https://planetarycomputer.microsoft.com/api/stac/v1/search',
    collection: 'landsat-c2-l2',
    assetKeys: LANDSAT_KEYS,
    datetimeSortField: 'datetime',
    normalize: normalizeLandsat,
    sign: (href, signal) => pcSign(href, 'landsat-c2-l2', signal),
  },
}

export interface SearchOptions {
  /** ISO datetime interval, e.g. "2024-01-01T00:00:00Z/.." */
  datetime?: string
  maxSceneCloudPct?: number
  newestFirst?: boolean
  /** Stop after this many scenes. */
  max?: number
  pageSize?: number
  signal?: AbortSignal
}

/** Search a source, following STAC `next` links until exhausted or `max`. */
export async function searchScenes(sourceId: SourceId, aoi: PolygonGeometry, opts: SearchOptions = {}): Promise<SceneRef[]> {
  const src = SOURCES[sourceId]
  const body: Record<string, unknown> = {
    collections: [src.collection],
    intersects: aoi,
    limit: Math.min(opts.pageSize ?? 100, opts.max ?? Infinity),
    sortby: [{ field: src.datetimeSortField, direction: opts.newestFirst === false ? 'asc' : 'desc' }],
  }
  if (opts.datetime) body.datetime = opts.datetime
  if (opts.maxSceneCloudPct != null) body.query = { 'eo:cloud_cover': { lte: opts.maxSceneCloudPct } }

  const out: SceneRef[] = []
  let req: { url: string; init: RequestInit } | null = {
    url: src.searchUrl,
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: opts.signal },
  }
  while (req) {
    const res = await fetch(req.url, req.init)
    if (!res.ok) throw new Error(`${src.label} search failed: HTTP ${res.status}`)
    const page = (await res.json()) as StacSearchResponse
    for (const f of page.features) {
      try {
        out.push(src.normalize(f))
      } catch {
        // Skip malformed items rather than failing the whole search.
      }
      if (opts.max && out.length >= opts.max) return out
    }
    const next = page.links?.find((l) => l.rel === 'next')
    if (!next || page.features.length === 0) break
    req = next.method === 'POST'
      ? {
          url: next.href,
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next.merge ? { ...body, ...(next.body as object) } : next.body ?? body),
            signal: opts.signal,
          },
        }
      : { url: next.href, init: { signal: opts.signal } }
  }
  return out
}

export async function resolveHref(scene: SceneRef, band: BandKey, signal?: AbortSignal): Promise<string> {
  const src = SOURCES[scene.sourceId]
  const href = scene.bands[band].href
  return src.sign ? src.sign(href, signal) : href
}
