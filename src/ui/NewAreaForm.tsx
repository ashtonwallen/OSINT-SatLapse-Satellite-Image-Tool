import { Info, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { DEFAULT_SETTINGS, validatePolygon } from '../core/area'
import type { PolygonGeometry } from '../core/geo'
import type { AreaSettings, Sampling } from '../core/types'
import { Button, Segmented } from './kit'

interface Props {
  geometry: PolygonGeometry
  maxAreaKm2: number
  onCreate(name: string, settings: AreaSettings): void
  onRedraw(): void
  onCancel(): void
}

const SAMPLINGS: { v: Sampling; label: string; hint: string }[] = [
  { v: 'month', label: 'Best per month', hint: 'Clearest scene each month. Recommended.' },
  { v: 'quarter', label: 'Best per quarter', hint: 'Fastest. Good for long histories.' },
  { v: 'all', label: 'Every clear scene', hint: 'Every 2–5 days. Slow for long histories.' },
]

export function NewAreaForm({ geometry, maxAreaKm2, onCreate, onRedraw, onCancel }: Props) {
  const [name, setName] = useState('')
  const [settings, setSettings] = useState<AreaSettings>(DEFAULT_SETTINGS)
  const v = validatePolygon(geometry, maxAreaKm2)
  const set = <K extends keyof AreaSettings>(k: K, val: AreaSettings[K]) => setSettings((s) => ({ ...s, [k]: val }))

  // Rough expectation-setting, from the Phase 1/2 measurements.
  const perYear = settings.sampling === 'month' ? 12 : settings.sampling === 'quarter' ? 4 : 50
  const years = settings.historyDepth === '1y' ? 1 : settings.historyDepth === '3y' ? 3 : new Date().getFullYear() - 2015
  const km2 = v.ok ? v.areaKm2 : 0
  const mbPerScene = Math.max(4, Math.min(30, km2 * 0.25))
  const estScenes = perYear * years
  const estMb = Math.max(mbPerScene, Math.round((estScenes * mbPerScene) / 10) * 10)
  const estMin = Math.max(1, Math.round((estScenes * 3) / 60 + 0.3))
  const px = v.ok ? Math.max(1, Math.round(Math.sqrt(v.areaKm2 * 1e4))) : 0

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (v.ok) onCreate(name, settings) }}>
      <div>
        <h2 className="text-lg font-semibold">New area</h2>
        {v.ok && (
          <p className="text-sm text-neutral-400">
            {v.areaKm2 < 1 ? `${(v.areaKm2 * 100).toFixed(1)} ha` : `${v.areaKm2.toFixed(1)} km²`} · limit {maxAreaKm2} km²
          </p>
        )}
      </div>

      {!v.ok && (
        <div className="flex gap-2 rounded-lg border border-red-900/70 bg-red-950/40 p-3 text-sm text-red-200">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <div>
            <p>{v.reason}</p>
            <Button type="button" variant="secondary" onClick={onRedraw} className="mt-2 text-xs">Draw again</Button>
          </div>
        </div>
      )}

      {v.ok && v.areaKm2 < 1 && (
        <div className="flex gap-2 rounded-lg border border-amber-900/70 bg-amber-950/30 p-3 text-xs text-amber-100">
          <Info size={14} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Small area: expect coarse imagery</p>
            <p className="mt-1 leading-relaxed text-amber-200/80">
              Sentinel-2 pixels are 10 m, so this is only about {px}×{px} pixels. Buildings and vehicles won't be visible, but land
              clearing, new roads and construction usually are. You'll see ~2 km of surroundings for context; stats still cover only
              your shape. Switch the map to "High-res imagery" for sharp current detail.
            </p>
          </div>
        </div>
      )}

      <label className="block">
        <span className="text-xs font-medium text-neutral-300">Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Reservoir north arm"
          className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none placeholder:text-neutral-600 focus:border-accent"
        />
      </label>

      <div>
        <span className="text-xs font-medium text-neutral-300">History</span>
        <div className="mt-1">
          <Segmented label="History depth" value={settings.historyDepth} onChange={(d) => set('historyDepth', d)} options={[
            { value: '1y', label: '1 year' },
            { value: '3y', label: '3 years' },
            { value: 'all', label: 'All (2015→)' },
          ]} />
        </div>
      </div>

      <fieldset>
        <legend className="text-xs font-medium text-neutral-300">Sampling</legend>
        <div className="mt-1 space-y-1">
          {SAMPLINGS.map((s) => (
            <label key={s.v} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 transition-colors ${
              settings.sampling === s.v ? 'border-accent bg-accent/10' : 'border-line hover:border-neutral-600'}`}>
              <input type="radio" name="sampling" checked={settings.sampling === s.v} onChange={() => set('sampling', s.v)} className="mt-0.5 accent-sky-400" />
              <span className="text-sm">
                <span className="block">{s.label}</span>
                <span className="block text-xs text-neutral-400">{s.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="flex justify-between text-xs font-medium text-neutral-300">
          Max cloud over your area <span className="tabular-nums text-neutral-100">{settings.maxCloudPct}%</span>
        </span>
        <input type="range" className="range mt-1 w-full" min={0} max={60} step={5} value={settings.maxCloudPct} onChange={(e) => set('maxCloudPct', Number(e.target.value))} />
        <span className="text-[11px] text-neutral-500">Measured over your shape only, not the whole satellite image.</span>
      </label>

      {v.ok && (
        <p className="rounded-md bg-panel-2 p-2.5 text-xs leading-relaxed text-neutral-400">
          About <b className="font-medium text-neutral-200">{estScenes} scenes</b>, roughly <b className="font-medium text-neutral-200">{estMb} MB</b> and{' '}
          <b className="font-medium text-neutral-200">~{estMin} min</b> the first time. It runs in the background and resumes if you close the tab.
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!v.ok} className="flex-1 !py-2">Create & fetch history</Button>
        <Button type="button" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
