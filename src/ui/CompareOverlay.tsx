// Before/after swipe comparison drawn over the map. Each image is placed with
// an affine CSS transform computed from its georeferenced corners, so it stays
// aligned while the map pans and zooms; the "after" image is clipped at the
// divider in screen space.
import type { Map as MlMap } from 'maplibre-gl'
import { GripVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { LngLat } from '../core/geo'
import { fmtDate } from './kit'

export interface CompareSide {
  url: string
  corners: [LngLat, LngLat, LngLat, LngLat]
  date: string
  label: string
}

export interface CompareState {
  before: CompareSide
  after: CompareSide
  pixelated: boolean
}

function GeoImage({ map, side, pixelated, version }: { map: MlMap; side: CompareSide; pixelated: boolean; version: number }) {
  const [size, setSize] = useState<[number, number] | null>(null)
  let transform = 'scale(0)'
  if (size) {
    const [tl, tr, , bl] = side.corners.map((c) => map.project(c))
    const [w, h] = size
    transform = `matrix(${(tr.x - tl.x) / w}, ${(tr.y - tl.y) / w}, ${(bl.x - tl.x) / h}, ${(bl.y - tl.y) / h}, ${tl.x}, ${tl.y})`
  }
  void version // re-render on map move
  return (
    <img
      src={side.url}
      alt=""
      draggable={false}
      onLoad={(e) => setSize([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
      className="absolute left-0 top-0 max-w-none origin-top-left"
      style={{ transform, width: size?.[0], height: size?.[1], imageRendering: pixelated ? 'pixelated' : 'auto' }}
    />
  )
}

export function CompareOverlay({ map, state }: { map: MlMap; state: CompareState }) {
  const root = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(0.5)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let raf = 0
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setVersion((v) => v + 1)) }
    map.on('move', onMove)
    map.on('resize', onMove)
    return () => { map.off('move', onMove); map.off('resize', onMove); cancelAnimationFrame(raf) }
  }, [map])

  const drag = (e: React.PointerEvent) => {
    const r = root.current!.getBoundingClientRect()
    setPos(Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width)))
  }

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 overflow-hidden">
      <GeoImage map={map} side={state.before} pixelated={state.pixelated} version={version} />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos * 100}%)` }}>
        <GeoImage map={map} side={state.after} pixelated={state.pixelated} version={version} />
      </div>
      {/* Divider */}
      <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_6px_rgba(0,0,0,.6)]" style={{ left: `${pos * 100}%` }} />
      <button type="button"
        aria-label="Drag to compare"
        className="pointer-events-auto absolute top-1/2 flex h-10 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-md bg-white text-black shadow-lg"
        style={{ left: `${pos * 100}%` }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag(e) }}
        onPointerMove={(e) => { if (e.buttons) drag(e) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setPos((p) => Math.max(0.02, p - 0.02))
          if (e.key === 'ArrowRight') setPos((p) => Math.min(0.98, p + 0.02))
        }}
      >
        <GripVertical size={14} />
      </button>
      <div className="absolute top-14 rounded bg-black/70 px-2 py-1 text-[11px] text-white md:top-16" style={{ right: `${(1 - pos) * 100 + 1}%` }}>
        ◀ {fmtDate(state.before.date, 'short')} <span className="text-neutral-400">{state.before.label}</span>
      </div>
      <div className="absolute top-14 rounded bg-black/70 px-2 py-1 text-[11px] text-white md:top-16" style={{ left: `${pos * 100 + 1}%` }}>
        {fmtDate(state.after.date, 'short')} <span className="text-neutral-400">{state.after.label}</span> ▶
      </div>
    </div>
  )
}
