import { Link2 } from 'lucide-react'
import { useState } from 'react'
import { DEFAULT_SETTINGS } from '../core/area'
import { ringAreaKm2 } from '../core/geo'
import type { SharedProject } from '../core/share'
import type { AreaSettings } from '../core/types'
import { Button, Segmented } from './kit'

export function SharedImport({ shared, onCreate, onDismiss }: { shared: SharedProject; onCreate(s: AreaSettings): void; onDismiss(): void }) {
  const [settings, setSettings] = useState<AreaSettings>(DEFAULT_SETTINGS)
  const total = shared.areas.reduce((n, a) => n + ringAreaKm2(a.geometry.coordinates[0]), 0)
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Link2 size={18} className="mt-1 text-accent" />
        <div>
          <h2 className="text-lg font-semibold">Shared project</h2>
          <p className="text-sm text-neutral-300">{shared.name}</p>
          <p className="text-xs text-neutral-500">{shared.areas.length} area{shared.areas.length === 1 ? '' : 's'} · {total.toFixed(1)} km² total: {shared.areas.map((a) => a.name).join(', ')}</p>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-neutral-400">
        Someone shared these area outlines with you. Nothing else was shared: your copy fetches its own satellite history, in your browser.
      </p>
      <div>
        <span className="text-xs font-medium text-neutral-300">History</span>
        <div className="mt-1">
          <Segmented label="History depth" value={settings.historyDepth} onChange={(d) => setSettings({ ...settings, historyDepth: d })} options={[
            { value: '1y', label: '1 year' }, { value: '3y', label: '3 years' }, { value: 'all', label: 'Since 2015' }, { value: 'landsat', label: 'Since 1984' },
          ]} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1 !py-2" onClick={() => onCreate(settings)}>Create & fetch history</Button>
        <Button onClick={onDismiss}>Dismiss</Button>
      </div>
    </div>
  )
}
