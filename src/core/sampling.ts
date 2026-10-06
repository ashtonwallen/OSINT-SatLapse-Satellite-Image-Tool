import type { HistoryDepth, Sampling } from './types'

export interface Candidate {
  date: string
  cloudPct: number
  coveragePct: number
}

/** Minimum share of the polygon that must have data for a scene to be usable. */
export const MIN_COVERAGE_PCT = 90

export function periodKey(date: string, sampling: Sampling): string {
  if (sampling === 'month') return date.slice(0, 7)
  if (sampling === 'quarter') return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`
  return date
}

export function isUsable(c: Candidate, maxCloudPct: number): boolean {
  return c.coveragePct >= MIN_COVERAGE_PCT && c.cloudPct <= maxCloudPct
}

/**
 * Choose which usable candidates to process. For month/quarter sampling the
 * clearest scene in each period wins (ties: better coverage, then later date).
 * Periods listed in `takenPeriods` already have a processed scene and are skipped.
 */
export function selectScenes<T extends Candidate>(cands: T[], sampling: Sampling, takenPeriods: Set<string> = new Set()): T[] {
  if (sampling === 'all') return cands.filter((c) => !takenPeriods.has(c.date))
  const best = new Map<string, T>()
  for (const c of cands) {
    const k = periodKey(c.date, sampling)
    if (takenPeriods.has(k)) continue
    const cur = best.get(k)
    if (!cur || c.cloudPct < cur.cloudPct - 0.5 || (Math.abs(c.cloudPct - cur.cloudPct) <= 0.5 && c.coveragePct > cur.coveragePct)) {
      best.set(k, c)
    }
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function historyStart(depth: HistoryDepth, now = new Date()): string {
  if (depth === 'all') return '2015-06-01T00:00:00Z'
  const years = depth === '1y' ? 1 : 3
  const d = new Date(now)
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d.toISOString()
}

/** Run async tasks with bounded concurrency, preserving result order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
