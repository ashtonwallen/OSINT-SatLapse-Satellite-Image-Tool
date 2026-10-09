// Interface for on-demand commercial high-resolution imagery (paid tier).
// No implementation ships. A provider adapter (e.g. an aggregator such as
// SkyFi or UP42, or Planet/Maxar/Airbus directly) would live server-side,
// because ordering requires secret credentials and payment. The browser
// app would talk to the SatLapse backend, which implements this interface.
import type { PolygonGeometry } from './geo'

export interface ArchiveQuery {
  aoi: PolygonGeometry
  from: string
  to: string
  maxCloudPct?: number
  /** Finest acceptable ground sample distance, metres. */
  maxGsdM?: number
}

export interface ArchiveScene {
  providerSceneId: string
  provider: string
  datetime: string
  gsdM: number
  cloudPct: number | null
  /** Low-res preview URL, if the provider offers one. */
  previewUrl?: string
  footprint: PolygonGeometry
}

export interface Quote {
  quoteId: string
  priceMinor: number
  currency: string
  /** Area actually billed (providers have minimum order sizes). */
  billedKm2: number
  expiresAt: string
  licence: string
}

export type OrderStatus = 'pending' | 'processing' | 'delivered' | 'failed' | 'cancelled'

export interface Order {
  orderId: string
  status: OrderStatus
  quote: Quote
  /** Signed COG URL(s) once delivered; read with the same COG reader. */
  assets?: { href: string; bands: string[]; gsdM: number }[]
  error?: string
}

export interface OnDemandImageryProvider {
  id: string
  label: string
  /** Search the provider's existing archive. */
  searchArchive(q: ArchiveQuery): Promise<ArchiveScene[]>
  /** Price an archive scene (or a future tasking request) for an area. */
  quote(scene: ArchiveScene, aoi: PolygonGeometry): Promise<Quote>
  /** Place an order against a quote (server-side, after payment). */
  order(quoteId: string): Promise<Order>
  status(orderId: string): Promise<Order>
}
