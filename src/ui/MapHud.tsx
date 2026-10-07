// On-map heads-up display for the active frame: date chip, legend, attribution.
import { CHANGE_COLORS } from '../core/products'
import { NDBI_RAMP, NDVI_RAMP, NDWI_RAMP, type Stop } from '../core/scene'
import { fmtDate, relativeDays } from './kit'

export type View = 'tc' | 'ndvi' | 'ndwi' | 'ndbi'
export type ChangeView = 'none' | 'chgPrev' | 'chgBase'

export interface HudState {
  date: string
  view: View
  change: ChangeView
  comparedDate?: string
  sensor: string
  /** Credit line required by the frame's data source. */
  attribution: string
  index: number
  count: number
}

const RAMPS: Record<Exclude<View, 'tc'>, { stops: Stop[]; title: string; low: string; high: string }> = {
  ndvi: { stops: NDVI_RAMP, title: 'Vegetation (NDVI)', low: 'Water / bare', high: 'Dense vegetation' },
  ndwi: { stops: NDWI_RAMP, title: 'Water (NDWI)', low: 'Dry', high: 'Open water' },
  ndbi: { stops: NDBI_RAMP, title: 'Built-up & bare (NDBI)', low: 'Vegetation / water', high: 'Built / bare' },
}

function gradient(stops: Stop[]): string {
  const min = stops[0][0]
  const max = stops[stops.length - 1][0]
  return `linear-gradient(90deg, ${stops.map(([v, r, g, b]) => `rgb(${r} ${g} ${b}) ${((100 * (v - min)) / (max - min)).toFixed(0)}%`).join(', ')})`
}

const rgb = (c: readonly number[]) => `rgb(${c[0]} ${c[1]} ${c[2]})`
const CHANGE_ITEMS = [
  { c: CHANGE_COLORS.vegLoss, label: 'Vegetation loss' },
  { c: CHANGE_COLORS.vegGain, label: 'Vegetation gain' },
  { c: CHANGE_COLORS.waterGain, label: 'New water' },
  { c: CHANGE_COLORS.waterLoss, label: 'Water lost' },
  { c: CHANGE_COLORS.builtGain, label: 'New built / bare' },
]

export function MapHud({ hud }: { hud: HudState }) {
  const ramp = hud.view === 'tc' ? null : RAMPS[hud.view]
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-line bg-panel/90 px-3 py-1 shadow-lg backdrop-blur md:left-1/2 md:-translate-x-1/2 md:rounded-full md:px-4 md:py-1.5 md:text-center">
        <div className="font-mono text-xs font-semibold text-white md:text-sm">{fmtDate(hud.date)}</div>
        <div className="hidden text-[10px] text-neutral-400 sm:block">
          {hud.sensor} · {relativeDays(hud.date)} · frame {hud.index + 1}/{hud.count}
        </div>
      </div>

      <div className={`pointer-events-none absolute bottom-9 left-3 space-y-2 rounded-lg border border-line bg-panel/90 text-[11px] shadow-lg backdrop-blur ${ramp || hud.change !== 'none' ? 'w-56 p-3 md:w-60' : 'max-w-[70%] px-2 py-1'}`}>
        {ramp && (
          <div>
            <div className="mb-1 font-medium text-neutral-200">{ramp.title}</div>
            <div className="h-2 rounded-full" style={{ background: gradient(ramp.stops) }} />
            <div className="mt-0.5 flex justify-between text-neutral-400"><span>{ramp.low}</span><span>{ramp.high}</span></div>
            <div className="mt-1 flex items-center gap-1.5 text-neutral-400"><span className="inline-block h-2 w-3 rounded-sm bg-neutral-300/60" /> Cloud</div>
          </div>
        )}
        {hud.change !== 'none' && (
          <div>
            <div className="mb-1 font-medium text-neutral-200">
              Change since {hud.comparedDate ? fmtDate(hud.comparedDate, 'short') : hud.change === 'chgBase' ? 'baseline' : 'previous'}
            </div>
            <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {CHANGE_ITEMS.map((i) => (
                <li key={i.label} className="flex items-center gap-1.5 text-neutral-300">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: rgb(i.c) }} />
                  {i.label}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="text-neutral-500">{hud.attribution}</div>
      </div>
    </>
  )
}
