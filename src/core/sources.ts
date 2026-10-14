// Registry of imagery and data sources. Every source the app can use is
// described here, free or paid, so availability, gating (entitlements) and
// documentation come from one place.
export type SourceKind = 'optical' | 'aerial' | 'radar' | 'thermal' | 'night-lights' | 'fire' | 'atmosphere' | 'landcover' | 'elevation'

export interface DataSourceInfo {
  id: string
  label: string
  provider: string
  kind: SourceKind
  tier: 'free' | 'paid'
  /** Needs a user-supplied key (never required for core features). */
  requiresKey: boolean
  /** Best native resolution in metres. */
  resolutionM: number
  revisit: string
  coverage: { start: string; end?: string; region: string }
  browserAccess: 'verified' | 'unverified' | 'server-only'
  /** Required attribution / licence line. */
  attribution: string
  status: 'active' | 'planned'
}

export const DATA_SOURCES: DataSourceInfo[] = [
  {
    id: 'earth-search-c1', label: 'Sentinel-2 L2A (Collection 1)', provider: 'Element84 Earth Search', kind: 'optical',
    tier: 'free', requiresKey: false, resolutionM: 10, revisit: '2–5 days', coverage: { start: '2015-06-27', region: 'global' },
    browserAccess: 'verified', attribution: 'Contains modified Copernicus Sentinel data', status: 'active',
  },
  {
    id: 'earth-search', label: 'Sentinel-2 L2A (legacy)', provider: 'Element84 Earth Search', kind: 'optical',
    tier: 'free', requiresKey: false, resolutionM: 10, revisit: '2–5 days', coverage: { start: '2015-06-27', region: 'global' },
    browserAccess: 'verified', attribution: 'Contains modified Copernicus Sentinel data', status: 'active',
  },
  {
    id: 'planetary-computer', label: 'Sentinel-2 L2A', provider: 'Microsoft Planetary Computer', kind: 'optical',
    tier: 'free', requiresKey: false, resolutionM: 10, revisit: '2–5 days', coverage: { start: '2015-06-27', region: 'global' },
    browserAccess: 'verified', attribution: 'Contains modified Copernicus Sentinel data', status: 'active',
  },
  {
    id: 'pc-naip', label: 'NAIP aerial imagery', provider: 'USDA via Microsoft Planetary Computer', kind: 'aerial',
    tier: 'free', requiresKey: false, resolutionM: 0.3, revisit: '2–3 years', coverage: { start: '2010-01-01', region: 'contiguous US' },
    browserAccess: 'verified', attribution: 'NAIP imagery: USDA Farm Production and Conservation Business Center (public domain)', status: 'active',
  },
  {
    id: 'pc-landsat', label: 'Landsat Collection 2 Level-2', provider: 'USGS via Microsoft Planetary Computer', kind: 'optical',
    tier: 'free', requiresKey: false, resolutionM: 30, revisit: '8–16 days', coverage: { start: '1982-08-22', region: 'global' },
    browserAccess: 'verified', attribution: 'Landsat imagery courtesy of the U.S. Geological Survey', status: 'active',
  },
]
