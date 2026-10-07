// API key handling. Default: keys live only in this module's memory and are
// gone when the tab closes or reloads. Persisting to this device
// (localStorage) is an explicit opt-in per provider. Keys are only ever sent
// to their own provider's API (see src/ai/providers/*).
import type { ProviderId } from './types'

const memory = new Map<ProviderId, string>()
const LS_PREFIX = 'satlapse.key.'

function ls(): Storage | null {
  try { return window.localStorage } catch { return null }
}

export function getKey(p: ProviderId): string | null {
  if (memory.has(p)) return memory.get(p)!
  try {
    const v = ls()?.getItem(LS_PREFIX + p)
    if (v) { memory.set(p, v); return v }
  } catch { /* storage blocked */ }
  return null
}

export function isPersisted(p: ProviderId): boolean {
  try { return !!ls()?.getItem(LS_PREFIX + p) } catch { return false }
}

/** Store a key. `persist` = also save to this device until removed. */
export function setKey(p: ProviderId, key: string, persist: boolean) {
  const k = key.trim()
  if (!k) return clearKey(p)
  memory.set(p, k)
  try {
    if (persist) ls()?.setItem(LS_PREFIX + p, k)
    else ls()?.removeItem(LS_PREFIX + p)
  } catch { /* storage blocked: memory only */ }
}

export function clearKey(p: ProviderId) {
  memory.delete(p)
  try { ls()?.removeItem(LS_PREFIX + p) } catch { /* ignore */ }
}

const SETTINGS_KEY = 'satlapse.ai.ollamaUrl'
export function getOllamaUrl(fallback: string): string {
  try { return ls()?.getItem(SETTINGS_KEY) || fallback } catch { return fallback }
}
export function setOllamaUrl(url: string) {
  try { ls()?.setItem(SETTINGS_KEY, url.trim()) } catch { /* ignore */ }
}
