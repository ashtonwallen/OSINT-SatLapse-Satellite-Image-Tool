import { FolderOpen, Plus, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { importProjectBytes } from '../app/actions'
import { PROJECT_EXT } from '../core/project'
import type { Area, Investigation } from '../core/types'
import { Button } from './kit'

interface Props {
  onExample?(): Promise<void>
  investigations: Investigation[]
  areas: Area[]
  onOpen(id: string): void
  onCreate(name: string): void
}

export function ProjectList({ investigations, areas, onOpen, onCreate, onExample }: Props) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Projects</h2>
        <div className="flex">
          <Button variant="ghost" className="!px-2 text-xs" onClick={() => fileRef.current?.click()} title={`Import a ${PROJECT_EXT} project file`}><Upload size={14} /> Import</Button>
          <Button variant="ghost" className="!px-2 text-xs" onClick={() => setNaming(true)}><Plus size={14} /> New</Button>
        </div>
        <input ref={fileRef} type="file" accept={`${PROJECT_EXT},.zip`} className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setImportError(null)
          try { onOpen((await importProjectBytes(new Uint8Array(await f.arrayBuffer()))).id) } catch (err) { setImportError(err instanceof Error ? err.message : String(err)) }
        }} />
      </div>
      {importError && <p className="text-xs text-red-400">{importError}</p>}
      {onExample && !areas.some((a) => a.example) && (
        <button type="button" onClick={() => void onExample()} className="w-full rounded-md border border-dashed border-line px-3 py-2 text-left text-xs text-neutral-400 hover:border-accent hover:text-neutral-200">
          ▶ Try an example: Lake Oroville, California (pre-processed, loads instantly)
        </button>
      )}
      {naming && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onCreate(name); setName(''); setNaming(false) }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Reservoir drawdown 2021–2023"
            onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
            className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent" />
          <Button type="submit" variant="primary">Create</Button>
        </form>
      )}
      <ul className="space-y-1">
        {investigations.map((inv) => {
          const own = areas.filter((a) => a.investigationId === inv.id)
          const unseen = own.reduce((n, a) => n + a.sync.unseen, 0)
          const running = own.some((a) => a.sync.status === 'running' || a.sync.status === 'queued')
          return (
            <li key={inv.id}>
              <button type="button" onClick={() => onOpen(inv.id)} className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-line hover:bg-panel-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-neutral-500"><FolderOpen size={18} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{inv.name}</span>
                    {unseen > 0 && <span className="shrink-0 rounded-full bg-amber-400 px-1.5 py-px text-[10px] font-bold text-black">{unseen} new</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-400">
                    {own.length} area{own.length === 1 ? '' : 's'} · updated {new Date(inv.updatedAt).toLocaleDateString()}{running && ' · syncing…'}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
