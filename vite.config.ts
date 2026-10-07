import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BRAND } from './src/config/brand'
import { HEADER_ONLY, buildCsp } from './src/config/csp'

// BASE_PATH lets the same build run at a domain root ("/") or under a sub-path
// (e.g. "/satlapse/" on GitHub Pages) with no code changes.
const base = process.env.BASE_PATH ?? '/'
const CSP = buildCsp()
const HEADER_CSP = `${CSP}; ${HEADER_ONLY}`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Branding/OG metadata in every page; strict CSP in production builds. */
function sitePlugin(): Plugin {
  let isBuild = false
  return {
    name: 'satlapse-site',
    configResolved(c) { isBuild = c.command === 'build' },
    buildStart() {
      if (!isBuild) return
      // vercel.json is read by Vercel before the build runs, so it must be
      // committed in sync with src/config/csp.ts.
      const vercel = JSON.parse(readFileSync(resolve(import.meta.dirname, 'vercel.json'), 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] }
      const v = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value
      if (v !== HEADER_CSP) this.error('vercel.json Content-Security-Policy is out of date. Run `npm run csp:sync` and commit vercel.json.')
    },
    transformIndexHtml(html) {
      const url = BRAND.siteUrl
      const meta = [
        `<meta name="description" content="${esc(BRAND.description)}" />`,
        `<meta name="theme-color" content="${BRAND.colors.background}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="${esc(BRAND.name)}" />`,
        `<meta property="og:title" content="${esc(`${BRAND.name}: ${BRAND.tagline}`)}" />`,
        `<meta property="og:description" content="${esc(BRAND.description)}" />`,
        `<meta property="og:url" content="${url}" />`,
        `<meta property="og:image" content="${url}/og.png" />`,
        `<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<link rel="icon" type="image/svg+xml" href="${base}favicon.svg" />`,
        ...(isBuild ? [`<meta http-equiv="Content-Security-Policy" content="${CSP}" />`] : []),
      ].join('\n    ')
      return html.replace('</title>', `</title>\n    ${meta}`).replace(/<title>[^<]*<\/title>/, (t) => t.replace(/SatLapse/g, BRAND.name))
    },
    generateBundle() {
      // Cloudflare Pages / Netlify read this; Vercel uses vercel.json.
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: `/*\n  Content-Security-Policy: ${HEADER_CSP}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()\n`,
      })
    },
  }
}

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), sitePlugin()],
  worker: { format: 'es' },
  preview: { headers: { 'Content-Security-Policy': HEADER_CSP } },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        security: resolve(import.meta.dirname, 'security/index.html'),
        methodology: resolve(import.meta.dirname, 'methodology/index.html'),
        spike: resolve(import.meta.dirname, 'spike.html'),
      },
    },
  },
})
