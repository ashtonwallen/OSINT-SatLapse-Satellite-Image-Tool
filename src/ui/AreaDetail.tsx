import {
  ChevronDown, ChevronLeft, Droplets, Image, Leaf, LocateFixed, Pause, Pencil, Play, RefreshCw,
  StepBack, StepForward, Trash, TriangleAlert, Building, X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { gridCornersLngLat } from '../core/geo'
import type { Area, ChangeStats, ImageKind, SceneRecord } from '../core/types'
import { deleteArea, markSeen, renameArea } from '../app/actions'
import { engine } from '../app/engineClient'
import { useAreaData, useImageCache, useProgress } from '../app/hooks'
import { Button, IconButton, Section, Segmented, fmtDate, relativeDays } from './kit'
import type { ChangeView, HudState, View } from './MapHud'
import type { FrameOverlay } from './MapView'
import { Timeline } from './Timeline'

export interface FrameState { overlays: FrameOverlay[]; hud: HudState | null }

interface Props {
  area: Area
  onBack(): void
  onFrame(f: FrameState): void
  onFit(): void
}

const PHASES = ['search', 'screen', 'process', 'finalize'] as const
const PHASE_LABEL = { search: 'Search', screen: 'Cloud check', process: 'Download', finalize: 'Analyse' }

const sensorLabel = (s: SceneRecord) => {
  const id = s.sources[0]?.itemId ?? ''
  const sat = /^S2([ABC])/.exec(id)?.[1] ?? /S2([ABC])_MSI/.exec(id)?.[1]
  return `Sentinel-2${sat ?? ''} · 10 m`
}

export function AreaDetail({ area, onBack, onFrame, onFit }: Props) {
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
  const [opacity, setOpacity] = useState(1)
  const [renaming, setRenaming] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const running = area.sync.status === 'running' || area.sync.status === 'queued' || !!progress

  useEffect(() => { void markSeen(area) }, [area.id, area.sync.unseen])
  useEffect(() => { if (follow && frames.length) setIdx(frames.length - 1) }, [frames.length, follow])

  const go = (i: number) => { setIdx(i); setFollow(false); setPlaying(false) }
  const step = (d: number) => frames.length && go((idx + d + frames.length) % frames.length)

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const t = setInterval(() => setIdx((i) => (i + 1) % frames.length), 1000 / fps)
    return () => clearInterval(t)
  }, [playing, fps, frames.length])

  // Keyboard: space play/pause, arrows step (unless typing).
  const stepRef = useRef(step)
  stepRef.current = step
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [role=slider]') || e.metaKey || e.ctrlKey) return
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); setFollow(false) }
      if (e.key === 'ArrowLeft') stepRef.current(-1)
      if (e.key === 'ArrowRight') stepRef.current(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const frame = frames[Math.min(idx, frames.length - 1)]
  const st = frame?.stats
  const cmp: ChangeStats | undefined = change === 'chgBase' ? st?.vsBaseline : change === 'chgPrev' ? st?.vsPrev : undefined

  // Push the current frame (and optional change overlay) to the map.
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  useEffect(() => {
    if (!frame) { onFrameRef.current({ overlays: [], hud: null }); return }
    let cancelled = false
    const kinds: ImageKind[] = change === 'none' ? [view] : [view, change]
    void Promise.all(kinds.map((k) => cache.get(frame.id, k))).then((urls) => {
      if (cancelled) return
      onFrameRef.current({
        overlays: urls.flatMap((url, i) => (url ? [{ url, corners, opacity: i === 0 ? opacity : Math.max(0.6, opacity) }] : [])),
        hud: { date: frame.date, view, change, comparedDate: cmp?.comparedDate, sensor: sensorLabel(frame), index: idx, count: frames.length },
      })
    })
    for (let k = 1; k <= 3; k++) {
      const next = frames[(idx + k) % frames.length]
      if (next) kinds.forEach((kind) => void cache.get(next.id, kind))
    }
    return () => { cancelled = true }
  }, [frame, view, change, opacity, corners, cache, frames, idx, cmp?.comparedDate])
  useEffect(() => () => onFrameRef.current({ overlays: [], hud: null }), [])

  const baseline = frames[0]?.stats
  const frameEvents = events.filter((e) => e.sceneId === frame?.id)

  async function remove() {
    if (!confirm(`Delete "${area.name}" and all its processed imagery from this browser? This can't be undone.`)) return
    await deleteArea(area.id)
    onBack()
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start gap-1">
        <IconButton label="Back to all areas" onClick={onBack}><ChevronLeft size={18} /></IconButton>
        <div className="min-w-0 flex-1 pt-0.5">
          {renaming ? (
            <form onSubmit={(e) => { e.preventDefault(); void renameArea(area.id, new FormData(e.currentTarget).get('name') as string); setRenaming(false) }}>
              <input name="name" autoFocus defaultValue={area.name} onBlur={(e) => { void renameArea(area.id, e.target.value); setRenaming(false) }}
                onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
                className="w-full rounded border border-accent bg-panel px-2 py-0.5 text-lg font-semibold outline-none" />
            </form>
          ) : (
            <button onClick={() => setRenaming(true)} className="group flex max-w-full items-center gap-1.5 text-left" title="Rename">
              <h2 className="truncate text-lg font-semibold leading-tight">{area.name}</h2>
              <Pencil size={13} className="shrink-0 text-neutral-500 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          <p className="mt-0.5 text-xs text-neutral-400">
            {area.areaKm2 < 1 ? `${(area.areaKm2 * 100).toFixed(0)} ha` : `${area.areaKm2.toFixed(1)} km²`} ·{' '}
            {area.settings.historyDepth === 'all' ? 'full history' : `${area.settings.historyDepth.replace('y', '')}-year history`} ·{' '}
            {area.settings.sampling === 'all' ? 'every clear scene' : `best per ${area.settings.sampling}`}
          </p>
        </div>
        <IconButton label="Zoom to area" onClick={onFit}><LocateFixed size={16} /></IconButton>
      </div>

      {/* Sync status */}
      {running && (
        <Section>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium">
              <RefreshCw size={14} className="animate-spin text-accent" />
              {area.sync.lastCheckedAt ? 'Checking for new imagery' : 'Building history'}
            </span>
            <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => engine.cancel(area.id)}><X size={12} /> Stop</Button>
          </div>
          <ol className="mb-2 grid grid-cols-4 gap-1">
            {PHASES.map((p) => {
              const cur = progress ? PHASES.indexOf(progress.phase as (typeof PHASES)[number]) : -1
              const i = PHASES.indexOf(p)
              return (
                <li key={p} className="space-y-1">
                  <div className={`h-1 rounded-full ${i < cur ? 'bg-accent' : i === cur ? 'bg-accent/60' : 'bg-neutral-800'}`}>
                    {i === cur && progress?.total ? <div className="h-1 rounded-full bg-accent" style={{ width: `${(100 * progress.done) / progress.total}%` }} /> : null}
                  </div>
                  <div className={`text-[10px] ${i === cur ? 'text-neutral-200' : 'text-neutral-500'}`}>{PHASE_LABEL[p]}</div>
                </li>
              )
            })}
          </ol>
          <p className="text-xs text-neutral-300">{progress?.message ?? 'Waiting for another area to finish…'}</p>
          <p className="mt-1 text-[11px] text-neutral-500">Runs in the background. If you close the tab it resumes next time.</p>
        </Section>
      )}
      {!running && area.sync.status === 'error' && (
        <div className="flex gap-2 rounded-lg border border-red-900/70 bg-red-950/40 p-3 text-xs text-red-200">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Last update failed</p>
            <p className="text-red-300/80">{area.sync.error}</p>
            <Button variant="ghost" className="mt-1 !px-0 text-xs text-red-200" onClick={() => engine.sync(area.id, area.sync.lastCheckedAt ? 'track' : 'backfill')}>Try again</Button>
          </div>
        </div>
      )}

      {/* Player */}
      {frame ? (
        <Section>
          <div className="mb-1 flex items-end justify-between gap-2">
            <div>
              <div className="font-mono text-xl font-semibold leading-none text-white">{fmtDate(frame.date, 'short')}</div>
              <div className="mt-1 text-[11px] text-neutral-400">{relativeDays(frame.date)} · {frame.cloudPct.toFixed(0)}% cloud over area</div>
            </div>
            <div className="flex items-center">
              <IconButton label="Previous scene (←)" onClick={() => step(-1)}><StepBack size={16} /></IconButton>
              <button
                onClick={() => { setPlaying((p) => !p); setFollow(false) }}
                aria-label={playing ? 'Pause (space)' : 'Play (space)'}
                title={playing ? 'Pause (space)' : 'Play (space)'}
                className="mx-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent text-black hover:bg-accent-strong"
              >
                {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
              </button>
              <IconButton label="Next scene (→)" onClick={() => step(1)}><StepForward size={16} /></IconButton>
            </div>
          </div>
          <Timeline frames={frames} index={Math.min(idx, frames.length - 1)} events={events} onChange={go} />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[11px] text-neutral-500">{frames.length} scenes</span>
            <div className="w-40">
              <Segmented<number> label="Playback speed" size="xs" value={fps} onChange={setFps}
                options={[0.5, 1, 2, 4, 8].map((f) => ({ value: f, label: `${f}×` }))} />
            </div>
          </div>
        </Section>
      ) : !running && (
        <Section>
          <p className="text-sm text-neutral-300">No usable scenes yet.</p>
          <p className="mt-1 text-xs text-neutral-500">
            {counts.rejected > 0 ? `${counts.rejected} scenes were too cloudy or incomplete. ` : ''}Try a longer history or a higher cloud limit.
          </p>
        </Section>
      )}

      {/* Layers */}
      {frame && (
        <Section title="Layer">
          <div className="grid grid-cols-4 gap-1">
            {([
              { v: 'tc', label: 'Photo', icon: Image },
              { v: 'ndvi', label: 'Vegetation', icon: Leaf },
              { v: 'ndwi', label: 'Water', icon: Droplets },
              { v: 'ndbi', label: 'Built & bare', icon: Building },
            ] as const).map(({ v, label, icon: Icon }) => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                className={`flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px] transition-colors ${
                  view === v ? 'border-accent bg-accent/10 text-white' : 'border-line text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'}`}>
                <Icon size={16} />{label}
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-1">
            <div className="text-[11px] text-neutral-400">Highlight change</div>
            <Segmented<ChangeView> label="Change overlay" value={change} onChange={setChange} options={[
              { value: 'none', label: 'Off' },
              { value: 'chgPrev', label: 'Since previous', title: 'Compare with the previous scene' },
              { value: 'chgBase', label: 'Since first', title: `Compare with the first scene (${frames[0] ? fmtDate(frames[0].date, 'short') : ''})` },
            ]} />
          </div>
          <label className="mt-3 flex items-center gap-2 text-[11px] text-neutral-400">
            Opacity
            <input type="range" className="range flex-1" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="Frame opacity" />
            <span className="w-8 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
          </label>
        </Section>
      )}

      {/* Stats */}
      {st && (
        <Section title="Land cover in your area" aside={baseline && frame !== frames[0] && <span className="text-[10px] text-neutral-500">vs {fmtDate(frames[0].date, 'short')}</span>}>
          <dl className="grid grid-cols-3 gap-2">
            {([
              { k: 'vegPct', label: 'Vegetation', color: 'text-green-400' },
              { k: 'waterPct', label: 'Water', color: 'text-sky-400' },
              { k: 'builtPct', label: 'Built & bare', color: 'text-fuchsia-400' },
            ] as const).map(({ k, label, color }) => {
              const d = baseline && frame !== frames[0] ? st[k] - baseline[k] : null
              return (
                <div key={k} className="rounded-md bg-panel p-2">
                  <dt className="text-[10px] text-neutral-400">{label}</dt>
                  <dd className={`text-lg font-semibold tabular-nums ${color}`}>{st[k].toFixed(1)}%</dd>
                  {d !== null && (
                    <dd className={`text-[10px] tabular-nums ${Math.abs(d) < 0.5 ? 'text-neutral-500' : d > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {d > 0 ? '+' : ''}{d.toFixed(1)} pts
                    </dd>
                  )}
                </div>
              )
            })}
          </dl>
          {cmp && (
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
              Since {fmtDate(cmp.comparedDate, 'short')}: <b className="font-medium text-neutral-200">{cmp.changedPct.toFixed(1)}%</b> of the area changed
              {cmp.vegLossPct >= 0.5 && <> · <span className="text-red-400">veg loss {cmp.vegLossPct.toFixed(1)}%</span></>}
              {cmp.vegGainPct >= 0.5 && <> · <span className="text-green-400">veg gain {cmp.vegGainPct.toFixed(1)}%</span></>}
              {cmp.waterGainPct >= 0.5 && <> · <span className="text-blue-400">new water {cmp.waterGainPct.toFixed(1)}%</span></>}
              {cmp.waterLossPct >= 0.5 && <> · <span className="text-amber-400">water lost {cmp.waterLossPct.toFixed(1)}%</span></>}
              {cmp.builtGainPct >= 0.5 && <> · <span className="text-fuchsia-400">new built/bare {cmp.builtGainPct.toFixed(1)}%</span></>}
            </p>
          )}
        </Section>
      )}

      {/* Events on this frame */}
      {frameEvents.length > 0 && (
        <Section title="Flagged on this date">
          <ul className="space-y-2">
            {frameEvents.map((e) => (
              <li key={e.id} className={`text-xs ${e.recurring ? 'opacity-70' : ''}`}>
                <div className="font-medium text-amber-200">{e.title}{e.recurring && <span className="ml-1 font-normal text-neutral-400">(likely seasonal)</span>}</div>
                <div className="text-neutral-400">{e.description}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Details + actions */}
      <div className="rounded-lg border border-line">
        <button onClick={() => setShowDetails((s) => !s)} className="flex w-full items-center justify-between px-3 py-2 text-xs text-neutral-400 hover:text-neutral-200">
          Scene & area details <ChevronDown size={14} className={`transition-transform ${showDetails ? 'rotate-180' : ''}`} />
        </button>
        {showDetails && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-[11px]">
            {frame && <>
              <dt className="text-neutral-500">Source</dt><dd className="break-all text-neutral-300">{frame.sources.map((s) => `${s.sourceId} · ${s.itemId}`).join(', ')}</dd>
              <dt className="text-neutral-500">Cloud / coverage</dt><dd className="text-neutral-300">{frame.cloudPct.toFixed(1)}% / {frame.coveragePct.toFixed(0)}%</dd>
            </>}
            <dt className="text-neutral-500">Scenes</dt><dd className="text-neutral-300">{frames.length} processed · {counts.rejected} too cloudy/incomplete · {counts.skipped} skipped by sampling</dd>
            <dt className="text-neutral-500">Grid</dt><dd className="text-neutral-300">{area.grid.width}×{area.grid.height} px at {area.grid.res} m · EPSG:{area.grid.epsg}</dd>
            <dt className="text-neutral-500">Cloud limit</dt><dd className="text-neutral-300">{area.settings.maxCloudPct}% over the area</dd>
            {area.sync.lastCheckedAt && <><dt className="text-neutral-500">Last checked</dt><dd className="text-neutral-300">{new Date(area.sync.lastCheckedAt).toLocaleString()}</dd></>}
          </dl>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-2">
        {!area.example && (
          <Button disabled={running} onClick={() => engine.sync(area.id, area.sync.lastCheckedAt ? 'track' : 'backfill')} className="text-xs">
            <RefreshCw size={13} /> Check for new imagery
          </Button>
        )}
        <Button variant="danger" onClick={remove} className="ml-auto text-xs"><Trash size={13} /> Delete</Button>
      </div>
    </div>
  )
}
