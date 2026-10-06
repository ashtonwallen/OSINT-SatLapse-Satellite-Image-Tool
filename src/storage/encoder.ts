import type { ImageEncoder } from '../core/storage'

/** OffscreenCanvas encoder (works in workers). WebP for imagery, PNG for
 *  overlays; falls back to PNG where WebP encoding is unsupported (Safari). */
export const canvasEncoder: ImageEncoder = {
  async encode(rgba, width, height, kind) {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
    if (kind === 'overlay') return canvas.convertToBlob({ type: 'image/png' })
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
    return blob.type === 'image/webp' ? blob : canvas.convertToBlob({ type: 'image/png' })
  },
}
