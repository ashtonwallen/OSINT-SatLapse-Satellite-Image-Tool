import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { bboxOf, type PolygonGeometry } from './core/geo'
import type { Area, AreaSettings } from './core/types'
import { BRAND } from './config/brand'
import { APP_CONFIG } from './config/app'
import { createAndBackfill, trackAllAreas } from './app/actions'
import { useAreas } from './app/hooks'
import { AreaDetail, type FrameState } from './ui/AreaDetail'
import { AreaList } from './ui/AreaList'
import { CompareOverlay } from './ui/CompareOverlay'
import { IconButton, Logo } from './ui/kit'
import { MapHud } from './ui/MapHud'
import { MapView, type DrawMode, type MapViewHandle } from './ui/MapView'
import { NewAreaForm } from './ui/NewAreaForm'
import { SearchBox } from './ui/SearchBox'

const NO_FRAME: FrameState = { overlays: [], hud: null }
const bbox = (a: Area) => bboxOf(a.geometry.coordinates[0]) as [number, number, number, number]

export function App() {
  const { areas } = useAreas()
  const map = useRef<MapViewHandle>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawMode, setDrawMode] = useState<DrawMode>('none')
  const [pending, setPending] = useState<PolygonGeometry | null>(null)
  const [frame, setFrame] = useState<FrameState>(NO_FRAME)
  // On phones the panel is a bottom sheet that can be collapsed to free the map.
  const [collapsed, setCollapsed] = useState(false)
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
    setCollapsed(false)
    const a = areas?.find((x) => x.id === id)
    if (a) map.current?.fitBounds(bbox(a), 14)
  }

  function startDraw(mode: 'polygon' | 'rectangle') {
    setDrawMode(mode)
    if (window.matchMedia('(max-width: 767px)').matches) setCollapsed(true)
  }

  async function create(name: string, settings: AreaSettings) {
    if (!pending) return
    const area = await createAndBackfill(name, pending, settings)
    setPending(null)
    setSelectedId(area.id)
    map.current?.fitBounds(bbox(area), 14)
  }

  let panel: React.ReactNode
  if (pending) {
    panel = (
      <NewAreaForm
        geometry={pending}
        maxAreaKm2={APP_CONFIG.maxAreaKm2}
        onCreate={create}
        onRedraw={() => { setPending(null); startDraw('polygon') }}
        onCancel={() => setPending(null)}
      />
    )
  } else if (selected) {
    panel = (
      <AreaDetail key={selected.id} area={selected} onBack={() => setSelectedId(null)} onFrame={setFrame}
        onFit={() => map.current?.fitBounds(bbox(selected), 14)} />
    )
  } else {
    panel = areas && <AreaList areas={areas} onOpen={(a) => openArea(a.id)} onDraw={startDraw} />
  }

  const hud = selected ? frame.hud : null
  return (
    <div className="flex h-dvh flex-col-reverse bg-[#0a0a0b] text-neutral-100 md:flex-row">
      <aside className={`flex w-full shrink-0 flex-col border-t border-line bg-panel md:max-h-none md:w-[380px] md:border-r md:border-t-0 ${collapsed ? 'max-h-[64px]' : 'max-h-[55dvh]'}`}>
        <header className="space-y-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo className="h-5 w-5 text-accent" />
            <h1 className="text-lg font-semibold tracking-tight">{BRAND.name}</h1>
            <span className="hidden truncate text-xs text-neutral-500 sm:inline">Satellite timelapse & change detection</span>
            <IconButton label={collapsed ? 'Expand panel' : 'Collapse panel'} className="ml-auto md:hidden" onClick={() => setCollapsed((c) => !c)}>
              {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </IconButton>
          </div>
          {!collapsed && (
            <SearchBox onPick={(p) => map.current?.fitBounds(p.bbox ?? [p.center[0] - 0.05, p.center[1] - 0.05, p.center[0] + 0.05, p.center[1] + 0.05], 13)} />
          )}
        </header>
        {!collapsed && <div className="scroll-thin flex-1 overflow-y-auto p-4">{panel}</div>}
      </aside>
      <main className="relative min-h-0 flex-1">
        <MapView
          ref={map}
          areas={areas ?? []}
          selectedId={selectedId}
          onSelectArea={openArea}
          drawMode={drawMode}
          maxAreaKm2={APP_CONFIG.maxAreaKm2}
          onDrawn={(poly) => { setDrawMode('none'); setSelectedId(null); setPending(poly); setCollapsed(false) }}
          onDrawCancel={() => { setDrawMode('none'); setCollapsed(false) }}
          overlays={selected ? frame.overlays : []}
          pending={pending}
        />
        {hud && drawMode === 'none' && <MapHud hud={hud} />}
        {selected && frame.compare && map.current?.getMap() && <CompareOverlay map={map.current.getMap()!} state={frame.compare} />}
      </main>
    </div>
  )
}
