// Content Security Policy: the single list of every host the app may talk to.
// Used by vite.config.ts to emit the <meta> CSP and dist/_headers, and
// checked against vercel.json at build time. Rendered on /security.
//
// To add a data source or provider: add its host here, run `npm run csp:sync`,
// and document it on the security page.

export interface HostGroup {
  purpose: string
  hosts: string[]
}

export const CONNECT_HOSTS: HostGroup[] = [
  { purpose: 'Sentinel-2 & Landsat catalogues (STAC search)', hosts: ['https://earth-search.aws.element84.com', 'https://planetarycomputer.microsoft.com'] },
  { purpose: 'Satellite imagery files (Cloud Optimized GeoTIFFs)', hosts: [
    'https://sentinel-cogs.s3.us-west-2.amazonaws.com',
    'https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com',
    'https://*.blob.core.windows.net',
  ] },
  { purpose: 'Basemap tiles, fonts and high-res imagery basemap', hosts: ['https://tiles.openfreemap.org', 'https://basemap.nationalmap.gov'] },
  { purpose: 'Place search (geocoding)', hosts: ['https://photon.komoot.io'] },
  { purpose: 'AI providers (only when you add your own key)', hosts: [
    'https://api.anthropic.com', 'https://api.openai.com', 'https://generativelanguage.googleapis.com', 'https://openrouter.ai',
  ] },
  { purpose: 'Ollama on your own machine (local AI)', hosts: ['http://localhost:*', 'http://127.0.0.1:*'] },
]

export const IMG_HOSTS = ['https://tiles.openfreemap.org', 'https://basemap.nationalmap.gov']

export function buildCsp(): string {
  const connect = CONNECT_HOSTS.flatMap((g) => g.hosts)
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    // MapLibre popups and the generated report use inline style attributes.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...IMG_HOSTS],
    'font-src': ["'self'"],
    'connect-src': ["'self'", 'blob:', 'data:', ...connect],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'self'", 'blob:'],
    'media-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'none'"],
  }
  return Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ')
}

/** Header-only directives (not allowed in <meta>). */
export const HEADER_ONLY = "frame-ancestors 'none'"
