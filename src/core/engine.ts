// Backfill + tracking orchestrator. Runtime-agnostic: needs only fetch, a
// Storage and an ImageEncoder, so the same code can run in a Web Worker today
// and a Node worker on a server later.
//
//   catalogue search → SCL screening (cheap, 1 band) → sampling →
//   full processing in chronological order → change vs previous & baseline →
//   events
import { findAcquisitions, type Acquisition } from './catalog'
import { rasterizePolygon } from './geo'
import { detectEvents } from './detect'
import { syncNaip } from './naip'
import { compareRasters, computeProducts, type RasterLike } from './products'
import { historyStart, isUsable, MIN_COVERAGE_PCT, periodKey, pool, selectScenes } from './sampling'
import { coverageStats, loadAcquisitionBands, readMosaicBand } from './scene'
import type { SourceId } from './stac'
import { rasterKey, type ImageEncoder, type Storage } from './storage'
import { sceneId, sensorOf, type Area, type AreaSync, type IndexRaster, type SceneRecord } from './types'

export type SyncMode = 'backfill' | 'track'
export type SyncPhase = 'search' | 'screen' | 'process' | 'aerial' | 'finalize' | 'done'

export interface SyncProgress {
  phase: SyncPhase
  done: number
  total: number
  message: string
}

export interface SyncOptions {
  mode: SyncMode
  signal?: AbortSignal
  sources?: SourceId[]
  screenConcurrency?: number
  processConcurrency?: number
  onProgress?: (p: SyncProgress) => void
  /** Called after each scene record is stored (processed or not). */
  onScene?: (s: SceneRecord) => void
  now?: Date
}

export interface SyncResult {
  found: number
  processed: number
  rejected: number
  skipped: number
  warnings: string[]
}

const DAY = 86400_000

async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (signal?.aborted || attempt >= tries) throw e
      await new Promise((r) => setTimeout(r, 800 * attempt))
    }
  }
}

function toRaster(areaId: string, which: 'baseline' | 'latest', id: string, date: string, r: RasterLike): IndexRaster {
  return { key: rasterKey(areaId, which), areaId, sceneId: id, date, ...r }
}

export async function syncArea(areaId: string, storage: Storage, encoder: ImageEncoder, opts: SyncOptions): Promise<SyncResult> {
  const { signal } = opts
  const progress = (p: SyncProgress) => opts.onProgress?.(p)
  const now = opts.now ?? new Date()
  const loaded = await storage.getArea(areaId)
  if (!loaded) throw new Error(`Unknown area ${areaId}`)
  let area: Area = loaded
  // The UI may edit the area (rename, clear the unseen badge) while we run,
  // so re-read and patch only the sync state.
  const saveSync = async (patch: (s: AreaSync) => Partial<AreaSync>) => {
    const cur = (await storage.getArea(areaId)) ?? area
    area = { ...cur, sync: { ...cur.sync, ...patch(cur.sync) }, updatedAt: new Date().toISOString() }
    await storage.putArea(area)
  }

  // Only Sentinel-2 records take part in the catalogue/sampling/change chain.
  const existing = new Map((await storage.listScenes(areaId)).filter((s) => sensorOf(s) === 'sentinel-2').map((s) => [s.date, s]))
  const processedDates = [...existing.values()].filter((s) => s.status === 'processed').map((s) => s.date).sort()
  const latestProcessed = processedDates.at(-1)

  // Tracking re-checks a margin before the last check to catch scenes the
  // catalogues ingested late; already-known dates are skipped below.
  let start = historyStart(area.settings.historyDepth, now)
  if (opts.mode === 'track' && latestProcessed) {
    const from = Math.min(Date.parse(area.sync.lastCheckedAt ?? now.toISOString()), Date.parse(latestProcessed)) - 30 * DAY
    start = new Date(Math.max(from, Date.parse(start))).toISOString()
  }

  // 1. Search
  progress({ phase: 'search', done: 0, total: 1, message: 'Searching imagery catalogues…' })
  const cat = await withRetry(
    () => findAcquisitions({ aoi: area.geometry, epsg: area.grid.epsg, datetime: `${start}/..`, sources: opts.sources, maxSceneCloudPct: 95, signal }),
    signal,
  )
  const fresh = cat.acquisitions.filter((a) => !existing.has(a.date))
  const result: SyncResult = { found: fresh.length, processed: 0, rejected: 0, skipped: 0, warnings: cat.warnings }

  const record = (a: Acquisition, status: SceneRecord['status'], cloudPct: number, coveragePct: number, reason?: string): SceneRecord => ({
    id: sceneId(areaId, a.date),
    areaId,
    date: a.date,
    datetime: a.datetime,
    status,
    reason,
    sources: a.items.map((i) => ({ sourceId: i.sourceId, itemId: i.id, tile: i.tile })),
    cloudPct,
    coveragePct,
  })
  const store = async (recs: SceneRecord[]) => {
    if (!recs.length) return
    await storage.putScenes(recs)
    recs.forEach((r) => opts.onScene?.(r))
  }

  // Scenes older than the newest processed one can't join the chronological
  // change chain; record them so they aren't re-checked forever.
  const [stale, candidates] = fresh.reduce<[Acquisition[], Acquisition[]]>(
    (acc, a) => (acc[latestProcessed && a.date <= latestProcessed ? 0 : 1].push(a), acc),
    [[], []],
  )
  await store(stale.map((a) => record(a, 'skipped', NaN, NaN, 'Arrived after newer scenes were already processed')))
  result.skipped += stale.length

  // 2. Screen: polygon-level cloud & coverage from the SCL band alone.
  const mask = rasterizePolygon(area.geometry, area.grid)
  const polygonPx = mask.reduce((n, v) => n + v, 0)
  // Imagery is rendered for the whole grid (context around small areas);
  // stats and change detection use the polygon only.
  const viewMask = new Uint8Array(mask.length).fill(1)
  let screened = 0
  progress({ phase: 'screen', done: 0, total: candidates.length, message: `Checking cloud cover on ${candidates.length} scenes…` })
  const screenedAcqs = await pool(
    candidates,
    opts.screenConcurrency ?? 6,
    async (a) => {
      let cloudPct = 100, coveragePct = 0, error: string | undefined
      try {
        const scl = await withRetry(() => readMosaicBand(a.items, 'scl', area.grid, mask, signal), signal)
        const cov = coverageStats(scl, mask)
        cloudPct = cov.cloudPct
        coveragePct = cov.coveragePct
      } catch (e) {
        if (signal?.aborted) throw e
        error = e instanceof Error ? e.message : String(e)
      }
      screened++
      progress({ phase: 'screen', done: screened, total: candidates.length, message: `Checked cloud cover on ${screened} of ${candidates.length} scenes` })
      return { acq: a, date: a.date, cloudPct, coveragePct, error }
    },
    signal,
  )

  const rejected: SceneRecord[] = []
  const usable = screenedAcqs.filter((c) => {
    if (c.error) rejected.push(record(c.acq, 'rejected', c.cloudPct, c.coveragePct, `Could not read scene: ${c.error}`))
    else if (c.coveragePct < MIN_COVERAGE_PCT) rejected.push(record(c.acq, 'rejected', c.cloudPct, c.coveragePct, `Only ${c.coveragePct.toFixed(0)}% of the area imaged`))
    else if (!isUsable(c, area.settings.maxCloudPct)) rejected.push(record(c.acq, 'rejected', c.cloudPct, c.coveragePct, `${c.cloudPct.toFixed(0)}% cloud over the area`))
    else return true
    return false
  })
  await store(rejected)
  result.rejected += rejected.length

  // 3. Sampling (periods that already have a processed scene are skipped).
  const taken = new Set(processedDates.map((d) => periodKey(d, area.settings.sampling)))
  const selected = selectScenes(usable, area.settings.sampling, taken)
  const selectedSet = new Set(selected)
  const notSelected = usable.filter((u) => !selectedSet.has(u))
  await store(notSelected.map((c) => record(c.acq, 'skipped', c.cloudPct, c.coveragePct, 'A clearer scene was chosen for this period')))
  result.skipped += notSelected.length

  // 4. Process in chronological order. Downloads run concurrently, but change
  //    detection needs the previous scene, so results are committed in order.
  let baseline = await storage.getRaster(rasterKey(areaId, 'baseline'))
  let prev = await storage.getRaster(rasterKey(areaId, 'latest'))
  const limit = opts.processConcurrency ?? 3
  const total = selected.length
  progress({ phase: 'process', done: 0, total, message: total ? `Downloading and processing ${total} scenes…` : 'No new usable scenes' })

  const tasks: Promise<ReturnType<typeof computeProducts>>[] = []
  let started = 0
  const startNext = () => {
    if (started >= total) return
    const c = selected[started++]
    const t = withRetry(() => loadAcquisitionBands(c.acq.items, area.grid, mask, signal), signal).then((b) => computeProducts(b, mask, viewMask))
    t.catch(() => {}) // handled when committed
    tasks.push(t)
  }
  for (let i = 0; i < limit; i++) startNext()

  const { width, height } = area.grid
  let latestDate = latestProcessed
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    const c = selected[i]
    const id = sceneId(areaId, c.date)
    let products: Awaited<(typeof tasks)[number]>
    try {
      products = await tasks[i]
    } catch (e) {
      if (signal?.aborted) throw e
      await store([record(c.acq, 'rejected', c.cloudPct, c.coveragePct, `Download failed: ${e instanceof Error ? e.message : String(e)}`)])
      result.rejected++
      startNext()
      continue
    }
    startNext()

    const rec = record(c.acq, 'processed', c.cloudPct, c.coveragePct)
    rec.stats = { ...products.stats }
    const encodes: Promise<void>[] = [
      ...(['tc', 'ndvi', 'ndwi', 'ndbi'] as const).map(async (k) =>
        storage.putImage(id, k, await encoder.encode(products.images[k], width, height, 'photo')),
      ),
    ]
    if (prev) {
      const cmp = compareRasters(prev, products.raster, { comparedTo: prev.sceneId, comparedDate: prev.date, polygonPx })
      rec.stats.vsPrev = cmp.stats
      encodes.push(encoder.encode(cmp.rgba, width, height, 'overlay').then((b) => storage.putImage(id, 'chgPrev', b)))
    }
    if (baseline) {
      const cmp = compareRasters(baseline, products.raster, { comparedTo: baseline.sceneId, comparedDate: baseline.date, polygonPx })
      rec.stats.vsBaseline = cmp.stats
      encodes.push(encoder.encode(cmp.rgba, width, height, 'overlay').then((b) => storage.putImage(id, 'chgBase', b)))
    }
    await Promise.all(encodes)

    if (!baseline) {
      baseline = toRaster(areaId, 'baseline', id, c.date, products.raster)
      await storage.putRaster(baseline)
    }
    prev = toRaster(areaId, 'latest', id, c.date, products.raster)
    await storage.putRaster(prev)
    await store([rec])
    result.processed++
    latestDate = c.date
    const d = latestDate
    await saveSync((s) => ({ status: 'running', latestDate: d, unseen: s.unseen + (opts.mode === 'track' ? 1 : 0) }))
    progress({ phase: 'process', done: i + 1, total, message: `Processed ${i + 1} of ${total} scenes (latest: ${c.date})` })
  }

  // 5. High-resolution aerial imagery (US only). Independent of Sentinel-2,
  //    so a failure here is reported as a warning rather than failing the sync.
  try {
    await syncNaip(area, storage, encoder, {
      signal,
      onScene: (r) => opts.onScene?.(r),
      onProgress: (done, total, message) => progress({ phase: 'aerial', done, total, message }),
    })
  } catch (e) {
    if (signal?.aborted) throw e
    result.warnings.push(`Aerial imagery: ${e instanceof Error ? e.message : String(e)}`)
  }

  // 6. Events over the full history.
  progress({ phase: 'finalize', done: 0, total: 1, message: 'Detecting change events…' })
  const all = await storage.listScenes(areaId)
  await storage.replaceEvents(areaId, detectEvents(areaId, area.areaKm2, all))
  await saveSync(() => ({ status: 'idle', lastCheckedAt: now.toISOString(), latestDate, error: undefined }))
  progress({ phase: 'done', done: 1, total: 1, message: `Done: ${result.processed} new scenes processed` })
  return result
}
