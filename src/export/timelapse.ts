// Timelapse export (GIF via gifenc, MP4 via WebCodecs + mediabunny), fully in
// the browser. Every frame has the date, sensor and the required data
// attribution burned in, so exports stay compliant wherever they're shared.
import { applyPalette, GIFEncoder, quantize } from 'gifenc'
import { BRAND } from '../config/brand'

export interface ExportFrame {
  date: string
  sensor: string
  /** Object URL of the base image. */
  url: string
  /** Optional overlay (e.g. change mask) drawn on top. */
  overlayUrl?: string
}

export interface ExportOptions {
  frames: ExportFrame[]
  fps: number
  /** Longest image side in px (even). */
  maxSize: number
  title: string
  /** Attribution line(s) required by the data sources. */
  attribution: string
  /** Nearest-neighbour scaling (true pixels) vs smooth. */
  pixelated: boolean
  signal?: AbortSignal
  onProgress?(done: number, total: number): void
}

const BAR = 30
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

async function bitmap(url: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(url)).blob())
}

function fmt(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Lays out one frame: imagery, date badge, attribution bar. */
class FrameRenderer {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly imgW: number
  readonly imgH: number

  constructor(srcW: number, srcH: number, private opts: ExportOptions) {
    const scale = Math.min(1, opts.maxSize / Math.max(srcW, srcH))
    this.imgW = even(srcW * scale)
    this.imgH = even(srcH * scale)
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.imgW
    this.canvas.height = this.imgH + BAR
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
  }

  async draw(f: ExportFrame) {
    const { ctx, imgW, imgH } = this
    ctx.fillStyle = '#0b0c0e'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.imageSmoothingEnabled = !this.opts.pixelated
    const base = await bitmap(f.url)
    ctx.drawImage(base, 0, 0, imgW, imgH)
    base.close()
    if (f.overlayUrl) {
      const ov = await bitmap(f.overlayUrl)
      ctx.drawImage(ov, 0, 0, imgW, imgH)
      ov.close()
    }
    // Date badge (top-left).
    const s = Math.max(1, imgW / 720)
    ctx.font = `600 ${Math.round(18 * s)}px ui-monospace, Menlo, Consolas, monospace`
    const dateText = fmt(f.date)
    const sub = `${f.sensor} · ${this.opts.title}`
    ctx.font = `600 ${Math.round(18 * s)}px ui-monospace, Menlo, Consolas, monospace`
    const w1 = ctx.measureText(dateText).width
    ctx.font = `${Math.round(11 * s)}px system-ui, sans-serif`
    const w2 = ctx.measureText(sub).width
    const pad = 8 * s
    ctx.fillStyle = 'rgba(10,11,13,0.78)'
    ctx.beginPath()
    ctx.roundRect(10 * s, 10 * s, Math.max(w1, w2) + pad * 2, 44 * s, 6 * s)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `600 ${Math.round(18 * s)}px ui-monospace, Menlo, Consolas, monospace`
    ctx.fillText(dateText, 10 * s + pad, 10 * s + 22 * s)
    ctx.fillStyle = '#c4c4c8'
    ctx.font = `${Math.round(11 * s)}px system-ui, sans-serif`
    ctx.fillText(sub, 10 * s + pad, 10 * s + 38 * s)
    // Attribution bar (bottom, outside the imagery).
    ctx.fillStyle = '#111214'
    ctx.fillRect(0, imgH, imgW, BAR)
    ctx.font = '11px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#d4d4d8'
    ctx.fillText(this.opts.attribution, 8, imgH + BAR / 2, imgW * 0.68)
    ctx.fillStyle = '#8b8b93'
    ctx.textAlign = 'right'
    ctx.fillText(`${BRAND.name} · ${BRAND.siteUrl.replace(/^https?:\/\//, '')}`, imgW - 8, imgH + BAR / 2, imgW * 0.3)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }
}

async function makeRenderer(opts: ExportOptions) {
  const first = await bitmap(opts.frames[0].url)
  const r = new FrameRenderer(first.width, first.height, opts)
  first.close()
  return r
}

const tick = () => new Promise((r) => setTimeout(r, 0))

export async function exportGif(opts: ExportOptions): Promise<Blob> {
  const r = await makeRenderer(opts)
  const gif = GIFEncoder()
  const delay = Math.round(1000 / opts.fps)
  for (let i = 0; i < opts.frames.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    await r.draw(opts.frames[i])
    const { data, width, height } = r.ctx.getImageData(0, 0, r.canvas.width, r.canvas.height)
    const palette = quantize(data, 256)
    // Hold the last frame so loops have a clear end.
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: i === opts.frames.length - 1 ? Math.max(delay, 1500) : delay })
    opts.onProgress?.(i + 1, opts.frames.length)
    await tick()
  }
  gif.finish()
  return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' })
}

export async function exportVideo(opts: ExportOptions): Promise<{ blob: Blob; ext: string }> {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH, getFirstEncodableVideoCodec } = await import('mediabunny')
  const r = await makeRenderer(opts)
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: r.canvas.width, height: r.canvas.height })
  if (!codec) throw new Error("This browser can't encode video. Try GIF, or a recent Chrome, Edge or Safari.")
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  const source = new CanvasSource(r.canvas, { codec, bitrate: QUALITY_HIGH })
  output.addVideoTrack(source, { frameRate: opts.fps })
  await output.start()
  const dur = 1 / opts.fps
  let ts = 0
  for (let i = 0; i < opts.frames.length; i++) {
    if (opts.signal?.aborted) { await output.cancel(); throw new DOMException('Cancelled', 'AbortError') }
    await r.draw(opts.frames[i])
    const d = i === opts.frames.length - 1 ? Math.max(dur, 1.5) : dur
    await source.add(ts, d)
    ts += d
    opts.onProgress?.(i + 1, opts.frames.length)
  }
  await output.finalize()
  return { blob: new Blob([output.target.buffer!], { type: 'video/mp4' }), ext: 'mp4' }
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'area'
