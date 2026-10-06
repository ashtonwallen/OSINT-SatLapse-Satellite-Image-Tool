import type { Area } from '../core/types'

export function AreaList({ areas, onOpen }: { areas: Area[]; onOpen(a: Area): void }) {
  if (!areas.length) {
    return (
      <div className="rounded-md border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">
        No areas yet. Search for a place or pan the map, then draw an area to pull its satellite history.
      </div>
    )
  }
  return (
    <ul className="space-y-1">
      {areas.map((a) => (
        <li key={a.id}>
          <button onClick={() => onOpen(a)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-neutral-800">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{a.name}</span>
              <span className="block text-xs text-neutral-400">
                {a.areaKm2.toFixed(1)} km²
                {a.sync.latestDate && ` · latest ${a.sync.latestDate}`}
                {a.example && ' · example'}
              </span>
            </span>
            {a.sync.status === 'running' && <span className="animate-pulse text-xs text-sky-400">syncing</span>}
            {a.sync.status === 'queued' && <span className="text-xs text-neutral-400">queued</span>}
            {a.sync.status === 'error' && <span className="text-xs text-red-400" title={a.sync.error}>error</span>}
            {a.sync.unseen > 0 && (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-black" title="New imagery since you last looked">
                {a.sync.unseen} new
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
