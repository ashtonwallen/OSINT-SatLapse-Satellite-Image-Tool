import { useState } from 'react'
import { DEFAULT_SETTINGS, validatePolygon } from '../core/area'
import type { PolygonGeometry } from '../core/geo'
import type { AreaSettings, HistoryDepth, Sampling } from '../core/types'

interface Props {
  geometry: PolygonGeometry
  maxAreaKm2: number
  onCreate(name: string, settings: AreaSettings): void
  onRedraw(): void
  onCancel(): void
}

const DEPTHS: { v: HistoryDepth; label: string }[] = [
  { v: '1y', label: '1 year' },
  { v: '3y', label: '3 years' },
  { v: 'all', label: 'All (2015→)' },
]
const SAMPLINGS: { v: Sampling; label: string; hint: string }[] = [
  { v: 'month', label: 'Best per month', hint: 'Clearest scene each month. Good default.' },
  { v: 'quarter', label: 'Best per quarter', hint: 'Fastest; good for long histories.' },
  { v: 'all', label: 'Every usable scene', hint: 'Every clear pass (~every 2–5 days). Slow for long histories.' },
]

export function NewAreaForm({ geometry, maxAreaKm2, onCreate, onRedraw, onCancel }: Props) {
  const [name, setName] = useState('')
  const [settings, setSettings] = useState<AreaSettings>(DEFAULT_SETTINGS)
  const v = validatePolygon(geometry, maxAreaKm2)
  const set = <K extends keyof AreaSettings>(k: K, val: AreaSettings[K]) => setSettings((s) => ({ ...s, [k]: val }))

  // Very rough expectation-setting, from the Phase 1/2 measurements.
  const perYear = settings.sampling === 'month' ? 12 : settings.sampling === 'quarter' ? 4 : 50
  const years = settings.historyDepth === '1y' ? 1 : settings.historyDepth === '3y' ? 3 : new Date().getFullYear() - 2015
  const km2 = v.ok ? v.areaKm2 : 0
  const mbPerScene = Math.max(4, Math.min(30, km2 * 0.25))
  const estScenes = perYear * years

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">New area</h2>
        {v.ok ? (
          <p className="text-sm text-neutral-400">{v.areaKm2.toFixed(1)} km² · limit {maxAreaKm2} km²</p>
        ) : (
          <div className="mt-2 rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">
            <p>{v.reason}</p>
            <button onClick={onRedraw} className="mt-2 rounded bg-red-900 px-2 py-1 text-xs hover:bg-red-800">Draw again</button>
          </div>
        )}
      </div>

      {v.ok && v.areaKm2 < 1 && (
        <div className="rounded-md border border-amber-900 bg-amber-950/40 p-3 text-xs text-amber-100">
          <p className="font-medium">Small area: expect coarse imagery</p>
          <p className="mt-1 text-amber-200/80">
            Sentinel-2 pixels are 10 m, so this area is only about {Math.max(1, Math.round(Math.sqrt(v.areaKm2 * 1e4)))}×{Math.max(1, Math.round(Math.sqrt(v.areaKm2 * 1e4)))} pixels.
            Individual buildings and vehicles won't be visible, but land clearing, new roads and construction usually are.
            Imagery is shown for ~2 km around it for context; stats still cover only your polygon.
            Switch the map to "High-res imagery" for sharp current context.
          </p>
        </div>
      )}

      <label className="block text-sm">
        <span className="text-neutral-300">Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Reservoir north arm"
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 outline-none focus:border-sky-500"
        />
      </label>

      <fieldset className="text-sm">
        <legend className="text-neutral-300">History</legend>
        <div className="mt-1 flex gap-1">
          {DEPTHS.map((d) => (
            <button key={d.v} onClick={() => set('historyDepth', d.v)}
              className={`flex-1 rounded-md px-2 py-1.5 ${settings.historyDepth === d.v ? 'bg-sky-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700'}`}>
              {d.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="text-sm">
        <legend className="text-neutral-300">Sampling</legend>
        <div className="mt-1 space-y-1">
          {SAMPLINGS.map((s) => (
            <label key={s.v} className={`flex cursor-pointer items-start gap-2 rounded-md p-2 ${settings.sampling === s.v ? 'bg-neutral-800' : 'hover:bg-neutral-900'}`}>
              <input type="radio" name="sampling" checked={settings.sampling === s.v} onChange={() => set('sampling', s.v)} className="mt-1" />
              <span>
                <span className="block">{s.label}</span>
                <span className="block text-xs text-neutral-400">{s.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block text-sm">
        <span className="text-neutral-300">Max cloud over the area: {settings.maxCloudPct}%</span>
        <input type="range" min={0} max={60} step={5} value={settings.maxCloudPct} onChange={(e) => set('maxCloudPct', Number(e.target.value))} className="mt-1 w-full" />
        <span className="text-xs text-neutral-500">Measured from the scene classification band over your polygon, not the whole satellite tile.</span>
      </label>

      {v.ok && (
        <p className="rounded-md bg-neutral-900 p-2 text-xs text-neutral-400">
          Up to ~{estScenes} scenes, roughly {Math.round((estScenes * mbPerScene) / 10) * 10 || mbPerScene} MB downloaded the first time. It runs in the background and resumes if you close the tab.
        </p>
      )}

      <div className="flex gap-2">
        <button disabled={!v.ok} onClick={() => onCreate(name, settings)} className="flex-1 rounded-md bg-sky-600 py-2 font-medium hover:bg-sky-500 disabled:opacity-40">
          Create & fetch history
        </button>
        <button onClick={onCancel} className="rounded-md bg-neutral-800 px-3 hover:bg-neutral-700">Cancel</button>
      </div>
    </div>
  )
}
