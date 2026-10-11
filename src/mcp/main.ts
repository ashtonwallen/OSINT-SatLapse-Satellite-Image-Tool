// Entry point: `npm run mcp` (stdio). Projects are saved under
// SATLAPSE_DATA_DIR (default ~/.satlapse/mcp). stdout carries the MCP
// protocol, so anything human-readable goes to stderr.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server'
import { DEFAULT_DATA_DIR, DiskStore } from './store'

const dir = process.env.SATLAPSE_DATA_DIR || DEFAULT_DATA_DIR
const store = await new DiskStore(dir).load()
for (const e of store.loadErrors) console.error(`satlapse-mcp: could not load ${e}`)
const maxAreaKm2 = Number(process.env.SATLAPSE_MAX_AREA_KM2) || undefined
await createServer(store, { maxAreaKm2 }).connect(new StdioServerTransport())
console.error(`satlapse-mcp: ready, ${(await store.storage.listInvestigations()).length} project(s) in ${dir}`)
