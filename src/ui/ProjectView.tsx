import { ChevronLeft, MapPin, Pencil, Trash } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LngLat } from '../core/geo'
import type { Annotation, Area, ChangeEvent, Investigation } from '../core/types'
import { deleteInvestigation, removeAnnotation, updateInvestigation } from '../app/actions'
import { useEventsFor } from '../app/hooks'
import { AreaList } from './AreaList'
import { Button, IconButton, Segmented, fmtDate } from './kit'
import { Markdown } from './Markdown'

type Tab = 'areas' | 'timeline' | 'notes'

interface Props {
  investigation: Investigation
  areas: Area[]
  annotations: Annotation[]
  onBack(): void
  onOpenArea(areaId: string, date?: string): void
  onDraw(mode: 'polygon' | 'rectangle'): void
  onFlyTo(p: LngLat): void
  /** Extra actions (export/share/AI) rendered in the header area. */
  actions?: React.ReactNode
}

const KIND_COLOR: Record<ChangeEvent['kind'], string> = {
  veg_loss: '#ef4444', veg_gain: '#22c55e', water_gain: '#3b82f6', water_loss: '#f59e0b', built_gain: '#d946ef',
}

type Item = { kind: 'event'; date: string; e: ChangeEvent } | { kind: 'note'; date: string; a: Annotation }

export function ProjectView({ investigation: inv, areas, annotations, onBack, onOpenArea, onDraw, onFlyTo, actions }: Props) {
  const [tab, setTab] = useState<Tab>('areas')
  const [renaming, setRenaming] = useState(false)
  const events = useEventsFor(areas.map((a) => a.id))
  const [allConfidence, setAllConfidence] = useState(false)
  const areaName = (id?: string) => areas.find((a) => a.id === id)?.name ?? ''

  const items = useMemo<Item[]>(() => {
    const ev = events.filter((e) => allConfidence || e.confidence === 'high' || e.confidence === 'medium')
    return [
      ...ev.map((e) => ({ kind: 'event' as const, date: e.date, e })),
      ...annotations.map((a) => ({ kind: 'note' as const, date: a.date, a })),
    ].sort((x, y) => y.date.localeCompare(x.date))
  }, [events, annotations, allConfidence])

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-1">
        <IconButton label="All projects" onClick={onBack}><ChevronLeft size={18} /></IconButton>
        <div className="min-w-0 flex-1 pt-0.5">
          {renaming ? (
            <input autoFocus defaultValue={inv.name}
              onBlur={(e) => { void updateInvestigation(inv.id, { name: e.target.value.trim() || inv.name }); setRenaming(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false) }}
              className="w-full rounded border border-accent bg-panel px-2 py-0.5 text-lg font-semibold outline-none" />
          ) : (
            <button onClick={() => setRenaming(true)} className="group flex max-w-full items-center gap-1.5 text-left" title="Rename project">
              <h2 className="truncate text-lg font-semibold leading-tight">{inv.name}</h2>
              <Pencil size={13} className="shrink-0 text-neutral-500 opacity-0 group-hover:opacity-100" />
            </button>
          )}
          <p className="mt-0.5 text-xs text-neutral-400">Project · {areas.length} area{areas.length === 1 ? '' : 's'} · {annotations.length} annotation{annotations.length === 1 ? '' : 's'}</p>
        </div>
      </div>
      {actions}

      <Segmented<Tab> label="Project sections" value={tab} onChange={setTab} options={[
        { value: 'areas', label: `Areas (${areas.length})` },
        { value: 'timeline', label: 'Timeline' },
        { value: 'notes', label: 'Notes' },
      ]} />

      {tab === 'areas' && <AreaList areas={areas} onOpen={(a) => onOpenArea(a.id)} onDraw={onDraw} />}

      {tab === 'timeline' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span>Flagged changes and your annotations, newest first</span>
            <label className="flex items-center gap-1"><input type="checkbox" checked={allConfidence} onChange={(e) => setAllConfidence(e.target.checked)} className="accent-sky-400" /> incl. low confidence</label>
          </div>
          {items.length === 0 ? (
            <p className="rounded-md border border-dashed border-line p-3 text-xs text-neutral-500">
              Nothing yet. Flagged changes appear here as areas are processed; add annotations from an area's player with "Annotate".
            </p>
          ) : (
            <ol className="relative space-y-1 border-l border-line pl-3">
              {items.map((it) => it.kind === 'event' ? (
                <li key={it.e.id}>
                  <button onClick={() => onOpenArea(it.e.areaId, it.e.date)} className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-800">
                    <span className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full ring-2 ring-panel" style={{ background: KIND_COLOR[it.e.kind] }} />
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-neutral-100">{it.e.title}</span>
                      <span className="text-[10px] text-neutral-500">{it.e.confidence}</span>
                      <span className="ml-auto font-mono text-[10px] text-neutral-500">{it.e.date}</span>
                    </div>
                    <div className="text-[11px] text-neutral-500">{areaName(it.e.areaId)}</div>
                  </button>
                </li>
              ) : (
                <li key={it.a.id} className="group relative rounded-md px-2 py-1.5 text-xs hover:bg-neutral-800">
                  <span className="absolute -left-[17px] top-2 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-300 text-black ring-2 ring-panel"><MapPin size={9} /></span>
                  <button className="w-full text-left" onClick={() => { onFlyTo(it.a.lngLat); if (it.a.areaId) onOpenArea(it.a.areaId, it.a.date) }}>
                    <div className="flex items-center gap-2">
                      <span className="text-neutral-100">{it.a.text}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-neutral-500">{it.a.date}</span>
                    </div>
                    <div className="text-[11px] text-neutral-500">{areaName(it.a.areaId)}{it.a.author === 'ai' && ' · drafted by AI, approved by you'}</div>
                  </button>
                  <button aria-label="Delete annotation" onClick={() => confirm('Delete this annotation?') && void removeAnnotation(it.a.id)}
                    className="absolute right-1 top-1 hidden rounded p-1 text-neutral-500 hover:text-red-300 group-hover:block"><Trash size={12} /></button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {tab === 'notes' && <Notes inv={inv} />}

      <div className="flex justify-end border-t border-line pt-3">
        <Button variant="danger" className="text-xs" onClick={async () => {
          if (!confirm(`Delete the project "${inv.name}" with all ${areas.length} areas, imagery, notes and annotations? This can't be undone.`)) return
          await deleteInvestigation(inv.id)
          onBack()
        }}><Trash size={13} /> Delete project</Button>
      </div>
    </div>
  )
}

function Notes({ inv }: { inv: Investigation }) {
  const [text, setText] = useState(inv.notes)
  const [preview, setPreview] = useState(!!inv.notes)
  const [saved, setSaved] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const onChange = (v: string) => {
    setText(v)
    setSaved(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void updateInvestigation(inv.id, { notes: v }).then(() => setSaved(true)) }, 600)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="w-36"><Segmented<'edit' | 'preview'> label="Notes mode" size="xs" value={preview ? 'preview' : 'edit'} onChange={(m) => setPreview(m === 'preview')}
          options={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]} /></div>
        <span className="text-[10px] text-neutral-500">{saved ? 'Saved on this device' : 'Saving…'}</span>
      </div>
      {preview ? (
        <div className="min-h-40 rounded-md border border-line bg-panel p-3">
          {text.trim() ? <Markdown source={text} /> : <p className="text-xs text-neutral-500">No notes yet.</p>}
        </div>
      ) : (
        <textarea value={text} onChange={(e) => onChange(e.target.value)} rows={14} spellCheck
          placeholder={'Markdown supported.\n\n## Hypothesis\n- Construction started between **Mar** and **May 2024**\n- See [source](https://example.org)'}
          className="w-full resize-y rounded-md border border-line bg-panel p-3 font-mono text-xs leading-relaxed outline-none placeholder:text-neutral-600 focus:border-accent" />
      )}
      <p className="text-[10px] text-neutral-500">Notes are included in exported reports and project files. Last edited {fmtDate(inv.updatedAt.slice(0, 10), 'short')}.</p>
    </div>
  )
}
