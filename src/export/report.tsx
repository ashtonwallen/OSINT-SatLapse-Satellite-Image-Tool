// Self-contained HTML report for a project (images inlined as data URIs).
// Every finding cites the scene date, sensor and source item ID it came from,
// with data attribution. The same HTML is printed to PDF via the browser.
import { renderToStaticMarkup } from 'react-dom/server'
import type { ProjectData } from '../ai/context'
import { BRAND } from '../config/brand'
import { copernicusAttribution } from '../core/attribution'
import { polygonCentroid } from '../core/area'
import type { Area, ChangeEvent, SceneRecord } from '../core/types'
import { storage } from '../storage/idb'
import { Markdown } from '../ui/Markdown'

const SERIES = [
  { key: 'vegPct', label: 'Vegetation', color: '#199e70' },
  { key: 'waterPct', label: 'Water', color: '#3987e5' },
  { key: 'builtPct', label: 'Built & bare', color: '#d95926' },
] as const

const sensorText = (s: SceneRecord) => s.sensor === 'naip' ? `NAIP aerial (${s.gsd} m)` : s.sensor === 'landsat' ? 'Landsat (30 m)' : 'Sentinel-2 (10 m)'
const sourceText = (s: SceneRecord) => s.sources.map((x) => `${x.sourceId}: ${x.itemId}`).join('; ')
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

async function dataUri(sceneId: string, maxDim = 900): Promise<string | null> {
  const blob = await storage.getImage(sceneId, 'tc')
  if (!blob) return null
  const bmp = await createImageBitmap(blob)
  const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
  const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s))
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  const jpg = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(jpg) })
}

function Chart({ scenes }: { scenes: SceneRecord[] }) {
  const pts = scenes.filter((s) => s.stats)
  if (pts.length < 2) return null
  const W = 640, H = 200, L = 34, R = 10, T = 10, B = 22
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`)
  const t0 = t(pts[0].date), t1 = t(pts.at(-1)!.date)
  const x = (d: string) => L + ((t(d) - t0) / Math.max(1, t1 - t0)) * (W - L - R)
  const yMax = Math.min(100, Math.ceil(Math.max(10, ...pts.flatMap((p) => SERIES.map((s) => p.stats![s.key]))) / 10) * 10)
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B)
  const years: number[] = []
  for (let yr = new Date(t0).getUTCFullYear() + 1; yr <= new Date(t1).getUTCFullYear(); yr++) years.push(yr)
  const every = Math.ceil(years.length / 10)
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Land cover over time">
        {[0, yMax / 2, yMax].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e4e4e7" /><text x={L - 4} y={y(v) + 3} fontSize="9" textAnchor="end" fill="#71717a">{v}%</text></g>)}
        {years.filter((_, i) => i % every === 0).map((yr) => <text key={yr} x={x(`${yr}-01-01`)} y={H - 6} fontSize="9" textAnchor="middle" fill="#71717a">{yr}</text>)}
        {SERIES.map((s) => <path key={s.key} fill="none" stroke={s.color} strokeWidth="2" d={pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.stats![s.key]).toFixed(1)}`).join('')} />)}
      </svg>
      <figcaption>
        {SERIES.map((s) => <span key={s.key} className="key"><i style={{ background: s.color }} />{s.label}</span>)}
        <span className="muted">% of clear pixels in the area. "Built &amp; bare" includes bare soil.</span>
      </figcaption>
    </figure>
  )
}

interface AreaBlock { area: Area; optical: SceneRecord[]; aerial: SceneRecord[]; events: ChangeEvent[]; images: Record<string, string | null> }

function Report({ data, blocks, generated }: { data: ProjectData; blocks: AreaBlock[]; generated: string }) {
  const all = blocks.flatMap((b) => [...b.optical, ...b.aerial])
  const s2Years = all.filter((s) => !s.sensor || s.sensor === 'sentinel-2').map((s) => Number(s.date.slice(0, 4)))
  const credits = [
    s2Years.length ? copernicusAttribution(s2Years) : null,
    all.some((s) => s.sensor === 'landsat') ? 'Landsat imagery courtesy of the U.S. Geological Survey' : null,
    all.some((s) => s.sensor === 'naip') ? 'NAIP imagery: USDA Farm Production and Conservation Business Center (public domain)' : null,
  ].filter(Boolean)
  return (
    <>
      <header>
        <div className="brand">{BRAND.name} report</div>
        <h1>{data.project.name}</h1>
        <p className="muted">Generated {generated} · {blocks.length} area{blocks.length === 1 ? '' : 's'} · {data.annotations.length} annotation{data.annotations.length === 1 ? '' : 's'}</p>
      </header>

      {data.project.notes.trim() && (
        <section><h2>Notes</h2><div className="notes"><Markdown source={data.project.notes} /></div></section>
      )}

      {blocks.map(({ area, optical, aerial, events, images }) => {
        const [lng, lat] = polygonCentroid(area.geometry)
        const first = optical[0], last = optical.at(-1)
        const conf = events.filter((e) => e.confidence !== 'low').sort((a, b) => a.date.localeCompare(b.date))
        const anns = data.annotations.filter((a) => a.areaId === area.id)
        return (
          <section key={area.id} className="area">
            <h2>{area.name}</h2>
            <p className="muted">
              Centre {lat.toFixed(5)}, {lng.toFixed(5)} · {area.areaKm2.toFixed(2)} km² ·{' '}
              {optical.length} clear satellite scenes{first && last ? ` (${first.date} to ${last.date})` : ''}{aerial.length ? ` · ${aerial.length} aerial years` : ''}
            </p>

            {first && last && first !== last && (
              <div className="pair">
                {[first, last].map((s, i) => (
                  <figure key={s.id}>
                    {images[s.id] && <img src={images[s.id]!} alt={`${area.name}, ${s.date}`} />}
                    <figcaption><b>{i === 0 ? 'Earliest' : 'Latest'}: {fmt(s.date)}</b><br />{sensorText(s)} · <span className="src">{sourceText(s)}</span></figcaption>
                  </figure>
                ))}
              </div>
            )}

            <h3>Land cover over time</h3>
            <Chart scenes={optical} />
            {first?.stats && last?.stats && first !== last && (
              <table>
                <thead><tr><th /><th>{first.date}</th><th>{last.date}</th><th>Change</th></tr></thead>
                <tbody>
                  {SERIES.map((s) => (
                    <tr key={s.key}><td>{s.label}</td><td>{first.stats![s.key].toFixed(1)}%</td><td>{last.stats![s.key].toFixed(1)}%</td>
                      <td>{(last.stats![s.key] - first.stats![s.key] > 0 ? '+' : '') + (last.stats![s.key] - first.stats![s.key]).toFixed(1)} pts</td></tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3>Findings</h3>
            {conf.length === 0 && <p className="muted">No high- or medium-confidence changes were flagged.{events.length ? ` (${events.length} low-confidence flags omitted.)` : ''}</p>}
            {conf.map((e) => {
              const s = optical.find((x) => x.id === e.sceneId)
              return (
                <div key={e.id} className="finding">
                  {images[e.sceneId] && <img src={images[e.sceneId]!} alt={`${area.name}, ${e.date}`} />}
                  <div>
                    <h4>{e.title} <span className={`conf ${e.confidence}`}>{e.confidence} confidence</span></h4>
                    <p>{e.description}</p>
                    <p className="cite">
                      Scene {fmt(e.date)}{s ? `, ${sensorText(s)}, ${sourceText(s)}` : ''}. Method: {e.method === 'seasonal' ? `compared with the same season in ${e.reference.years.join(', ')}` : `compared with the previous scene (${e.previousDate})`}.
                      {e.confirmedBy ? ' Confirmed by the following scene.' : ''}
                    </p>
                  </div>
                </div>
              )
            })}

            {anns.length > 0 && (
              <>
                <h3>Annotations</h3>
                <ul>{anns.map((a) => <li key={a.id}><b>{fmt(a.date)}</b> at {a.lngLat[1].toFixed(5)}, {a.lngLat[0].toFixed(5)}: {a.text}{a.author === 'ai' ? ' (AI-drafted, approved by the researcher)' : ''}</li>)}</ul>
              </>
            )}

            {aerial.length > 0 && (
              <p className="muted">High-resolution aerial imagery (NAIP) available for: {aerial.map((s) => `${s.date} (${s.gsd} m)`).join(', ')}.</p>
            )}
          </section>
        )
      })}

      <section>
        <h2>Data sources and method</h2>
        <ul>{credits.map((c) => <li key={c}>{c}</li>)}</ul>
        <p className="muted">
          Imagery: Sentinel-2 L2A surface reflectance (Element84 Earth Search, Microsoft Planetary Computer){all.some((s) => s.sensor === 'landsat') ? ', Landsat Collection 2 Level-2 harmonised to Sentinel-2 (Roy et al. 2016)' : ''}.
          Clouds are masked per pixel with the scene classification layer. Land cover uses fixed thresholds on NDVI, NDWI and NDBI; "built" includes bare soil.
          Flagged changes compare each scene with the same season in earlier years where at least two years of history exist; otherwise with the previous scene (low confidence).
          10 m pixels cannot resolve individual buildings or vehicles. Full methodology: {BRAND.siteUrl}/methodology
        </p>
      </section>
      <footer className="muted">Produced with {BRAND.name} ({BRAND.siteUrl}), an open-source, browser-only tool. Source IDs refer to STAC items in the named catalogues.</footer>
    </>
  )
}

const CSS = `
*{box-sizing:border-box}body{font:14px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#18181b;background:#fff;max-width:880px;margin:0 auto;padding:32px 24px}
h1{font-size:28px;margin:4px 0}h2{font-size:20px;margin:32px 0 6px;border-bottom:1px solid #e4e4e7;padding-bottom:4px}h3{font-size:15px;margin:20px 0 6px}h4{margin:0 0 4px;font-size:14px}
.brand{text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:#0284c7;font-weight:600}.muted{color:#71717a;font-size:12.5px}
img{max-width:100%;border-radius:4px;display:block}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:8px 0}figcaption{font-size:12px;color:#52525b;margin-top:4px}
.src{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;word-break:break-all}.key{margin-right:12px}.key i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
table{border-collapse:collapse;margin:8px 0;font-size:13px}td,th{border-bottom:1px solid #e4e4e7;padding:4px 12px 4px 0;text-align:left}th{font-weight:600;color:#52525b}
.finding{display:grid;grid-template-columns:180px 1fr;gap:14px;margin:12px 0;padding:10px;border:1px solid #e4e4e7;border-radius:6px;break-inside:avoid}.finding img{width:180px}
.cite{font-size:11.5px;color:#52525b}.conf{font-size:11px;font-weight:500;padding:1px 6px;border-radius:4px;margin-left:6px}.conf.high{background:#dcfce7;color:#166534}.conf.medium{background:#fef3c7;color:#92400e}
.notes{background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;padding:12px 16px}.notes *{color:#27272a!important}footer{margin-top:40px;border-top:1px solid #e4e4e7;padding-top:8px}
@media print{body{padding:0}.area{break-before:page}h2,h3{break-after:avoid}}
`

export async function buildReportHtml(data: ProjectData): Promise<string> {
  const blocks: AreaBlock[] = []
  for (const { area, scenes, events } of data.areas) {
    const optical = scenes.filter((s) => s.status === 'processed' && s.stats)
    const aerial = scenes.filter((s) => s.status === 'processed' && s.sensor === 'naip')
    const want = new Set([optical[0]?.id, optical.at(-1)?.id, ...events.filter((e) => e.confidence !== 'low').map((e) => e.sceneId)].filter(Boolean) as string[])
    const images: Record<string, string | null> = {}
    for (const id of want) images[id] = await dataUri(id, optical[0]?.id === id || optical.at(-1)?.id === id ? 900 : 360)
    blocks.push({ area, optical, aerial, events, images })
  }
  const generated = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })
  const body = renderToStaticMarkup(<Report data={data} blocks={blocks} generated={generated} />)
  const title = `${data.project.name} · ${BRAND.name} report`.replace(/[<>&"]/g, '')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}</style></head><body>${body}</body></html>`
}

/** Opens the browser's print dialog for the report (choose "Save as PDF"). */
export function printReport(html: string) {
  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  iframe.srcdoc = html
  iframe.onload = () => {
    const w = iframe.contentWindow!
    // Wait for inline images to decode before printing.
    setTimeout(() => { w.focus(); w.print(); setTimeout(() => iframe.remove(), 60_000) }, 300)
  }
  document.body.appendChild(iframe)
}
