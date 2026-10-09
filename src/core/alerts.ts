// Alert delivery interface for a future server-side tier (email, SMS,
// webhook). No implementations ship in the browser app. The detector's
// ChangeEvent objects convert losslessly into AlertPayload with toAlert(),
// so a scheduled server job can do:
//
//   const events = detectEvents(area.id, area.areaKm2, scenes)
//   for (const e of newSince(events, lastRun)) for (const ch of channels)
//     await ch.send(toAlert(e, area, baseUrl), subscriber)
import { polygonCentroid } from './area'
import type { Area, ChangeEvent, Confidence } from './types'

export type ChannelKind = 'email' | 'sms' | 'webhook'

export interface AlertPayload {
  /** Stable id for de-duplication (same as the event id). */
  id: string
  areaId: string
  areaName: string
  centre: { lat: number; lon: number }
  date: string
  kind: ChangeEvent['kind']
  confidence: Confidence
  title: string
  /** Plain-language explanation (from the detector). */
  summary: string
  km2: number
  /** Deep link to the area at this date. */
  url: string
  /** Full event for webhooks/consumers that want everything. */
  event: ChangeEvent
}

export interface Subscriber {
  id: string
  channel: ChannelKind
  /** Email address, E.164 phone number or webhook URL. */
  address: string
  /** Only alert at or above this confidence. */
  minConfidence: Confidence
}

export interface NotificationChannel {
  kind: ChannelKind
  send(alert: AlertPayload, to: Subscriber): Promise<{ ok: boolean; providerMessageId?: string; error?: string }>
}

const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }

export function shouldNotify(e: ChangeEvent, s: Subscriber): boolean {
  return rank[e.confidence] >= rank[s.minConfidence]
}

export function toAlert(e: ChangeEvent, area: Area, baseUrl: string): AlertPayload {
  const [lon, lat] = polygonCentroid(area.geometry)
  return {
    id: e.id,
    areaId: area.id,
    areaName: area.name,
    centre: { lat, lon },
    date: e.date,
    kind: e.kind,
    confidence: e.confidence,
    title: e.title,
    summary: e.description,
    km2: e.km2,
    url: `${baseUrl.replace(/\/$/, '')}/#area=${encodeURIComponent(area.id)}&date=${e.date}`,
    event: e,
  }
}

/** Events newer than the last delivered date (simple cursor for a scheduler). */
export function newSince(events: ChangeEvent[], lastDeliveredDate: string | null): ChangeEvent[] {
  return events.filter((e) => !lastDeliveredDate || e.date > lastDeliveredDate)
}
