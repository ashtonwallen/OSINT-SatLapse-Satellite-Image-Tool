// Run the full backfill engine under Node (no browser): proves src/core is
// server-portable and generates the bundled example project.
// Usage: npx jiti scripts/sync-node.ts <name> <minLng,minLat,maxLng,maxLat> <1y|3y|all> <all|month|quarter> <out.satlapse> [maxCloud]
import { writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { createArea, createInvestigation } from '../src/core/area'
import { syncArea } from '../src/core/engine'
import { exportProjectFile } from '../src/core/project'
import { MemoryStorage, type ImageEncoder } from '../src/core/storage'
import type { HistoryDepth, Sampling } from '../src/core/types'

const encoder: ImageEncoder = {
  async encode(rgba, width, height, kind) {
    const img = sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } })
    const buf = kind === 'overlay' ? await img.png({ compressionLevel: 9, palette: true }).toBuffer() : await img.webp({ quality: 82, alphaQuality: 100 }).toBuffer()
    return new Blob([new Uint8Array(buf)], { type: kind === 'overlay' ? 'image/png' : 'image/webp' })
  },
}

const [name, bboxArg, depth, sampling, out, maxCloud = '20'] = process.argv.slice(2)
const [x0, y0, x1, y1] = bboxArg.split(',').map(Number)
const project = createInvestigation(name)
const area = createArea(name, { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] }, {
  historyDepth: depth as HistoryDepth, sampling: sampling as Sampling, maxCloudPct: Number(maxCloud),
}, project.id)
console.log(`${area.name}: ${area.areaKm2.toFixed(1)} km², grid ${area.grid.width}x${area.grid.height} @ ${area.grid.res} m, EPSG:${area.grid.epsg}`)
const storage = new MemoryStorage()
await storage.putInvestigation(project)
await storage.putArea(area)

let bytes = 0, requests = 0
const realFetch = globalThis.fetch
globalThis.fetch = async (i, init) => { requests++; const r = await realFetch(i, init); bytes += Number(r.headers.get('content-length') ?? 0); return r }

const t0 = Date.now()
let phaseStart = t0, lastPhase = ''
const res = await syncArea(area.id, storage, encoder, {
  mode: 'backfill',
  onProgress: (p) => {
    if (p.phase !== lastPhase) {
      if (lastPhase) console.log(`  ${lastPhase} took ${((Date.now() - phaseStart) / 1000).toFixed(1)} s, cumulative ${(bytes / 1e6).toFixed(0)} MB / ${requests} req`)
      lastPhase = p.phase; phaseStart = Date.now()
    }
    if (p.done === p.total || p.done % 25 === 0) process.stdout.write(`\r  [${p.phase}] ${p.message}            `)
  },
})
console.log(`\n${JSON.stringify(res)} in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(bytes / 1e6).toFixed(0)} MB, ${requests} requests`)
const scenes = await storage.listScenes(area.id)
for (const s of scenes.filter((x) => x.status === 'processed' && x.stats)) {
  const st = s.stats!
  console.log(`  ${s.date} cloud ${s.cloudPct.toFixed(1)}% veg ${st.vegPct.toFixed(1)} water ${st.waterPct.toFixed(1)} built ${st.builtPct.toFixed(1)}${st.vsPrev ? ` Δprev ${st.vsPrev.changedPct.toFixed(1)}%` : ''}`)
}
for (const e of await storage.listEvents(area.id)) console.log(`  EVENT ${e.date} ${e.title}${e.recurring ? ' (recurring)' : ''}: ${e.description}`)
const zip = await exportProjectFile(storage, project.id)
writeFileSync(out, zip)
console.log(`wrote ${out}: ${(zip.length / 1e6).toFixed(1)} MB`)
for (const s of scenes.filter((x) => x.sensor === 'naip')) {
  const img = await storage.getImage(s.id, 'tc')
  console.log(`  NAIP ${s.date} ${s.status} gsd ${s.gsd} m grid ${s.grid!.width}x${s.grid!.height} @ ${s.grid!.res} m, coverage ${s.coveragePct.toFixed(0)}%, ${img ? (img.size / 1e6).toFixed(2) + ' MB' : 'no image'}`)
  if (img && process.env.DUMP_DIR) writeFileSync(`${process.env.DUMP_DIR}/naip-${s.date}.webp`, new Uint8Array(await img.arrayBuffer()))
}
