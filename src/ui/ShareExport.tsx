import { Check, FileDown, FileText, Link2, LoaderCircle, Printer } from 'lucide-react'
import { useState } from 'react'
import type { Area, Investigation } from '../core/types'
import { exportProjectBytes } from '../app/actions'
import { loadProjectData } from '../app/aiHost'
import { shareUrl } from '../core/share'
import { PROJECT_EXT } from '../core/project'
import { buildReportHtml, printReport } from '../export/report'
import { download, slug } from '../export/timelapse'
import { Button } from './kit'

export function ShareExport({ project, areas }: { project: Investigation; areas: Area[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = (label: string, fn: () => Promise<void>) => async () => {
    setBusy(label)
    setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  const spin = (label: string, icon: React.ReactNode) => (busy === label ? <LoaderCircle size={13} className="animate-spin" /> : icon)
  const base = `${location.origin}${import.meta.env.BASE_URL}`

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button className="text-xs" disabled={!!busy || !areas.length} title="Self-contained HTML report with images, findings and sources"
          onClick={run('html', async () => download(new Blob([await buildReportHtml(await loadProjectData(project.id))], { type: 'text/html' }), `${slug(project.name)}-report.html`))}>
          {spin('html', <FileText size={13} />)} Report (HTML)
        </Button>
        <Button className="text-xs" disabled={!!busy || !areas.length} title="Opens the print dialog: choose 'Save as PDF'"
          onClick={run('pdf', async () => printReport(await buildReportHtml(await loadProjectData(project.id))))}>
          {spin('pdf', <Printer size={13} />)} Report (PDF)
        </Button>
        <Button className="text-xs" disabled={!!busy || !areas.length} title="Everything in this project, to import into SatLapse elsewhere"
          onClick={run('file', async () => download(new Blob([(await exportProjectBytes(project.id)) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${slug(project.name)}${PROJECT_EXT}`))}>
          {spin('file', <FileDown size={13} />)} Project file
        </Button>
        <Button className="text-xs" disabled={!areas.length} title="Link with the area outlines only; recipients fetch their own imagery"
          onClick={async () => {
            await navigator.clipboard.writeText(shareUrl(base, { name: project.name, areas: areas.map((a) => ({ name: a.name, geometry: a.geometry })) }))
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}>
          {copied ? <Check size={13} /> : <Link2 size={13} />} {copied ? 'Link copied' : 'Share link'}
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <p className="text-[10px] leading-relaxed text-neutral-500">
        Share links contain only the project name and area outlines (in the part of the URL after #, which isn't sent to any server).
        Notes, annotations and imagery stay with you unless you send the project file or report.
      </p>
    </div>
  )
}
