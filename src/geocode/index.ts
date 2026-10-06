// Place search behind a provider interface so the geocoder can be swapped.
import type { BBox, LngLat } from '../core/geo'

export interface Place {
  name: string
  detail: string
  center: LngLat
  bbox?: BBox
}

export interface Geocoder {
  readonly id: string
  readonly attribution: string
  search(query: string, signal?: AbortSignal): Promise<Place[]>
}

/**
 * Photon (photon.komoot.io): key-free OpenStreetMap geocoder whose usage
 * policy allows client-side search with fair use. We search on submit (not on
 * every keystroke) and enforce at most one request per second.
 */
class PhotonGeocoder implements Geocoder {
  readonly id = 'photon'
  readonly attribution = 'Search by Photon (komoot), data © OpenStreetMap contributors'
  private last = 0

  async search(query: string, signal?: AbortSignal): Promise<Place[]> {
    const q = query.trim()
    if (!q) return []
    const wait = this.last + 1000 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.last = Date.now()
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`, { signal })
    if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status})`)
    const j = (await res.json()) as {
      features: { geometry: { coordinates: LngLat }; properties: Record<string, string | number[] | undefined> }[]
    }
    return j.features.map((f) => {
      const p = f.properties
      const ext = p.extent as number[] | undefined
      return {
        name: String(p.name ?? p.street ?? p.city ?? 'Unnamed place'),
        detail: [p.city, p.state, p.country].filter((v) => v && v !== p.name).join(', '),
        center: f.geometry.coordinates,
        // Photon extent is [minLon, maxLat, maxLon, minLat].
        bbox: ext ? [ext[0], ext[3], ext[2], ext[1]] : undefined,
      }
    })
  }
}

export const geocoder: Geocoder = new PhotonGeocoder()
