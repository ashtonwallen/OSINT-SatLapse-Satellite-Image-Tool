// Merged scene catalogue: queries every configured STAC source, keeps only
// tiles in the area's UTM zone, de-duplicates by acquisition date + MGRS tile
// (earlier sources win) and groups same-day tiles into one acquisition.
import type { PolygonGeometry } from './geo'
import { searchScenes, type SceneRef, type SourceId } from './stac'

export const DEFAULT_SOURCE_ORDER: SourceId[] = ['earth-search-c1', 'earth-search', 'planetary-computer']

export interface Acquisition {
  /** UTC day, YYYY-MM-DD */
  date: string
  datetime: string
  /** One item per MGRS tile, in source-preference order. */
  items: SceneRef[]
  sceneCloudPct: number | null
}

export interface CatalogResult {
  acquisitions: Acquisition[]
  /** Sources that failed; the others were still used. */
  warnings: string[]
  itemCount: number
}

export interface CatalogQuery {
  aoi: PolygonGeometry
  epsg: number
  /** ISO interval for STAC, e.g. "2023-01-01T00:00:00Z/.." */
  datetime: string
  sources?: SourceId[]
  /** Scene-level metadata pre-filter. Polygon-level cloud is checked later. */
  maxSceneCloudPct?: number
  signal?: AbortSignal
}

export async function findAcquisitions(q: CatalogQuery): Promise<CatalogResult> {
  const sources = q.sources ?? DEFAULT_SOURCE_ORDER
  const warnings: string[] = []
  const results = await Promise.all(
    sources.map(async (s) => {
      try {
        return await searchScenes(s, q.aoi, {
          datetime: q.datetime,
          maxSceneCloudPct: q.maxSceneCloudPct,
          newestFirst: false,
          signal: q.signal,
        })
      } catch (e) {
        if (q.signal?.aborted) throw e
        warnings.push(`${s}: ${e instanceof Error ? e.message : String(e)}`)
        return []
      }
    }),
  )
  if (results.every((r) => r.length === 0) && warnings.length === sources.length) {
    throw new Error(`All imagery catalogues failed: ${warnings.join('; ')}`)
  }

  const byKey = new Map<string, SceneRef>()
  let itemCount = 0
  results.forEach((items) => {
    for (const it of items) {
      itemCount++
      if (it.epsg !== q.epsg) continue
      const key = `${it.datetime.slice(0, 10)}|${it.tile ?? it.id}`
      if (!byKey.has(key)) byKey.set(key, it)
    }
  })

  const byDate = new Map<string, Acquisition>()
  for (const it of byKey.values()) {
    const date = it.datetime.slice(0, 10)
    let acq = byDate.get(date)
    if (!acq) {
      acq = { date, datetime: it.datetime, items: [], sceneCloudPct: it.sceneCloudPct }
      byDate.set(date, acq)
    }
    acq.items.push(it)
    if (it.sceneCloudPct != null) acq.sceneCloudPct = Math.min(acq.sceneCloudPct ?? 100, it.sceneCloudPct)
  }
  const order = (s: SourceId) => sources.indexOf(s)
  const acquisitions = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  for (const a of acquisitions) a.items.sort((x, y) => order(x.sourceId) - order(y.sourceId))
  return { acquisitions, warnings, itemCount }
}
