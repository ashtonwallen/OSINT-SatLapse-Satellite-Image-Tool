import { Pentagon, RefreshCw, Satellite, Square, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { sceneId, type Area } from '../core/types'
import { storage } from '../storage/idb'
import { Button } from './kit'

function Thumb({ area }: { area: Area }) {
  const [url, setUrl] = useState<string | null>(null)
  const latest = area.sync.latestDate
  useEffect(() => {
    if (!latest) return
    let u: string | null = null
    void storage.getImage(sceneId(area.id, latest), 'tc').then((b) => { if (b) setUrl((u = URL.createObjectURL(b))) })
    return () => { if (u) URL.revokeObjectURL(u) }
  }, [area.id, latest])
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-panel">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <Satellite size={18} className="text-neutral-600" />}
    </div>
  )
}

export function AreaList({ areas, onOpen, onDraw }: { areas: Area[]; onOpen(a: Area): void; onDraw(mode: 'polygon' | 'rectangle'): void }) {
  const draw = (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="primary" onClick={() => onDraw('rectangle')}><Square size={14} /> Draw rectangle</Button>
      <Button onClick={() => onDraw('polygon')}><Pentagon size={14} /> Draw polygon</Button>
    </div>
  )

  if (!areas.length) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-semibold">Watch any place on Earth change</h2>
          <p className="mt-1 text-sm text-neutral-400">Pull a place's full Sentinel-2 satellite history, replay how it changed, and get flagged changes, all in your browser.</p>
        </div>
        <ol className="space-y-3 text-sm">
          {[
            ['Find a place', 'Search above, or pan and zoom the map.'],
            ['Draw an area', 'Up to 100 km², from a single field to a small town.'],
            ['Watch it change', 'History downloads in the background; new imagery is fetched each time you return.'],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{i + 1}</span>
              <span><span className="font-medium text-neutral-100">{t}</span><span className="block text-xs text-neutral-400">{d}</span></span>
            </li>
          ))}
        </ol>
        {draw}
        <p className="text-[11px] leading-relaxed text-neutral-500">
          No account, no server, no API keys. Imagery comes straight from public archives into your browser, and everything you make stays on this device.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {draw}
      <div>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Your areas</h2>
        <ul className="space-y-1">
          {areas.map((a) => (
            <li key={a.id}>
              <button onClick={() => onOpen(a)} className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-line hover:bg-panel-2">
                <Thumb area={a} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{a.name}</span>
                    {a.sync.unseen > 0 && (
                      <span className="shrink-0 rounded-full bg-amber-400 px-1.5 py-px text-[10px] font-bold text-black" title="New imagery since you last looked">{a.sync.unseen} new</span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400">
                    {a.areaKm2 < 1 ? `${(a.areaKm2 * 100).toFixed(0)} ha` : `${a.areaKm2.toFixed(1)} km²`}
                    {a.sync.latestDate && <> · latest {a.sync.latestDate}</>}
                    {a.example && <> · example</>}
                  </span>
                </span>
                {(a.sync.status === 'running' || a.sync.status === 'queued') && (
                  <RefreshCw size={14} className={`shrink-0 text-accent ${a.sync.status === 'running' ? 'animate-spin' : 'opacity-50'}`} aria-label={a.sync.status === 'running' ? 'Updating' : 'Queued'} />
                )}
                {a.sync.status === 'error' && <TriangleAlert size={14} className="shrink-0 text-red-400" aria-label={`Error: ${a.sync.error}`} />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
