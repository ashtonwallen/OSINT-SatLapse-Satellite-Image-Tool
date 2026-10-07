import { Map as MlMap, NavigationControl, Popup, ScaleControl, type GeoJSONSource, type ImageSource, setWorkerUrl, type LngLatBoundsLike, type MapLayerMouseEvent, type MapMouseEvent } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ringAreaKm2, type LngLat, type PolygonGeometry } from '../core/geo'
import type { Annotation, Area } from '../core/types'

export type DrawMode = 'none' | 'polygon' | 'rectangle' | 'point'

export interface FrameOverlay {
  url: string
  corners: [LngLat, LngLat, LngLat, LngLat]
  opacity: number
  /** Linear resampling (aerial photos); default is nearest, showing true pixels. */
  smooth?: boolean
}

export interface MapViewHandle {
  fitBounds(b: LngLatBoundsLike, maxZoom?: number): void
  getMap(): MlMap | null
}

interface Props {
  areas: Area[]
  selectedId: string | null
  onSelectArea(id: string): void
  drawMode: DrawMode
  maxAreaKm2: number
  onDrawn(poly: PolygonGeometry): void
  onDrawCancel(): void
  overlays: FrameOverlay[]
  /** Finished drawing awaiting a name; shown until created or cancelled. */
  pending: PolygonGeometry | null
  annotations: Annotation[]
  /** Called in 'point' mode with the clicked location. */
  onPoint?(p: LngLat): void
}

// MapLibre 6 runs tile parsing in a module worker that must be bundled explicitly.
setWorkerUrl(maplibreWorkerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'
// Public-domain, key-free orthoimagery (US only; ~1 m or better). Used as
// high-resolution context under the 10 m Sentinel-2 frames.
const IMAGERY_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'

export type Basemap = 'map' | 'imagery'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function closeRing(pts: LngLat[]): LngLat[] {
  return pts.length ? [...pts, pts[0]] : pts
}

export const MapView = forwardRef<MapViewHandle, Props>(function MapView(props, ref) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)
  const [liveKm2, setLiveKm2] = useState<number | null>(null)
  const [basemap, setBasemap] = useState<Basemap>('map')
  const propsRef = useRef(props)
  propsRef.current = props
  const draft = useRef<{ pts: LngLat[]; hover: LngLat | null; rectStart: LngLat | null }>({ pts: [], hover: null, rectStart: null })

  useImperativeHandle(ref, () => ({
    fitBounds: (b, maxZoom = 13) => mapRef.current?.fitBounds(b, { padding: 60, maxZoom, duration: 800 }),
    getMap: () => mapRef.current,
  }))

  // Create map once.
  useEffect(() => {
    const map = new MlMap({
      container: container.current!,
      style: STYLE_URL,
      center: [-30, 25],
      zoom: 1.6,
      attributionControl: { compact: true },
      doubleClickZoom: false,
    })
    map.addControl(new NavigationControl({ visualizePitch: false }), 'bottom-right')
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    // style.load (not load) so setup doesn't wait for the first rendered frame.
    map.once('style.load', () => {
      // Imagery sits above the vector basemap's fills/lines but below its labels.
      const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
      map.addSource('imagery', {
        type: 'raster', tiles: [IMAGERY_TILES], tileSize: 256, maxzoom: 16,
        attribution: 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a> (US only)',
      })
      map.addLayer({ id: 'imagery', type: 'raster', source: 'imagery', layout: { visibility: 'none' } }, firstSymbol)
      map.addSource('areas', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': '#38bdf8', 'fill-opacity': ['case', ['get', 'selected'], 0.0, 0.12] } })
      map.addLayer({
        id: 'areas-line', type: 'line', source: 'areas',
        paint: { 'line-color': ['case', ['get', 'selected'], '#fbbf24', '#38bdf8'], 'line-width': ['case', ['get', 'selected'], 2.5, 1.5] },
      })
      map.addSource('annotations', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'annotations', type: 'circle', source: 'annotations', paint: {
        'circle-radius': 6, 'circle-color': '#fcd34d', 'circle-stroke-color': '#111214', 'circle-stroke-width': 2,
      } })
      map.addSource('pending', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'pending-fill', type: 'fill', source: 'pending', paint: { 'fill-color': '#fbbf24', 'fill-opacity': 0.15 } })
      map.addLayer({ id: 'pending-line', type: 'line', source: 'pending', paint: { 'line-color': '#fbbf24', 'line-width': 2.5 } })
      map.addSource('draft', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': ['case', ['get', 'tooBig'], '#ef4444', '#fbbf24'], 'fill-opacity': 0.2 } })
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': ['case', ['get', 'tooBig'], '#ef4444', '#fbbf24'], 'line-width': 2, 'line-dasharray': [2, 1] } })
      map.addLayer({ id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#fbbf24', 'circle-stroke-color': '#000', 'circle-stroke-width': 1 } })
      setReady(true)
    })
    map.on('click', 'areas-fill', (e: MapLayerMouseEvent) => {
      if (propsRef.current.drawMode !== 'none') return
      const id = e.features?.[0]?.properties?.id
      if (id) propsRef.current.onSelectArea(String(id))
    })
    map.on('click', 'annotations', (e: MapLayerMouseEvent) => {
      if (propsRef.current.drawMode !== 'none') return
      const f = e.features?.[0]
      if (!f) return
      // Build the popup with textContent so annotation text can't inject markup.
      const el = document.createElement('div')
      el.className = 'max-w-56 text-xs'
      const d = document.createElement('div')
      d.className = 'mb-1 font-mono text-[10px] text-neutral-500'
      d.textContent = String(f.properties?.date ?? '')
      const t = document.createElement('div')
      t.textContent = String(f.properties?.text ?? '')
      el.append(d, t)
      new Popup({ closeButton: true, maxWidth: '240px', className: 'satlapse-popup' })
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setDOMContent(el).addTo(map)
    })
    map.on('mouseenter', 'annotations', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'annotations', () => { if (propsRef.current.drawMode === 'none') map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'areas-fill', () => { if (propsRef.current.drawMode === 'none') map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'areas-fill', () => { if (propsRef.current.drawMode === 'none') map.getCanvas().style.cursor = '' })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __map: MlMap }).__map = map
    return () => map.remove()
  }, [])

  useEffect(() => {
    const src = mapRef.current?.getSource('annotations') as GeoJSONSource | undefined
    if (!ready || !src) return
    src.setData({ type: 'FeatureCollection', features: props.annotations.map((a) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: a.lngLat }, properties: { id: a.id, text: a.text, date: a.date },
    })) })
  }, [ready, props.annotations])

  useEffect(() => {
    const src = mapRef.current?.getSource('pending') as GeoJSONSource | undefined
    if (!ready || !src) return
    src.setData(props.pending ? { type: 'Feature', geometry: props.pending, properties: {} } : EMPTY)
  }, [ready, props.pending])

  // Area outlines.
  useEffect(() => {
    const src = mapRef.current?.getSource('areas') as GeoJSONSource | undefined
    if (!ready || !src) return
    src.setData({
      type: 'FeatureCollection',
      features: props.areas.map((a) => ({ type: 'Feature', geometry: a.geometry, properties: { id: a.id, selected: a.id === props.selectedId } })),
    })
  }, [ready, props.areas, props.selectedId])

  useEffect(() => {
    const map = mapRef.current
    if (ready && map?.getLayer('imagery')) map.setLayoutProperty('imagery', 'visibility', basemap === 'imagery' ? 'visible' : 'none')
  }, [ready, basemap])

  // Scene overlays (image sources), rendered below area outlines.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const wanted = new Set(props.overlays.map((_, i) => `frame-${i}`))
    props.overlays.forEach((o, i) => {
      const id = `frame-${i}`
      const src = map.getSource(id) as ImageSource | undefined
      if (src) {
        src.updateImage({ url: o.url, coordinates: o.corners })
        map.setPaintProperty(id, 'raster-opacity', o.opacity)
        map.setPaintProperty(id, 'raster-resampling', o.smooth ? 'linear' : 'nearest')
      } else {
        map.addSource(id, { type: 'image', url: o.url, coordinates: o.corners })
        map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': o.opacity, 'raster-fade-duration': 0, 'raster-resampling': o.smooth ? 'linear' : 'nearest' } }, 'areas-fill')
      }
    })
    for (let i = 0; i < 8; i++) {
      const id = `frame-${i}`
      if (!wanted.has(id) && map.getSource(id)) {
        map.removeLayer(id)
        map.removeSource(id)
      }
    }
  }, [ready, props.overlays])

  // Drawing interactions.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const mode = props.drawMode
    draft.current = { pts: [], hover: null, rectStart: null }
    setLiveKm2(null)
    const src = map.getSource('draft') as GeoJSONSource
    const render = () => {
      const { pts, hover, rectStart } = draft.current
      let ring: LngLat[] = []
      if (mode === 'polygon') ring = hover ? [...pts, hover] : pts
      if (mode === 'rectangle' && rectStart && hover) {
        ring = [rectStart, [hover[0], rectStart[1]], hover, [rectStart[0], hover[1]]]
      }
      const km2 = ring.length >= 3 ? ringAreaKm2(closeRing(ring)) : null
      setLiveKm2(km2)
      const tooBig = km2 != null && km2 > propsRef.current.maxAreaKm2
      const feats: GeoJSON.Feature[] = []
      if (ring.length >= 3) feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [closeRing(ring)] }, properties: { tooBig } })
      else if (ring.length === 2) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: { tooBig } })
      if (mode === 'polygon') pts.forEach((p) => feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }))
      src.setData({ type: 'FeatureCollection', features: feats })
    }
    const finish = (ring: LngLat[]) => {
      src.setData(EMPTY)
      setLiveKm2(null)
      propsRef.current.onDrawn({ type: 'Polygon', coordinates: [closeRing(ring)] })
    }
    if (mode === 'none') {
      src.setData(EMPTY)
      map.getCanvas().style.cursor = ''
      return
    }
    map.getCanvas().style.cursor = 'crosshair'
    // Panning must be off before the gesture starts, or the map scrolls under the rectangle.
    if (mode === 'rectangle') map.dragPan.disable()
    const ll = (e: MapMouseEvent): LngLat => [e.lngLat.lng, e.lngLat.lat]

    const onClick = (e: MapMouseEvent) => {
      if (mode === 'point') { propsRef.current.onPoint?.(ll(e)); return }
      if (mode !== 'polygon') return
      const { pts } = draft.current
      // Clicking the first vertex closes the polygon.
      if (pts.length >= 3) {
        const first = map.project(pts[0])
        if (Math.hypot(first.x - e.point.x, first.y - e.point.y) < 10) return finish(pts)
      }
      pts.push(ll(e))
      render()
    }
    const onDbl = (e: MapMouseEvent) => {
      if (mode !== 'polygon') return
      e.preventDefault()
      const { pts } = draft.current
      // The dblclick's second click already added a duplicate vertex.
      if (pts.length >= 4) finish(pts.slice(0, -1))
    }
    const onMove = (e: MapMouseEvent) => {
      draft.current.hover = ll(e)
      render()
    }
    const onDown = (e: MapMouseEvent) => {
      if (mode !== 'rectangle') return
      e.preventDefault()
      draft.current.rectStart = ll(e)
    }
    const onUp = (e: MapMouseEvent) => {
      if (mode !== 'rectangle' || !draft.current.rectStart) return
      const a = draft.current.rectStart
      const b = ll(e)
      draft.current.rectStart = null
      if (Math.abs(a[0] - b[0]) < 1e-5 || Math.abs(a[1] - b[1]) < 1e-5) return render()
      finish([a, [b[0], a[1]], b, [a[0], b[1]]])
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') propsRef.current.onDrawCancel()
      if (e.key === 'Backspace' && mode === 'polygon' && draft.current.pts.length) {
        draft.current.pts.pop()
        render()
      }
      if (e.key === 'Enter' && mode === 'polygon' && draft.current.pts.length >= 3) finish(draft.current.pts)
    }
    map.on('click', onClick)
    map.on('dblclick', onDbl)
    map.on('mousemove', onMove)
    map.on('mousedown', onDown)
    map.on('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      map.off('click', onClick)
      map.off('dblclick', onDbl)
      map.off('mousemove', onMove)
      map.off('mousedown', onDown)
      map.off('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
      map.dragPan.enable()
      src.setData(EMPTY)
    }
  }, [ready, props.drawMode])

  const tooBig = liveKm2 != null && liveKm2 > props.maxAreaKm2
  return (
    <div className="absolute inset-0">
      {/* MapLibre forces position:relative on its container, so size it explicitly. */}
      <div ref={container} className="h-full w-full" />
      <div className="absolute right-3 top-3 flex overflow-hidden rounded-md border border-neutral-700 bg-neutral-900/90 text-xs shadow-lg" role="group" aria-label="Basemap">
        {(['map', 'imagery'] as const).map((b) => (
          <button type="button" key={b} onClick={() => setBasemap(b)} aria-pressed={basemap === b}
            className={`px-3 py-1.5 ${basemap === b ? 'bg-neutral-200 text-black' : 'text-neutral-300 hover:bg-neutral-800'}`}>
            {b === 'map' ? 'Map' : <>Imagery<span className="hidden sm:inline"> (US high-res)</span></>}
          </button>
        ))}
      </div>
      {props.drawMode !== 'none' && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-lg bg-black/80 px-3 py-2 text-center text-xs text-neutral-200 shadow-lg">
          {props.drawMode === 'polygon'
            ? 'Click to add points · click the first point, double-click or press Enter to finish · Backspace undoes · Esc cancels'
            : props.drawMode === 'point' ? 'Click the map where your annotation should go · Esc cancels'
            : 'Drag to draw a rectangle · Esc cancels'}
          {liveKm2 != null && (
            <div className={tooBig ? 'mt-1 font-semibold text-red-400' : 'mt-1 text-amber-300'}>
              {liveKm2.toFixed(1)} km² {tooBig ? `· over the ${props.maxAreaKm2} km² limit` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
