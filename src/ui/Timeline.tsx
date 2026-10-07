// Time-proportional scrubber: one tick per frame, event markers above,
// snaps to the nearest frame. Keyboard: arrows step, Home/End jump.
import { useRef } from 'react'
import type { ChangeEvent, SceneRecord } from '../core/types'
import { fmtDate } from './kit'

const EVENT_COLORS: Record<ChangeEvent['kind'], string> = {
  veg_loss: '#ef4444', veg_gain: '#22c55e', water_gain: '#3b82f6', water_loss: '#f59e0b', built_gain: '#d946ef',
}

interface Props {
  frames: SceneRecord[]
  index: number
  events: ChangeEvent[]
  onChange(i: number): void
}

export function Timeline({ frames, index, events, onChange }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`)
  const t0 = t(frames[0].date)
  const t1 = t(frames[frames.length - 1].date)
  const span = Math.max(1, t1 - t0)
  const pos = (d: string) => (frames.length === 1 ? 50 : (100 * (t(d) - t0)) / span)
  const frameIdx = new Map(frames.map((f, i) => [f.id, i]))

  function pick(clientX: number) {
    const r = track.current!.getBoundingClientRect()
    const target = t0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span
    let best = 0
    for (let i = 1; i < frames.length; i++) if (Math.abs(t(frames[i].date) - target) < Math.abs(t(frames[best].date) - target)) best = i
    onChange(best)
  }

  const years: number[] = []
  for (let y = new Date(t0).getUTCFullYear() + 1; y <= new Date(t1).getUTCFullYear(); y++) years.push(y)

  return (
    <div className="select-none">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Scene date"
        aria-valuemin={0}
        aria-valuemax={frames.length - 1}
        aria-valuenow={index}
        aria-valuetext={fmtDate(frames[index].date)}
        className="relative h-10 cursor-pointer touch-none"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e.clientX) }}
        onPointerMove={(e) => { if (e.buttons) pick(e.clientX) }}
        onKeyDown={(e) => {
          const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key]
          if (step) { e.preventDefault(); onChange(Math.min(frames.length - 1, Math.max(0, index + step))) }
          if (e.key === 'Home') { e.preventDefault(); onChange(0) }
          if (e.key === 'End') { e.preventDefault(); onChange(frames.length - 1) }
        }}
      >
        {/* Event markers (callers pass the confidence-filtered list) */}
        {events.map((e) => frameIdx.has(e.sceneId) && (
          <span
            key={e.id}
            title={`${e.date}: ${e.title} (${e.confidence ?? 'low'} confidence)`}
            className="absolute top-0.5 h-2 w-2 -translate-x-1/2 rounded-full ring-1 ring-black"
            style={{ left: `${pos(e.date)}%`, background: EVENT_COLORS[e.kind]}}
          />
        ))}
        {/* Track + progress */}
        <div className="absolute inset-x-0 top-[18px] h-1 rounded-full bg-neutral-800" />
        <div className="absolute left-0 top-[18px] h-1 rounded-full bg-accent/60" style={{ width: `${pos(frames[index].date)}%` }} />
        {/* Frame ticks */}
        {frames.map((f, i) => (
          <span key={f.id} className={`absolute top-[16px] h-2 w-px -translate-x-1/2 ${i <= index ? 'bg-accent' : 'bg-neutral-600'}`} style={{ left: `${pos(f.date)}%` }} />
        ))}
        {/* Year gridlines */}
        {years.map((y) => (
          <span key={y} className="absolute top-[26px] -translate-x-1/2 text-[9px] text-neutral-500" style={{ left: `${pos(`${y}-01-01`)}%` }}>
            {y}
          </span>
        ))}
        {/* Thumb */}
        <span
          className="absolute top-[13px] h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-accent bg-white shadow"
          style={{ left: `${pos(frames[index].date)}%` }}
        />
      </div>
    </div>
  )
}
