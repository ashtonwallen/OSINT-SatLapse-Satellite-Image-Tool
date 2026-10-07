import { Download, Film, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ImageKind, SceneRecord } from '../core/types'
import type { ImageUrlCache } from '../app/hooks'
import { download, exportGif, exportVideo, slug, type ExportFrame } from '../export/timelapse'
import { Button, Segmented } from './kit'

interface Props {
  areaName: string
  frames: SceneRecord[]
  cache: ImageUrlCache
  view: ImageKind
  overlay: ImageKind | null
  fps: number
  pixelated: boolean
  sensorLabel(s: SceneRecord): string
  attribution(frames: SceneRecord[]): string
  onClose(): void
}

export function ExportPanel(p: Props) {
  const [format, setFormat] = useState<'gif' | 'mp4'>('mp4')
  const [size, setSize] = useState(720)
  const [range, setRange] = useState<'all' | 'last24' | 'last12'>('all')
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ctrl = useRef<AbortController | null>(null)

  const frames = range === 'all' ? p.frames : p.frames.slice(range === 'last24' ? -24 : -12)
  const seconds = frames.length / p.fps
  const viewLabel = { tc: 'true-colour', ndvi: 'vegetation', ndwi: 'water', ndbi: 'built-up', chgPrev: 'change', chgBase: 'change' }[p.view]

  async function run() {
    setError(null)
    ctrl.current = new AbortController()
    setProgress([0, frames.length])
    try {
      const ef: ExportFrame[] = []
      for (const f of frames) {
        const url = await p.cache.get(f.id, p.view)
        if (!url) continue
        const overlayUrl = p.overlay ? (await p.cache.get(f.id, p.overlay)) ?? undefined : undefined
        ef.push({ date: f.date, sensor: p.sensorLabel(f), url, overlayUrl })
      }
      if (!ef.length) throw new Error('No frames to export')
      const opts = {
        frames: ef, fps: p.fps, maxSize: size, title: p.areaName, attribution: p.attribution(frames),
        pixelated: p.pixelated, signal: ctrl.current.signal, onProgress: (d: number, t: number) => setProgress([d, t]),
      }
      const name = `${slug(p.areaName)}-${viewLabel}-${frames[0].date}-to-${frames.at(-1)!.date}`
      if (format === 'gif') download(await exportGif(opts), `${name}.gif`)
      else { const v = await exportVideo(opts); download(v.blob, `${name}.${v.ext}`) }
    } catch (e) {
      if (!ctrl.current.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium"><Film size={14} /> Export timelapse</span>
        <button type="button" onClick={p.onClose} aria-label="Close export" className="text-neutral-500 hover:text-neutral-200"><X size={14} /></button>
      </div>
      <Segmented<'gif' | 'mp4'> label="Format" value={format} onChange={setFormat} options={[
        { value: 'mp4', label: 'MP4 video', title: 'Small file, best quality; plays everywhere' },
        { value: 'gif', label: 'GIF', title: 'Plays inline in chats and docs; larger file' },
      ]} />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-neutral-400">Size
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="mt-0.5 w-full rounded border border-line bg-panel px-2 py-1 text-xs text-neutral-200">
            <option value={480}>480 px</option><option value={720}>720 px</option><option value={1080}>1080 px</option><option value={4096}>Full resolution</option>
          </select>
        </label>
        <label className="text-[11px] text-neutral-400">Frames
          <select value={range} onChange={(e) => setRange(e.target.value as typeof range)} className="mt-0.5 w-full rounded border border-line bg-panel px-2 py-1 text-xs text-neutral-200">
            <option value="all">All ({p.frames.length})</option>
            {p.frames.length > 24 && <option value="last24">Last 24</option>}
            {p.frames.length > 12 && <option value="last12">Last 12</option>}
          </select>
        </label>
      </div>
      <p className="text-[11px] leading-relaxed text-neutral-500">
        Uses the current layer ({viewLabel}{p.overlay ? ' + change highlight' : ''}) and speed ({p.fps}×): {frames.length} frames, about {seconds.toFixed(0)} s.
        Date and data attribution are burned into every frame.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {progress ? (
        <div>
          <div className="h-1.5 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-accent transition-all" style={{ width: `${(100 * progress[0]) / Math.max(1, progress[1])}%` }} /></div>
          <div className="mt-1 flex justify-between text-[11px] text-neutral-400">
            <span>Encoding frame {progress[0]} of {progress[1]}…</span>
            <button type="button" onClick={() => ctrl.current?.abort()} className="hover:text-white">Cancel</button>
          </div>
        </div>
      ) : (
        <Button variant="primary" className="w-full" onClick={run}><Download size={14} /> Export {format.toUpperCase()}</Button>
      )}
    </div>
  )
}
