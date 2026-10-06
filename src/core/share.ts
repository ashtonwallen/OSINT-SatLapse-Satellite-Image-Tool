// Share links carry only the polygon and name, in the URL fragment (never sent
// to any server). The recipient runs their own backfill.
import type { LngLat, PolygonGeometry } from './geo'

export interface SharedArea { name: string; geometry: PolygonGeometry }

const b64url = {
  encode: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))),
}

export function encodeShare(a: SharedArea): string {
  const ring = a.geometry.coordinates[0].map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)])
  return b64url.encode(JSON.stringify({ v: 1, n: a.name, r: ring }))
}

export function decodeShare(token: string): SharedArea | null {
  try {
    const j = JSON.parse(b64url.decode(token)) as { v: number; n: unknown; r: unknown }
    if (j.v !== 1 || !Array.isArray(j.r) || j.r.length < 4 || j.r.length > 500) return null
    const ring = j.r.map((p) => {
      if (!Array.isArray(p) || p.length !== 2) throw new Error('bad point')
      const [x, y] = p.map(Number)
      if (!(x >= -180 && x <= 180 && y >= -85 && y <= 85)) throw new Error('bad point')
      return [x, y] as LngLat
    })
    return { name: String(j.n ?? 'Shared area').slice(0, 100), geometry: { type: 'Polygon', coordinates: [ring] } }
  } catch {
    return null
  }
}
