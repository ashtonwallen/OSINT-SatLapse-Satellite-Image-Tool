import { FolderOpen, Plus } from 'lucide-react'
import { useState } from 'react'
import type { Area, Investigation } from '../core/types'
import { Button } from './kit'

interface Props {
  investigations: Investigation[]
  areas: Area[]
  onOpen(id: string): void
  onCreate(name: string): void
}

export function ProjectList({ investigations, areas, onOpen, onCreate }: Props) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Projects</h2>
        <Button variant="ghost" className="!px-2 text-xs" onClick={() => setNaming(true)}><Plus size={14} /> New</Button>
      </div>
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
              <button onClick={() => onOpen(inv.id)} className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-line hover:bg-panel-2">
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
