// Single source of truth for naming, domain and colors. A rename or domain
// move should only require editing this file (plus index.html <title>).
export const BRAND = {
  name: 'SatLapse',
  tagline: 'Draw an area. Replay its Sentinel-2 history. See what changed.',
  siteUrl: 'https://satlapse.ashtonwilliamallen.com',
  repoUrl: 'https://github.com/ashtonwallen/OSINT-SatLapse-Satellite-Image-Tool',
  colors: {
    accent: '#38bdf8',
    background: '#0a0a0a',
  },
} as const
