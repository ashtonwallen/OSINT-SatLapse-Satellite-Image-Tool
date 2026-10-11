// Single source of truth for naming, domain and colors. A rename or domain
// move should only require editing this file (plus index.html <title>).
export const BRAND = {
  name: 'SatLapse',
  tagline: 'Draw an area. Replay its satellite history. See what changed.',
  description: 'Free, open-source satellite timelapse and change detection that runs entirely in your browser: Sentinel-2, Landsat and US aerial imagery, flagged changes, reports and optional AI analysis. Includes an MCP server so AI agents like Claude Code can run it too. No account, no backend, no API keys.',
  /** External signup form for planned alerts (paid tier). Empty hides the button. */
  alertsWaitlistUrl: '',
  siteUrl: 'https://satlapse.ashtonwilliamallen.com',
  repoUrl: 'https://github.com/ashtonwallen/OSINT-SatLapse-Satellite-Image-Tool',
  colors: {
    accent: '#38bdf8',
    background: '#0a0a0a',
  },
} as const
