import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { bboxOf, type LngLat, type PolygonGeometry } from './core/geo'
import type { Area, AreaSettings } from './core/types'
import { BRAND } from './config/brand'
import { APP_CONFIG } from './config/app'
import { createAndBackfill, ensureInvestigation, newInvestigation, trackAllAreas } from './app/actions'
import { useAnnotations, useAreas, useInvestigations } from './app/hooks'
import { AreaDetail, type FrameState } from './ui/AreaDetail'
import { AreaList } from './ui/AreaList'
import { CompareOverlay } from './ui/CompareOverlay'
import { ProjectList } from './ui/ProjectList'
import { ProjectView } from './ui/ProjectView'
import { IconButton, Logo } from './ui/kit'
import { MapHud } from './ui/MapHud'
import { MapView, type DrawMode, type MapViewHandle } from './ui/MapView'
import { NewAreaForm } from './ui/NewAreaForm'
import { SearchBox } from './ui/SearchBox'

const NO_FRAME: FrameState = { overlays: [], hud: null }
const bbox = (a: Area) => bboxOf(a.geometry.coordinates[0]) as [number, number, number, number]
const bboxAll = (as: Area[]) => bboxOf(as.flatMap((a) => a.geometry.coordinates[0])) as [number, number, number, number]

export function App() {
  const { areas } = useAreas()
  const investigations = useInvestigations()
  const map = useRef<MapViewHandle>(null)
  const [invId, setInvId] = useState<string | null>(null)
  const [areaId, setAreaId] = useState<string | null>(null)
  const [focusDate, setFocusDate] = useState<string | undefined>()
  const [drawMode, setDrawMode] = useState<DrawMode>('none')
  const [pending, setPending] = useState<PolygonGeometry | null>(null)
  const [frame, setFrame] = useState<FrameState>(NO_FRAME)
  const pointCb = useRef<((p: LngLat) => void) | null>(null)
  // On phones the panel is a bottom sheet that can be collapsed to free the map.
  const [collapsed, setCollapsed] = useState(false)

  const inv = investigations?.find((i) => i.id === invId) ?? null
  const invAreas = useMemo(() => (areas ?? []).filter((a) => a.investigationId === invId), [areas, invId])
  const area = invAreas.find((a) => a.id === areaId) ?? null
  const annotations = useAnnotations(invId)

  // With a single project, skip the list and open it directly.
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current || !investigations || !areas) return
    autoOpened.current = true
    if (investigations.length === 1) openInvestigation(investigations[0].id)
  }, [investigations, areas])

  // Tracking: every time the app opens, check each area for newer scenes.
  const tracked = useRef(false)
  useEffect(() => {
    if (tracked.current) return
    tracked.current = true
    void trackAllAreas()
  }, [])

  function openInvestigation(id: string) {
    setInvId(id)
    setAreaId(null)
    const own = (areas ?? []).filter((a) => a.investigationId === id)
    if (own.length) map.current?.fitBounds(bboxAll(own), 13)
  }

  function openArea(id: string, date?: string) {
    const a = areas?.find((x) => x.id === id)
    if (!a) return
    setInvId(a.investigationId)
    setAreaId(id)
    setFocusDate(date)
    setCollapsed(false)
    map.current?.fitBounds(bbox(a), 14)
  }

  function startDraw(mode: 'polygon' | 'rectangle') {
    setDrawMode(mode)
    if (window.matchMedia('(max-width: 767px)').matches) setCollapsed(true)
  }

  async function create(name: string, settings: AreaSettings) {
    if (!pending) return
    const target = inv ?? (await ensureInvestigation())
    const created = await createAndBackfill(target.id, name, pending, settings)
    setPending(null)
    setInvId(target.id)
    setAreaId(created.id)
    setFocusDate(undefined)
    map.current?.fitBounds(bbox(created), 14)
  }

  let panel: React.ReactNode = null
  if (pending) {
    panel = (
      <NewAreaForm geometry={pending} maxAreaKm2={APP_CONFIG.maxAreaKm2} onCreate={create}
        onRedraw={() => { setPending(null); startDraw('polygon') }} onCancel={() => setPending(null)} />
    )
  } else if (area) {
    panel = (
      <AreaDetail key={area.id} area={area} focusDate={focusDate} onBack={() => setAreaId(null)} onFrame={setFrame}
        onFit={() => map.current?.fitBounds(bbox(area), 14)}
        onPickPoint={(cb) => { pointCb.current = cb; setDrawMode('point') }} />
    )
  } else if (inv) {
    panel = (
      <ProjectView investigation={inv} areas={invAreas} annotations={annotations}
        onBack={() => setInvId(null)} onOpenArea={openArea} onDraw={startDraw}
        onFlyTo={(p) => map.current?.fitBounds([p[0] - 0.01, p[1] - 0.01, p[0] + 0.01, p[1] + 0.01], 15)} />
    )
  } else if (investigations && areas) {
    panel = (
      <ProjectList investigations={investigations} areas={areas} onOpen={openInvestigation}
        onCreate={async (n) => openInvestigation((await newInvestigation(n)).id)} />
    )
  }
  // First run: no projects yet. Drawing an area creates one.
  const firstRun = !!investigations && investigations.length === 0 && !pending

  const hud = area ? frame.hud : null
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
        {!collapsed && <div className="scroll-thin flex-1 overflow-y-auto p-4">{firstRun ? <FirstRun onDraw={startDraw} /> : panel}</div>}
      </aside>
      <main className="relative min-h-0 flex-1">
        <MapView
          ref={map}
          areas={inv ? invAreas : areas ?? []}
          selectedId={areaId}
          onSelectArea={(id) => openArea(id)}
          drawMode={drawMode}
          maxAreaKm2={APP_CONFIG.maxAreaKm2}
          onDrawn={(poly) => { setDrawMode('none'); setAreaId(null); setPending(poly); setCollapsed(false) }}
          onDrawCancel={() => { setDrawMode('none'); pointCb.current = null; setCollapsed(false) }}
          onPoint={(p) => { setDrawMode('none'); pointCb.current?.(p); pointCb.current = null }}
          overlays={area ? frame.overlays : []}
          pending={pending}
          annotations={annotations}
        />
        {hud && drawMode === 'none' && <MapHud hud={hud} />}
        {area && frame.compare && map.current?.getMap() && <CompareOverlay map={map.current.getMap()!} state={frame.compare} />}
      </main>
    </div>
  )
}

function FirstRun({ onDraw }: { onDraw(m: 'polygon' | 'rectangle'): void }) {
  return <AreaList areas={[]} onOpen={() => {}} onDraw={onDraw} />
}
