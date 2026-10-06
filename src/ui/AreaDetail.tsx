import { useEffect, useMemo, useRef, useState } from 'react'
import { copernicusAttribution } from '../core/attribution'
import { gridCornersLngLat } from '../core/geo'
import type { Area, ImageKind } from '../core/types'
import { deleteArea, markSeen } from '../app/actions'
import { engine } from '../app/engineClient'
import { useAreaData, useImageCache, useProgress } from '../app/hooks'
import type { FrameOverlay } from './MapView'

type View = 'tc' | 'ndvi' | 'ndwi' | 'ndbi'
type ChangeView = 'none' | 'chgPrev' | 'chgBase'

const VIEWS: { v: View; label: string }[] = [
  { v: 'tc', label: 'True colour' },
  { v: 'ndvi', label: 'Vegetation (NDVI)' },
  { v: 'ndwi', label: 'Water (NDWI)' },
  { v: 'ndbi', label: 'Built-up & bare (NDBI)' },
]

interface Props {
  area: Area
  onBack(): void
  onOverlays(o: FrameOverlay[]): void
}

export function AreaDetail({ area, onBack, onOverlays }: Props) {
  const { scenes, events } = useAreaData(area.id)
  const progress = useProgress(area.id)
  const cache = useImageCache(area.id)
  const frames = useMemo(() => scenes.filter((s) => s.status === 'processed'), [scenes])
  const counts = useMemo(() => ({
    rejected: scenes.filter((s) => s.status === 'rejected').length,
    skipped: scenes.filter((s) => s.status === 'skipped').length,
  }), [scenes])
  const corners = useMemo(() => gridCornersLngLat(area.grid), [area.grid])

  const [idx, setIdx] = useState(0)
  const [follow, setFollow] = useState(true) // stick to the newest frame while backfilling
  const [playing, setPlaying] = useState(false)
  const [fps, setFps] = useState(2)
  const [view, setView] = useState<View>('tc')
  const [change, setChange] = useState<ChangeView>('none')
  const running = area.sync.status === 'running' || area.sync.status === 'queued' || !!progress

  useEffect(() => { void markSeen(area) }, [area.id, area.sync.unseen])
  useEffect(() => { if (follow && frames.length) setIdx(frames.length - 1) }, [frames.length, follow])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const t = setInterval(() => setIdx((i) => (i + 1) % frames.length), 1000 / fps)
    return () => clearInterval(t)
  }, [playing, fps, frames.length])

  // Push the current frame (and optional change overlay) to the map.
  const frame = frames[Math.min(idx, frames.length - 1)]
  const onOverlaysRef = useRef(onOverlays)
  onOverlaysRef.current = onOverlays
  useEffect(() => {
    if (!frame) { onOverlaysRef.current([]); return }
    let cancelled = false
    const kinds: ImageKind[] = change === 'none' ? [view] : [view, change]
    void Promise.all(kinds.map((k) => cache.get(frame.id, k))).then((urls) => {
      if (cancelled) return
      onOverlaysRef.current(urls.flatMap((url, i) => (url ? [{ url, corners, opacity: i === 0 ? 1 : 0.9 }] : [])))
    })
    // Preload the next few frames for smooth playback.
    for (let k = 1; k <= 3; k++) {
      const next = frames[(idx + k) % frames.length]
      if (next) kinds.forEach((kind) => void cache.get(next.id, kind))
    }
    return () => { cancelled = true }
  }, [frame, view, change, corners, cache, frames, idx])
  useEffect(() => () => onOverlaysRef.current([]), [])

  const st = frame?.stats
  const cmp = change === 'chgBase' ? st?.vsBaseline : st?.vsPrev
  const frameEvents = events.filter((e) => e.sceneId === frame?.id)

  async function remove() {
    if (!confirm(`Delete "${area.name}" and all its processed imagery from this browser?`)) return
    await deleteArea(area.id)
    onBack()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <button onClick={onBack} className="rounded px-2 py-1 text-neutral-400 hover:bg-neutral-800" aria-label="Back to areas">←</button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{area.name}</h2>
          <p className="text-xs text-neutral-400">
            {area.areaKm2.toFixed(1)} km² · {area.grid.res} m pixels · history {area.settings.historyDepth} · {area.settings.sampling === 'all' ? 'every scene' : `best per ${area.settings.sampling}`}
          </p>
        </div>
      </div>

      {(running || area.sync.status === 'error') && (
        <div className="rounded-md bg-neutral-900 p-3 text-sm">
          {area.sync.status === 'error' && !running ? (
            <p className="text-red-400">Last sync failed: {area.sync.error}</p>
          ) : (
            <>
              <div className="flex justify-between text-xs text-neutral-300">
                <span>{progress?.message ?? 'Waiting in queue…'}</span>
                <button onClick={() => engine.cancel(area.id)} className="text-neutral-400 hover:text-white">Stop</button>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-neutral-800">
                <div className="h-full bg-sky-500 transition-all" style={{ width: `${progress && progress.total ? (100 * progress.done) / progress.total : 3}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">Runs in the background; you can keep using the app. Closing the tab pauses it and it resumes next time.</p>
            </>
          )}
        </div>
      )}

      <p className="text-xs text-neutral-400">
        {frames.length} scenes processed · {counts.rejected} too cloudy or incomplete · {counts.skipped} skipped by sampling
        {area.sync.lastCheckedAt && ` · last checked ${new Date(area.sync.lastCheckedAt).toLocaleString()}`}
      </p>

      {frames.length > 0 && frame && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => { setPlaying((p) => !p); setFollow(false) }} className="w-20 rounded-md bg-sky-600 py-1.5 text-sm font-medium hover:bg-sky-500">
              {playing ? 'Pause' : 'Play'}
            </button>
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className="rounded-md bg-neutral-800 px-2 py-1.5 text-sm" aria-label="Playback speed">
              {[0.5, 1, 2, 4, 8].map((f) => <option key={f} value={f}>{f} fps</option>)}
            </select>
            <span className="ml-auto font-mono text-sm">{frame.date}</span>
          </div>
          <input
            type="range" min={0} max={frames.length - 1} value={Math.min(idx, frames.length - 1)}
            onChange={(e) => { setIdx(Number(e.target.value)); setFollow(false); setPlaying(false) }}
            className="w-full" aria-label="Scene date"
          />
          <div className="flex justify-between text-[11px] text-neutral-500">
            <span>{frames[0].date}</span><span>{idx + 1} / {frames.length}</span><span>{frames.at(-1)!.date}</span>
          </div>

          <div className="grid grid-cols-2 gap-1">
            {VIEWS.map((v) => (
              <button key={v.v} onClick={() => setView(v.v)} className={`rounded-md px-2 py-1 text-xs ${view === v.v ? 'bg-neutral-200 text-black' : 'bg-neutral-800 hover:bg-neutral-700'}`}>
                {v.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs">
            Change overlay
            <select value={change} onChange={(e) => setChange(e.target.value as ChangeView)} className="rounded bg-neutral-800 px-2 py-1">
              <option value="none">Off</option>
              <option value="chgPrev">vs previous scene</option>
              <option value="chgBase">vs baseline ({frames[0].date})</option>
            </select>
          </label>

          {st && (
            <dl className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded bg-neutral-900 p-2"><dt className="text-neutral-400">Vegetation</dt><dd className="text-base text-green-400">{st.vegPct.toFixed(1)}%</dd></div>
              <div className="rounded bg-neutral-900 p-2"><dt className="text-neutral-400">Water</dt><dd className="text-base text-sky-400">{st.waterPct.toFixed(1)}%</dd></div>
              <div className="rounded bg-neutral-900 p-2"><dt className="text-neutral-400">Built & bare</dt><dd className="text-base text-fuchsia-400">{st.builtPct.toFixed(1)}%</dd></div>
            </dl>
          )}
          <p className="text-[11px] text-neutral-500">
            Cloud over area {frame.cloudPct.toFixed(1)}% · source {frame.sources.map((s) => `${s.sourceId} ${s.tile ?? ''}`).join(', ')}
          </p>
          {change !== 'none' && cmp && (
            <p className="text-xs text-neutral-300">
              vs {cmp.comparedDate}: <span className="text-red-400">−veg {cmp.vegLossPct.toFixed(1)}%</span> · <span className="text-green-400">+veg {cmp.vegGainPct.toFixed(1)}%</span> ·{' '}
              <span className="text-blue-400">+water {cmp.waterGainPct.toFixed(1)}%</span> · <span className="text-amber-400">−water {cmp.waterLossPct.toFixed(1)}%</span> ·{' '}
              <span className="text-fuchsia-400">+built {cmp.builtGainPct.toFixed(1)}%</span>
            </p>
          )}
          {frameEvents.map((e) => (
            <div key={e.id} className="rounded-md border border-amber-900 bg-amber-950/40 p-2 text-xs">
              <strong className="text-amber-300">{e.title}</strong> <span className="text-neutral-300">{e.description}</span>
            </div>
          ))}
        </section>
      )}

      {!running && frames.length === 0 && area.sync.lastCheckedAt && (
        <p className="text-sm text-neutral-400">No usable scenes yet. Try a longer history or a higher cloud limit.</p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-neutral-800 pt-3 text-xs">
        {!area.example && (
          <button disabled={running} onClick={() => engine.sync(area.id, area.sync.lastCheckedAt ? 'track' : 'backfill')} className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40">
            Check for new imagery
          </button>
        )}
        <button onClick={remove} className="rounded bg-neutral-800 px-2 py-1 text-red-300 hover:bg-red-950">Delete area</button>
      </div>
      {frame && <p className="text-[11px] text-neutral-500">{copernicusAttribution(Number(frame.date.slice(0, 4)))}</p>}
    </div>
  )
}
