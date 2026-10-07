// Land-cover time series synced to the player: hover for values, click to seek.
// Palette validated with the dataviz checker (dark surface, all pairs, CVD-safe).
import { Table } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, LandCoverMetric, SceneRecord } from '../core/types'
import { fmtDate } from './kit'

export const SERIES: { key: LandCoverMetric; label: string; color: string }[] = [
  { key: 'vegPct', label: 'Vegetation', color: '#199e70' },
  { key: 'waterPct', label: 'Water', color: '#3987e5' },
  { key: 'builtPct', label: 'Built & bare', color: '#d95926' },
]

const EVENT_COLORS: Record<ChangeEvent['kind'], string> = {
  veg_loss: '#ef4444', veg_gain: '#22c55e', water_gain: '#3b82f6', water_loss: '#f59e0b', built_gain: '#d946ef',
}

const H = 150
const PAD = { l: 30, r: 8, t: 14, b: 18 }

interface Props {
  frames: SceneRecord[]
  index: number
  events: ChangeEvent[]
  onSeek(i: number): void
}

export function SeriesChart({ frames, index, events, onSeek }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(340)
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [table, frames.length >= 2])

  const pts = frames.filter((f) => f.stats)
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`)
  const t0 = t(pts[0]?.date ?? '2020-01-01')
  const t1 = t(pts.at(-1)?.date ?? '2021-01-01')
  const x = (d: string) => PAD.l + (pts.length < 2 ? 0.5 : (t(d) - t0) / Math.max(1, t1 - t0)) * (w - PAD.l - PAD.r)
  const yMax = useMemo(() => {
    const m = Math.max(10, ...pts.flatMap((f) => SERIES.map((s) => f.stats![s.key])))
    return Math.min(100, Math.ceil(m / 10) * 10)
  }, [pts])
  const y = (v: number) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b)
  const ticks = [0, yMax / 2, yMax]
  const years: number[] = []
  for (let yr = new Date(t0).getUTCFullYear() + 1; yr <= new Date(t1).getUTCFullYear(); yr++) years.push(yr)

  if (pts.length < 2) return <p className="text-xs text-neutral-500">The chart appears once there are at least two clear scenes.</p>

  const nearest = (clientX: number) => {
    const r = box.current!.getBoundingClientRect()
    const px = clientX - r.left
    let best = 0
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(pts[i].date) - px) < Math.abs(x(pts[best].date) - px)) best = i
    return best
  }
  const cur = frames[index]
  const shown = hover !== null ? pts[hover] : cur
  const frameIndexOf = (id: string) => frames.findIndex((f) => f.id === id)

  return (
    <div>
      {/* Legend with values for the hovered/current date (identity never colour-only). */}
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-neutral-300">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
            {s.label}
            <span className="tabular-nums text-neutral-100">{shown?.stats ? `${shown.stats[s.key].toFixed(1)}%` : '–'}</span>
          </span>
        ))}
        <button type="button" onClick={() => setTable((v) => !v)} aria-pressed={table} title="Show as table"
          className={`ml-auto rounded p-1 ${table ? 'bg-neutral-200 text-black' : 'text-neutral-500 hover:text-neutral-200'}`}>
          <Table size={13} />
        </button>
      </div>

      {table ? (
        <div className="scroll-thin max-h-56 overflow-y-auto rounded border border-line">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="sticky top-0 bg-panel-2 text-neutral-400">
              <tr><th className="px-2 py-1 text-left font-medium">Date</th>{SERIES.map((s) => <th key={s.key} className="px-2 py-1 text-right font-medium">{s.label}</th>)}</tr>
            </thead>
            <tbody>
              {[...pts].reverse().map((f) => (
                <tr key={f.id} onClick={() => onSeek(frameIndexOf(f.id))}
                  className={`cursor-pointer border-t border-line ${f.id === cur?.id ? 'bg-accent/10' : 'hover:bg-neutral-800'}`}>
                  <td className="px-2 py-0.5 font-mono text-neutral-300">{f.date}</td>
                  {SERIES.map((s) => <td key={s.key} className="px-2 py-0.5 text-right text-neutral-200">{f.stats![s.key].toFixed(1)}%</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={box}
          className="relative cursor-crosshair select-none"
          onPointerMove={(e) => setHover(nearest(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => onSeek(frameIndexOf(pts[nearest(e.clientX)].id))}
        >
          <svg width={w} height={H} role="img" aria-label="Land cover over time: vegetation, water and built-up percentages">
            {/* Recessive grid + axis labels */}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke="#2a2d32" strokeWidth={1} />
                <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#71717a">{v}%</text>
              </g>
            ))}
            {years.map((yr) => (
              <text key={yr} x={x(`${yr}-01-01`)} y={H - 4} textAnchor="middle" fontSize={9} fill="#71717a">{yr}</text>
            ))}
            {/* Event markers along the top */}
            {events.map((e) => (
              <circle key={e.id} cx={x(e.date)} cy={5} r={3} fill={EVENT_COLORS[e.kind]} stroke="#111214" strokeWidth={1.5}>
                <title>{`${e.date}: ${e.title} (${e.confidence})`}</title>
              </circle>
            ))}
            {/* Series lines */}
            {SERIES.map((s) => (
              <path key={s.key} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                d={pts.map((f, i) => `${i ? 'L' : 'M'}${x(f.date).toFixed(1)},${y(f.stats![s.key]).toFixed(1)}`).join('')} />
            ))}
            {/* Current-frame cursor (synced with the player) */}
            {cur?.stats && (
              <g>
                <line x1={x(cur.date)} x2={x(cur.date)} y1={PAD.t - 4} y2={H - PAD.b} stroke="#e7e7ea" strokeWidth={1} strokeDasharray="2 2" opacity={0.7} />
                {SERIES.map((s) => <circle key={s.key} cx={x(cur.date)} cy={y(cur.stats![s.key])} r={4} fill={s.color} stroke="#18191c" strokeWidth={2} />)}
              </g>
            )}
            {/* Hover crosshair */}
            {hover !== null && pts[hover].id !== cur?.id && (
              <g>
                <line x1={x(pts[hover].date)} x2={x(pts[hover].date)} y1={PAD.t - 4} y2={H - PAD.b} stroke="#a1a1aa" strokeWidth={1} />
                {SERIES.map((s) => <circle key={s.key} cx={x(pts[hover].date)} cy={y(pts[hover].stats![s.key])} r={3.5} fill={s.color} stroke="#18191c" strokeWidth={2} />)}
              </g>
            )}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-0 rounded border border-line bg-panel/95 px-2 py-1 text-[10px] shadow-lg"
              style={{ left: Math.min(w - 120, Math.max(0, x(pts[hover].date) + 8)) }}>
              <div className="font-mono text-neutral-200">{fmtDate(pts[hover].date, 'short')}</div>
              <div className="text-neutral-500">click to jump here</div>
            </div>
          )}
        </div>
      )}
      <p className="mt-1 text-[10px] text-neutral-500">% of clear pixels in your area. "Built & bare" includes bare soil.</p>
    </div>
  )
}
