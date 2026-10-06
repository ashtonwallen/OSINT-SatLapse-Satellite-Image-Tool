import { useRef, useState } from 'react'
import { geocoder, type Place } from '../geocode'

export function SearchBox({ onPick }: { onPick(p: Place): void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Place[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ctrl = useRef<AbortController | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
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
    <div className="relative">
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search for a place…"
          aria-label="Search for a place"
          className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
        />
        <button disabled={busy || !q.trim()} className="rounded-md bg-neutral-800 px-3 text-sm hover:bg-neutral-700 disabled:opacity-40">
          {busy ? '…' : 'Go'}
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {results && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 text-sm shadow-xl">
          {results.length === 0 && <li className="px-3 py-2 text-neutral-400">No places found</li>}
          {results.map((r, i) => (
            <li key={i}>
              <button className="w-full px-3 py-2 text-left hover:bg-neutral-800" onClick={() => { onPick(r); setResults(null) }}>
                <div>{r.name}</div>
                {r.detail && <div className="text-xs text-neutral-400">{r.detail}</div>}
              </button>
            </li>
          ))}
          <li className="border-t border-neutral-800 px-3 py-1 text-[10px] text-neutral-500">{geocoder.attribution}</li>
        </ul>
      )}
    </div>
  )
}
