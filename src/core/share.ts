// Share links carry only the project name and its areas' outlines + names,
// in the URL fragment (never sent to any server). The recipient runs their
// own backfill; no imagery, notes or annotations are shared.
import type { LngLat, PolygonGeometry } from './geo'

export interface SharedArea { name: string; geometry: PolygonGeometry }
export interface SharedProject { name: string; areas: SharedArea[] }

const b64url = {
  encode: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))),
}

const MAX_AREAS = 20
const MAX_POINTS = 500

function ringOut(g: PolygonGeometry) {
  return g.coordinates[0].map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)])
}

function ringIn(r: unknown): PolygonGeometry {
  if (!Array.isArray(r) || r.length < 4 || r.length > MAX_POINTS) throw new Error('bad ring')
  const ring = r.map((p) => {
    if (!Array.isArray(p) || p.length !== 2) throw new Error('bad point')
    const [x, y] = p.map(Number)
    if (!(x >= -180 && x <= 180 && y >= -85 && y <= 85)) throw new Error('bad point')
    return [x, y] as LngLat
  })
  return { type: 'Polygon', coordinates: [ring] }
}

const cleanName = (n: unknown, fallback: string) => String(n ?? fallback).replace(/[\u0000-\u001f]/g, '').slice(0, 100) || fallback

export function encodeProjectShare(p: SharedProject): string {
  return b64url.encode(JSON.stringify({ v: 2, n: p.name, a: p.areas.slice(0, MAX_AREAS).map((a) => ({ n: a.name, r: ringOut(a.geometry) })) }))
}

/** Accepts v2 project tokens and legacy v1 single-area tokens. */
export function decodeProjectShare(token: string): SharedProject | null {
  try {
    const j = JSON.parse(b64url.decode(token)) as { v: number; n: unknown; a?: unknown; r?: unknown }
    if (j.v === 1) return { name: cleanName(j.n, 'Shared area'), areas: [{ name: cleanName(j.n, 'Shared area'), geometry: ringIn(j.r) }] }
    if (j.v !== 2 || !Array.isArray(j.a) || !j.a.length || j.a.length > MAX_AREAS) return null
    return {
      name: cleanName(j.n, 'Shared project'),
      areas: j.a.map((x: { n?: unknown; r?: unknown }) => ({ name: cleanName(x.n, 'Shared area'), geometry: ringIn(x.r) })),
    }
  } catch {
    return null
  }
}

/** Legacy single-area API (kept for v1 links and tests). */
export function encodeShare(a: SharedArea): string {
  return b64url.encode(JSON.stringify({ v: 1, n: a.name, r: ringOut(a.geometry) }))
}
export function decodeShare(token: string): SharedArea | null {
  const p = decodeProjectShare(token)
  return p && p.areas.length === 1 ? p.areas[0] : null
}

export function shareUrl(base: string, p: SharedProject): string {
  return `${base.replace(/#.*$/, '')}#p=${encodeProjectShare(p)}`
}

/** Reads `#p=` (v2) or `#share=` (v1) from a location hash. */
export function readShareHash(hash: string): SharedProject | null {
  const m = /[#&](?:p|share)=([A-Za-z0-9_-]+)/.exec(hash)
  return m ? decodeProjectShare(m[1]) : null
}
