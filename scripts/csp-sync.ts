// Writes the CSP from src/config/csp.ts into vercel.json (run: npm run csp:sync).
import { readFileSync, writeFileSync } from 'node:fs'
import { HEADER_ONLY, buildCsp } from '../src/config/csp'

const file = 'vercel.json'
const v = JSON.parse(readFileSync(file, 'utf8'))
const all = v.headers.find((h: { source: string }) => h.source === '/(.*)')
all.headers = all.headers.filter((h: { key: string }) => h.key !== 'Content-Security-Policy')
all.headers.unshift({ key: 'Content-Security-Policy', value: `${buildCsp()}; ${HEADER_ONLY}` })
writeFileSync(file, JSON.stringify(v, null, 2) + '\n')
console.log('vercel.json CSP updated')
