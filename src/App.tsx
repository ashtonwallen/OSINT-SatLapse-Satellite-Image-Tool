import { useEffect, useRef, useState } from 'react'
import { bboxOf, type PolygonGeometry } from './core/geo'
import type { AreaSettings } from './core/types'
import { BRAND } from './config/brand'
import { APP_CONFIG } from './config/app'
import { createAndBackfill, trackAllAreas } from './app/actions'
import { useAreas } from './app/hooks'
import { AreaDetail } from './ui/AreaDetail'
import { AreaList } from './ui/AreaList'
import { MapView, type DrawMode, type FrameOverlay, type MapViewHandle } from './ui/MapView'
import { NewAreaForm } from './ui/NewAreaForm'
import { SearchBox } from './ui/SearchBox'

export function App() {
  const { areas, reload } = useAreas()
  const map = useRef<MapViewHandle>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawMode, setDrawMode] = useState<DrawMode>('none')
  const [pending, setPending] = useState<PolygonGeometry | null>(null)
  const [overlays, setOverlays] = useState<FrameOverlay[]>([])
  const selected = areas?.find((a) => a.id === selectedId) ?? null

  // Tracking: every time the app opens, check each area for newer scenes.
  const tracked = useRef(false)
  useEffect(() => {
    if (tracked.current) return
    tracked.current = true
    void trackAllAreas()
  }, [])

  function openArea(id: string) {
    setSelectedId(id)
    const a = areas?.find((x) => x.id === id)
    if (a) map.current?.fitBounds(bboxOf(a.geometry.coordinates[0]) as [number, number, number, number], 14)
  }

  async function create(name: string, settings: AreaSettings) {
    if (!pending) return
    const area = await createAndBackfill(name, pending, settings)
    setPending(null)
    reload()
    setSelectedId(area.id)
  }

  let panel: React.ReactNode
  if (pending) {
    panel = (
      <NewAreaForm
        geometry={pending}
        maxAreaKm2={APP_CONFIG.maxAreaKm2}
        onCreate={create}
        onRedraw={() => { setPending(null); setDrawMode('polygon') }}
        onCancel={() => setPending(null)}
      />
    )
  } else if (selected) {
    panel = <AreaDetail key={selected.id} area={selected} onBack={() => setSelectedId(null)} onOverlays={setOverlays} />
  } else {
    panel = (
      <div className="space-y-4">
        <div className="flex gap-2">
          <button onClick={() => setDrawMode('polygon')} className="flex-1 rounded-md bg-sky-600 py-2 text-sm font-medium hover:bg-sky-500">Draw polygon</button>
          <button onClick={() => setDrawMode('rectangle')} className="flex-1 rounded-md bg-neutral-800 py-2 text-sm hover:bg-neutral-700">Draw rectangle</button>
        </div>
        <p className="text-xs text-neutral-500">Max {APP_CONFIG.maxAreaKm2} km² per area. Everything runs in your browser; nothing is uploaded.</p>
        {areas && <AreaList areas={areas} onOpen={(a) => openArea(a.id)} />}
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col-reverse bg-neutral-950 text-neutral-100 md:flex-row">
      <aside className="flex max-h-[55dvh] w-full shrink-0 flex-col border-t border-neutral-800 md:max-h-none md:w-96 md:border-r md:border-t-0">
        <header className="space-y-3 border-b border-neutral-800 p-4">
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{BRAND.name}</h1>
            <span className="text-xs text-neutral-500">Sentinel-2 timelapse & change detection</span>
          </div>
          <SearchBox onPick={(p) => map.current?.fitBounds(p.bbox ?? [p.center[0] - 0.05, p.center[1] - 0.05, p.center[0] + 0.05, p.center[1] + 0.05], 13)} />
        </header>
        <div className="flex-1 overflow-y-auto p-4">{panel}</div>
      </aside>
      <main className="relative min-h-0 flex-1">
        <MapView
          ref={map}
          areas={areas ?? []}
          selectedId={selectedId}
          onSelectArea={openArea}
          drawMode={drawMode}
          maxAreaKm2={APP_CONFIG.maxAreaKm2}
          onDrawn={(poly) => { setDrawMode('none'); setSelectedId(null); setPending(poly) }}
          onDrawCancel={() => setDrawMode('none')}
          overlays={selected ? overlays : []}
          pending={pending}
        />
      </main>
    </div>
  )
}
