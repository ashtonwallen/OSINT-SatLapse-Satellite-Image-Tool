// Feature gating. Every feature is free today; a future paid tier flips
// entries here (and supplies `currentTier` from an account) without touching
// feature code, which only ever asks `can(feature)` or `limit(name)`.

export type Tier = 'free' | 'pro'

export type Feature =
  | 'backfill' | 'tracking' | 'aerialImagery' | 'landsatHistory'
  | 'export' | 'reports' | 'shareLinks'
  | 'aiCopy' | 'aiLocal' | 'aiByoKey'
  // Planned paid features (no implementation yet).
  | 'serverTracking' | 'alerts' | 'hostedAi' | 'onDemandHighRes'

const FEATURE_TIER: Record<Feature, Tier | 'unavailable'> = {
  backfill: 'free', tracking: 'free', aerialImagery: 'free', landsatHistory: 'free',
  export: 'free', reports: 'free', shareLinks: 'free',
  aiCopy: 'free', aiLocal: 'free', aiByoKey: 'free',
  serverTracking: 'unavailable', alerts: 'unavailable', hostedAi: 'unavailable', onDemandHighRes: 'unavailable',
}

export const LIMITS: Record<Tier, { maxAreaKm2: number; maxAreas: number | null }> = {
  free: { maxAreaKm2: 100, maxAreas: null },
  pro: { maxAreaKm2: 2500, maxAreas: null },
}

/** Until accounts exist, everyone is on the free tier. */
export const currentTier: Tier = 'free'

const rank: Record<Tier, number> = { free: 0, pro: 1 }

export function can(feature: Feature, tier: Tier = currentTier): boolean {
  const need = FEATURE_TIER[feature]
  return need !== 'unavailable' && rank[tier] >= rank[need]
}

export function limit<K extends keyof (typeof LIMITS)['free']>(name: K, tier: Tier = currentTier) {
  return LIMITS[tier][name]
}
