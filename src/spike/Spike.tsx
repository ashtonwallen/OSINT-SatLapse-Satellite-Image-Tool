import { useEffect, useRef, useState } from 'react'
import { copernicusAttribution } from '../core/attribution'
import type { LngLat } from '../core/geo'
import { SOURCES, type SourceId } from '../core/stac'
import type { SpikeError, SpikeRequest, SpikeResult } from './spike.worker'

const LOCATIONS: { label: string; center: LngLat }[] = [
  { label: 'Imperial Valley farmland, CA', center: [-115.52, 32.9] },
  { label: 'Lake Mead (Boulder Basin), NV', center: [-114.75, 36.08] },
]
const AREAS = [10, 100]
const SOURCE_IDS = Object.keys(SOURCES) as SourceId[]

type Row = (SpikeResult | SpikeError) & { label: string }

const fmt = (ms: number) => `${(ms / 1000).toFixed(2)} s`

function Canvas({ rgba, width, height }: { rgba: Uint8ClampedArray; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  }, [rgba, width, height])
  return <canvas ref={ref} width={width} height={height} className="h-auto w-full max-w-md bg-neutral-900 [image-rendering:pixelated]" />
}

export function Spike() {
  const workerRef = useRef<Worker | null>(null)
  const pending = useRef(new Map<number, (r: SpikeResult | SpikeError) => void>())
  const nextId = useRef(1)
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<SpikeResult | null>(null)
  const [loc, setLoc] = useState(0)

  useEffect(() => {
    const w = new Worker(new URL('./spike.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (ev: MessageEvent<SpikeResult | SpikeError>) => {
      pending.current.get(ev.data.runId)?.(ev.data)
      pending.current.delete(ev.data.runId)
    }
    workerRef.current = w
    return () => w.terminate()
  }, [])

  function run(sourceId: SourceId, areaKm2: number): Promise<SpikeResult | SpikeError> {
    const runId = nextId.current++
    const req: SpikeRequest = { runId, sourceId, areaKm2, center: LOCATIONS[loc].center }
    return new Promise((resolve) => {
      pending.current.set(runId, resolve)
      workerRef.current!.postMessage(req)
    })
  }

  async function runMany(jobs: [SourceId, number][]) {
    for (const [sourceId, area] of jobs) {
      const label = `${SOURCES[sourceId].label} · ${area} km² · ${LOCATIONS[loc].label}`
      setBusy(label)
      const r = await run(sourceId, area)
      setRows((prev) => [...prev, { ...r, label }])
      if (r.ok) setSelected(r)
    }
    setBusy(null)
  }

  const matrix = SOURCE_IDS.flatMap((s) => AREAS.map((a) => [s, a] as [SourceId, number]))
  const year = selected ? new Date(selected.datetime).getUTCFullYear() : new Date().getUTCFullYear()

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 text-sm">
      <header>
        <h1 className="text-xl font-semibold">SatLapse · Phase 1 feasibility spike</h1>
        <p className="text-neutral-400">
          Everything below runs in your browser: STAC search → HTTP range reads of Sentinel-2 COGs → true colour + NDVI in a Web Worker.
        </p>
      </header>

      <section className="flex flex-wrap items-center gap-2">
        <select className="rounded bg-neutral-800 px-2 py-1" value={loc} onChange={(e) => setLoc(Number(e.target.value))} disabled={!!busy}>
          {LOCATIONS.map((l, i) => <option key={l.label} value={i}>{l.label}</option>)}
        </select>
        {matrix.map(([s, a]) => (
          <button key={`${s}${a}`} disabled={!!busy} onClick={() => runMany([[s, a]])}
            className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40">
            {s} · {a} km²
          </button>
        ))}
        <button disabled={!!busy} onClick={() => runMany(matrix)} className="rounded bg-sky-600 px-3 py-1 font-medium hover:bg-sky-500 disabled:opacity-40">
          Run full matrix
        </button>
        {busy && <span className="animate-pulse text-sky-300">Running: {busy}</span>}
      </section>

      {selected && (
        <section>
          <h2 className="mb-1 font-medium">{selected.sceneId} · {selected.datetime.slice(0, 10)} · {selected.width}×{selected.height} px</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <figure><Canvas rgba={selected.trueColor} width={selected.width} height={selected.height} /><figcaption className="text-neutral-400">True colour (B04/B03/B02)</figcaption></figure>
            <figure><Canvas rgba={selected.ndvi} width={selected.width} height={selected.height} /><figcaption className="text-neutral-400">NDVI (B08−B04)/(B08+B04), mean {selected.meanNdvi?.toFixed(3) ?? 'n/a'}</figcaption></figure>
          </div>
          <p className="mt-2 text-xs text-neutral-500">{copernicusAttribution(year)}</p>
        </section>
      )}

      <section className="overflow-x-auto">
        <table className="w-full text-left" data-testid="results">
          <thead className="text-neutral-400">
            <tr>
              <th className="py-1 pr-3">Run</th><th className="pr-3">Scene</th><th className="pr-3">Pixels</th>
              <th className="pr-3">Cloud scene / polygon</th><th className="pr-3">Search</th><th className="pr-3">Headers</th>
              <th className="pr-3">Bands</th><th className="pr-3">Process</th><th className="pr-3">Total</th><th className="pr-3">Requests</th><th>MB</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => r.ok ? (
              <tr key={i} className="cursor-pointer border-t border-neutral-800 hover:bg-neutral-900" onClick={() => setSelected(r)}>
                <td className="py-1 pr-3">{r.label}</td>
                <td className="pr-3">{r.datetime.slice(0, 10)}</td>
                <td className="pr-3">{r.width}×{r.height}</td>
                <td className="pr-3">{r.sceneCloudPct?.toFixed(1) ?? '?'}% / {r.polygonCloudPct.toFixed(1)}%</td>
                <td className="pr-3">{fmt(r.searchMs)}</td>
                <td className="pr-3">{fmt(r.headerMs)}</td>
                <td className="pr-3">{fmt(r.bandsMs)}</td>
                <td className="pr-3">{fmt(r.processMs)}</td>
                <td className="pr-3 font-medium">{fmt(r.totalMs)}</td>
                <td className="pr-3">{r.requests}</td>
                <td>{(r.bytes / 1e6).toFixed(1)}</td>
              </tr>
            ) : (
              <tr key={i} className="border-t border-neutral-800 text-red-400">
                <td className="py-1 pr-3">{r.label}</td>
                <td colSpan={10}>Failed at {r.stage}: {r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}
