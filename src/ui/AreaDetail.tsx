import {
  ChevronDown, ChevronLeft, Droplets, Image, Leaf, LocateFixed, Pause, Pencil, Play, RefreshCw,
  StepBack, StepForward, Trash, TriangleAlert, Building, X, Columns2, Film,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { copernicusAttribution } from '../core/attribution'
import { gridCornersLngLat } from '../core/geo'
import { DATA_SOURCES } from '../core/sources'
import { sensorOf, type Area, type ChangeEvent, type ChangeStats, type Confidence, type ImageKind, type SceneRecord } from '../core/types'
import { deleteArea, markSeen, renameArea } from '../app/actions'
import { engine } from '../app/engineClient'
import { useAreaData, useImageCache, useProgress } from '../app/hooks'
import { Button, IconButton, Section, Segmented, fmtDate, relativeDays } from './kit'
import type { CompareState } from './CompareOverlay'
import { ExportPanel } from './ExportPanel'
import type { ChangeView, HudState, View } from './MapHud'
import { SERIES, SeriesChart } from './SeriesChart'
import type { FrameOverlay } from './MapView'
import { Timeline } from './Timeline'

const EVENT_DOT: Record<ChangeEvent['kind'], string> = {
  veg_loss: '#ef4444', veg_gain: '#22c55e', water_gain: '#3b82f6', water_loss: '#f59e0b', built_gain: '#d946ef',
}

function ConfidencePill({ c }: { c: Confidence }) {
  const cls = c === 'high' ? 'bg-emerald-500/15 text-emerald-300' : c === 'medium' ? 'bg-amber-500/15 text-amber-300' : 'bg-neutral-700/60 text-neutral-400'
  return <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${cls}`} title={CONFIDENCE_HELP[c]}>{c}</span>
}
const CONFIDENCE_HELP: Record<Confidence, string> = {
  high: 'Departs from the same season in 3+ earlier years, and the next image confirms it',
  medium: 'Departs from the same season in 2 earlier years, or not yet confirmed by a later image',
  low: 'Compared with the previous image only (not enough history), or not confirmed by the next image',
}

export interface FrameState { overlays: FrameOverlay[]; hud: HudState | null; compare?: CompareState | null }

interface Props {
  area: Area
  onBack(): void
  onFrame(f: FrameState): void
  onFit(): void
}

const PHASES = ['search', 'screen', 'process', 'aerial', 'finalize'] as const
const PHASE_LABEL = { search: 'Search', screen: 'Cloud check', process: 'Satellite', aerial: 'Aerial', finalize: 'Analyse' }

type Collection = 'satellite' | 'aerial'

const sensorLabel = (s: SceneRecord) => {
  if (sensorOf(s) === 'naip') return `NAIP aerial · ${s.gsd ?? 1} m`
  const id = s.sources[0]?.itemId ?? ''
  const sat = /^S2([ABC])/.exec(id)?.[1] ?? /S2([ABC])_MSI/.exec(id)?.[1]
  return `Sentinel-2${sat ?? ''} · 10 m`
}

const attributionFor = (fs: SceneRecord[]) =>
  fs.some((f) => sensorOf(f) === 'naip')
    ? DATA_SOURCES.find((d) => d.id === 'pc-naip')!.attribution
    : copernicusAttribution(fs.map((f) => Number(f.date.slice(0, 4))))

export function AreaDetail({ area, onBack, onFrame, onFit }: Props) {
  const { scenes, events } = useAreaData(area.id)
  const progress = useProgress(area.id)
  const cache = useImageCache(area.id)
  const s2Frames = useMemo(() => scenes.filter((s) => s.status === 'processed' && sensorOf(s) === 'sentinel-2'), [scenes])
  const aerialFrames = useMemo(() => scenes.filter((s) => s.status === 'processed' && sensorOf(s) === 'naip'), [scenes])
  const [collection, setCollection] = useState<Collection>('satellite')
  const aerial = collection === 'aerial' && aerialFrames.length > 0
  const frames = aerial ? aerialFrames : s2Frames
  const counts = useMemo(() => {
    const s2 = scenes.filter((s) => sensorOf(s) === 'sentinel-2')
    return { rejected: s2.filter((s) => s.status === 'rejected').length, skipped: s2.filter((s) => s.status === 'skipped').length }
  }, [scenes])
  const areaCorners = useMemo(() => gridCornersLngLat(area.grid), [area.grid])

  const [idx, setIdx] = useState(0)
  const [follow, setFollow] = useState(true) // stick to the newest frame while backfilling
  const [playing, setPlaying] = useState(false)
  const [fps, setFps] = useState(2)
  const [view, setView] = useState<View>('tc')
  const [change, setChange] = useState<ChangeView>('none')
  const [opacity, setOpacity] = useState(1)
  const [renaming, setRenaming] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [beforeIdx, setBeforeIdx] = useState(0)
  const [exporting, setExporting] = useState(false)
  const running = area.sync.status === 'running' || area.sync.status === 'queued' || !!progress

  useEffect(() => { void markSeen(area) }, [area.id, area.sync.unseen])
  useEffect(() => { if (follow && frames.length) setIdx(frames.length - 1) }, [frames.length, follow])

  const go = (i: number) => { setIdx(i); setFollow(false); setPlaying(false) }
  const switchCollection = (c: Collection) => {
    setCollection(c)
    setPlaying(false)
    setFollow(true)
    setBeforeIdx(0)
    if (c === 'aerial') { setChange('none'); setView((v) => (v === 'ndvi' ? v : 'tc')) }
  }
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
  // Aerial frames have their own, much finer grid.
  const corners = useMemo(() => (frame?.grid ? gridCornersLngLat(frame.grid) : areaCorners), [frame?.grid, areaCorners])
  const st = frame?.stats
  const cmp: ChangeStats | undefined = change === 'chgBase' ? st?.vsBaseline : change === 'chgPrev' ? st?.vsPrev : undefined

  // Push the current frame (and optional change overlay) to the map.
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  useEffect(() => {
    if (!frame) { onFrameRef.current({ overlays: [], hud: null }); return }
    let cancelled = false
    const before = frames[Math.min(beforeIdx, frames.length - 1)]
    if (comparing && before && before.id !== frame.id) {
      void Promise.all([cache.get(before.id, view), cache.get(frame.id, view)]).then(([a, b]) => {
        if (cancelled || !a || !b) return
        const side = (f: SceneRecord, url: string) => ({ url, date: f.date, label: sensorLabel(f), corners: f.grid ? gridCornersLngLat(f.grid) : areaCorners })
        onFrameRef.current({ overlays: [], hud: null, compare: { before: side(before, a), after: side(frame, b), pixelated: !aerial } })
      })
      return () => { cancelled = true }
    }
    const kinds: ImageKind[] = change === 'none' ? [view] : [view, change]
    void Promise.all(kinds.map((k) => cache.get(frame.id, k))).then((urls) => {
      if (cancelled) return
      onFrameRef.current({
        overlays: urls.flatMap((url, i) => (url ? [{ url, corners, opacity: i === 0 ? opacity : Math.max(0.6, opacity), smooth: aerial }] : [])),
        hud: { date: frame.date, view, change, comparedDate: cmp?.comparedDate, sensor: sensorLabel(frame),
          attribution: attributionFor([frame]),
          index: idx, count: frames.length },
      })
    })
    for (let k = 1; k <= 3; k++) {
      const next = frames[(idx + k) % frames.length]
      if (next) kinds.forEach((kind) => void cache.get(next.id, kind))
    }
    return () => { cancelled = true }
  }, [frame, view, change, opacity, corners, cache, frames, idx, cmp?.comparedDate, aerial, comparing, beforeIdx, areaCorners])
  useEffect(() => () => onFrameRef.current({ overlays: [], hud: null }), [])

  const baseline = s2Frames[0]?.stats
  const [eventFilter, setEventFilter] = useState<'confident' | 'all'>('confident')
  const shownEvents = eventFilter === 'all' ? events : events.filter((e) => e.confidence === 'high' || e.confidence === 'medium')

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
          <ol className="mb-2 grid grid-cols-5 gap-1">
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
          {aerialFrames.length > 0 && (
            <div className="mb-3">
              <Segmented<Collection> label="Imagery" value={collection} onChange={switchCollection} options={[
                { value: 'satellite', label: <>Satellite · 10 m <span className="opacity-60">({s2Frames.length})</span></>, title: 'Sentinel-2: every few days, 10 m' },
                { value: 'aerial', label: <>Aerial · {Math.min(...aerialFrames.map((f) => f.gsd ?? 1))} m <span className="opacity-60">({aerialFrames.length})</span></>, title: 'NAIP aerial photos: every 2–3 years, US only' },
              ]} />
            </div>
          )}
          <div className="mb-1 flex items-end justify-between gap-2">
            <div>
              <div className="font-mono text-xl font-semibold leading-none text-white">{fmtDate(frame.date, 'short')}</div>
              <div className="mt-1 text-[11px] text-neutral-400">{relativeDays(frame.date)} · {aerial ? sensorLabel(frame) : `${frame.cloudPct.toFixed(0)}% cloud over area`}</div>
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
          <Timeline frames={frames} index={Math.min(idx, frames.length - 1)} events={aerial ? [] : shownEvents} onChange={go} />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[11px] text-neutral-500">{frames.length} scenes</span>
            <div className="w-40">
              <Segmented<number> label="Playback speed" size="xs" value={fps} onChange={setFps}
                options={[0.5, 1, 2, 4, 8].map((f) => ({ value: f, label: `${f}×` }))} />
            </div>
          </div>
          <div className="mt-3 flex gap-2 border-t border-line pt-3">
            <Button className={`flex-1 text-xs ${comparing ? '!border-accent !bg-accent/10' : ''}`} disabled={frames.length < 2}
              onClick={() => { setComparing((c) => !c); setPlaying(false) }} aria-pressed={comparing}>
              <Columns2 size={13} /> {comparing ? 'Stop comparing' : 'Compare dates'}
            </Button>
            <Button className="flex-1 text-xs" disabled={frames.length < 2} onClick={() => setExporting((x) => !x)} aria-pressed={exporting}>
              <Film size={13} /> Export
            </Button>
          </div>
          {comparing && (
            <div className="mt-2 rounded-md bg-panel p-2 text-[11px] text-neutral-400">
              <label className="flex items-center gap-2">
                Before
                <select value={Math.min(beforeIdx, frames.length - 1)} onChange={(e) => setBeforeIdx(Number(e.target.value))}
                  className="flex-1 rounded border border-line bg-panel-2 px-2 py-1 font-mono text-xs text-neutral-200">
                  {frames.map((f, i) => <option key={f.id} value={i}>{f.date}</option>)}
                </select>
              </label>
              <p className="mt-1.5">After = the date selected on the timeline ({frame.date}). Drag the divider on the map.</p>
            </div>
          )}
        </Section>
      ) : !running && (
        <Section>
          <p className="text-sm text-neutral-300">No usable scenes yet.</p>
          <p className="mt-1 text-xs text-neutral-500">
            {counts.rejected > 0 ? `${counts.rejected} scenes were too cloudy or incomplete. ` : ''}Try a longer history or a higher cloud limit.
          </p>
        </Section>
      )}

      {exporting && frame && (
        <Section>
          <ExportPanel areaName={area.name} frames={frames} cache={cache} view={view} overlay={change === 'none' ? null : change}
            fps={fps} pixelated={!aerial} sensorLabel={sensorLabel} attribution={attributionFor} onClose={() => setExporting(false)} />
        </Section>
      )}

      {/* Layers */}
      {frame && (
        <Section title="Layer">
          <div className={`grid gap-1 ${aerial ? 'grid-cols-2' : 'grid-cols-4'}`}>
            {([
              { v: 'tc', label: 'Photo', icon: Image },
              { v: 'ndvi', label: 'Vegetation', icon: Leaf },
              { v: 'ndwi', label: 'Water', icon: Droplets },
              { v: 'ndbi', label: 'Built & bare', icon: Building },
            ] as const).filter(({ v }) => !aerial || v === 'tc' || v === 'ndvi').map(({ v, label, icon: Icon }) => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                className={`flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px] transition-colors ${
                  view === v ? 'border-accent bg-accent/10 text-white' : 'border-line text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'}`}>
                <Icon size={16} />{label}
              </button>
            ))}
          </div>
          {aerial ? (
            <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
              NAIP aerial photos (USDA): sharp enough for buildings, vehicles and trees, but flown only every 2–3 years and US only.
              Use them to see <i>what</i> changed; use satellite frames to narrow down <i>when</i>. They aren't used for automatic change stats.
            </p>
          ) : (
          <div className="mt-3 space-y-1">
            <div className="text-[11px] text-neutral-400">Highlight change</div>
            <Segmented<ChangeView> label="Change overlay" value={change} onChange={setChange} options={[
              { value: 'none', label: 'Off' },
              { value: 'chgPrev', label: 'Since previous', title: 'Compare with the previous scene' },
              { value: 'chgBase', label: 'Since first', title: `Compare with the first scene (${frames[0] ? fmtDate(frames[0].date, 'short') : ''})` },
            ]} />
          </div>
          )}
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
            {SERIES.map(({ key: k, label, color }) => {
              const d = baseline && frame !== frames[0] ? st[k] - baseline[k] : null
              return (
                <div key={k} className="rounded-md bg-panel p-2">
                  <dt className="flex items-center gap-1.5 text-[10px] text-neutral-400"><span className="h-2 w-2 rounded-sm" style={{ background: color }} />{label}</dt>
                  <dd className="text-lg font-semibold tabular-nums text-neutral-100">{st[k].toFixed(1)}%</dd>
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

      {/* Time series */}
      {!aerial && s2Frames.length > 1 && (
        <Section title="Over time">
          <SeriesChart frames={s2Frames} index={Math.min(idx, s2Frames.length - 1)} events={shownEvents} onSeek={(i) => i >= 0 && go(i)} />
        </Section>
      )}

      {/* Flagged changes */}
      {!aerial && events.length > 0 && (
        <Section
          title={<>Flagged changes <span className="font-normal normal-case tracking-normal text-neutral-500">({shownEvents.length})</span></>}
          aside={
            <div className="w-36">
              <Segmented<'confident' | 'all'> label="Confidence filter" size="xs" value={eventFilter} onChange={setEventFilter}
                options={[{ value: 'confident', label: 'Confident', title: 'High and medium confidence' }, { value: 'all', label: 'All' }]} />
            </div>
          }
        >
          {shownEvents.length === 0 ? (
            <p className="text-xs text-neutral-500">
              Nothing unusual for the time of year.{' '}
              {events.length > 0 && <>{events.length} low-confidence change{events.length > 1 ? 's' : ''} hidden: switch to "All" to see them.</>}
            </p>
          ) : (
            <ul className="-mx-1 max-h-72 space-y-1 overflow-y-auto scroll-thin">
              {[...shownEvents].reverse().map((e) => {
                const fi = frames.findIndex((f) => f.id === e.sceneId)
                const current = frame?.id === e.sceneId
                return (
                  <li key={e.id}>
                    <button onClick={() => fi >= 0 && go(fi)}
                      className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${current ? 'bg-amber-500/10 ring-1 ring-amber-500/40' : 'hover:bg-neutral-800'}`}>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: EVENT_DOT[e.kind] }} />
                        <span className="font-medium text-neutral-100">{e.title}</span>
                        <ConfidencePill c={e.confidence ?? 'low'} />
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-neutral-500">{e.date}</span>
                      </div>
                      {current && <p className="mt-1 leading-relaxed text-neutral-400">{e.description}</p>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
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
