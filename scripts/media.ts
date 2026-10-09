// Builds README media and the Open Graph image from the bundled example:
//   docs/replay.gif  (timelapse with date + attribution burned in)
//   public/og.png    (1200×630 link-preview card)
// Usage: npx jiti scripts/media.ts [public/examples/oroville.satlapse]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import sharp from 'sharp'

const file = process.argv[2] ?? 'public/examples/oroville.satlapse'
const z = unzipSync(readFileSync(file))
const m = JSON.parse(strFromU8(z['manifest.json'])) as {
  project: { name: string }
  areas: { area: { name: string }; scenes: { id: string; date: string; status: string; sensor?: string; stats?: { waterPct: number } }[]; images: { sceneId: string; kind: string; path: string }[] }[]
}
const a = m.areas[0]
const frames = a.scenes.filter((s) => s.status === 'processed' && s.stats && !s.sensor)
const tcPath = (id: string) => a.images.find((i) => i.sceneId === id && i.kind === 'tc')?.path
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })

// --- GIF -------------------------------------------------------------------
const W = 520
mkdirSync('docs', { recursive: true })
const gif = GIFEncoder()
for (const [i, s] of frames.entries()) {
  const p = tcPath(s.id)
  if (!p) continue
  const img = sharp(Buffer.from(z[p])).resize(W).flatten({ background: '#0b0c0e' })
  const { width, height } = await img.clone().metadata().then(async () => (await img.clone().png().toBuffer({ resolveWithObject: true })).info)
  const label = Buffer.from(`<svg width="${width}" height="${height + 26}">
    <rect x="10" y="10" rx="5" width="150" height="34" fill="rgba(10,11,13,.8)"/>
    <text x="20" y="33" font-family="monospace" font-weight="700" font-size="17" fill="#fff">${esc(fmt(s.date))}</text>
    <rect y="${height}" width="${width}" height="26" fill="#111214"/>
    <text x="8" y="${height + 17}" font-family="sans-serif" font-size="11" fill="#d4d4d8">${esc(`${a.area.name} · Water ${s.stats!.waterPct.toFixed(0)}% · Contains modified Copernicus Sentinel data`)}</text>
  </svg>`)
  const { data, info } = await sharp({ create: { width, height: height + 26, channels: 4, background: '#0b0c0e' } })
    .composite([{ input: await img.png().toBuffer(), top: 0, left: 0 }, { input: label, top: 0, left: 0 }])
    .raw().toBuffer({ resolveWithObject: true })
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
  const palette = quantize(rgba, 256)
  gif.writeFrame(applyPalette(rgba, palette), info.width, info.height, { palette, delay: i === frames.length - 1 ? 1800 : 450 })
}
gif.finish()
writeFileSync('docs/replay.gif', gif.bytes())
console.log(`docs/replay.gif: ${frames.length} frames, ${(gif.bytes().length / 1e6).toFixed(1)} MB`)

// --- Open Graph card (1200×630) ---------------------------------------------
const byWater = [...frames].sort((x, y) => x.stats!.waterPct - y.stats!.waterPct)
const low = byWater[0], high = byWater.at(-1)!
const T = 250
const tile = async (s: typeof low) => sharp(Buffer.from(z[tcPath(s.id)!])).resize(T, T, { fit: 'cover' }).png().toBuffer()
const cap = (text: string) => Buffer.from(`<svg width="${T}" height="30"><rect width="${T}" height="30" fill="rgba(10,11,13,.82)"/><text x="10" y="20" font-family="monospace" font-size="14" fill="#fff">${esc(text)}</text></svg>`)
const card = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#0a0a0b"/>
  <rect x="64" y="72" width="30" height="30" rx="6" fill="#38bdf8"/>
  <text x="108" y="97" font-family="sans-serif" font-weight="700" font-size="30" fill="#fff">SatLapse</text>
  <text x="64" y="200" font-family="sans-serif" font-weight="700" font-size="42" fill="#fff">Watch any place</text>
  <text x="64" y="252" font-family="sans-serif" font-weight="700" font-size="42" fill="#fff">on Earth change.</text>
  <text x="64" y="316" font-family="sans-serif" font-size="22" fill="#a1a1aa">Free satellite timelapse &amp; change detection</text>
  <text x="64" y="346" font-family="sans-serif" font-size="22" fill="#a1a1aa">that runs entirely in your browser.</text>
  <text x="64" y="420" font-family="sans-serif" font-size="18" fill="#d4d4d8">Sentinel-2 · Landsat · aerial · flagged changes · AI</text>
  <text x="64" y="566" font-family="sans-serif" font-size="14" fill="#71717a">${esc(a.area.name)} · Contains modified Copernicus Sentinel data</text>
</svg>`)
await sharp(card)
  .composite([
    { input: await tile(low), left: 630, top: 150 },
    { input: cap(`${fmt(low.date)} · water ${low.stats!.waterPct.toFixed(0)}%`), left: 630, top: 370 },
    { input: await tile(high), left: 900, top: 150 },
    { input: cap(`${fmt(high.date)} · water ${high.stats!.waterPct.toFixed(0)}%`), left: 900, top: 370 },
  ])
  .png()
  .toFile('public/og.png')
console.log('public/og.png written')
