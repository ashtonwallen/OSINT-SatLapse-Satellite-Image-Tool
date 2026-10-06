import { LoaderCircle, MapPin, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { geocoder, type Place } from '../geocode'

export function SearchBox({ onPick }: { onPick(p: Place): void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Place[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ctrl = useRef<AbortController | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // Close the results list on outside click.
  useEffect(() => {
    if (!results) return
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setResults(null) }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [results])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    ctrl.current?.abort()
    ctrl.current = new AbortController()
    setBusy(true)
    setError(null)
    try {
      setResults(await geocoder.search(q, ctrl.current.signal))
    } catch (err) {
      if (!ctrl.current.signal.aborted) setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={root} className="relative">
      <form onSubmit={submit} role="search" className="relative">
        <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setResults(null)}
          placeholder="Search for a place, then press Enter"
          aria-label="Search for a place"
          className="w-full rounded-md border border-line bg-panel-2 py-2 pl-8 pr-8 text-sm outline-none placeholder:text-neutral-500 focus:border-accent"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2">
          {busy ? (
            <LoaderCircle size={15} className="animate-spin text-neutral-400" />
          ) : q ? (
            <button type="button" aria-label="Clear search" onClick={() => { setQ(''); setResults(null); setError(null) }} className="text-neutral-500 hover:text-neutral-200">
              <X size={15} />
            </button>
          ) : null}
        </span>
      </form>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {results && (
        <ul className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-line bg-panel-2 text-sm shadow-2xl">
          {results.length === 0 && <li className="px-3 py-2 text-neutral-400">No places found</li>}
          {results.map((r, i) => (
            <li key={i}>
              <button className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-neutral-800" onClick={() => { onPick(r); setResults(null) }}>
                <MapPin size={14} className="mt-0.5 shrink-0 text-neutral-500" />
                <span>
                  <span className="block">{r.name}</span>
                  {r.detail && <span className="block text-xs text-neutral-400">{r.detail}</span>}
                </span>
              </button>
            </li>
          ))}
          <li className="border-t border-line px-3 py-1 text-[10px] text-neutral-500">{geocoder.attribution}</li>
        </ul>
      )}
    </div>
  )
}
