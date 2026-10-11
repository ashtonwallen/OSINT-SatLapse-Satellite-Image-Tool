// Drives the MCP server through a real MCP client over an in-memory transport,
// using the bundled Oroville example (no network needed).
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from '../server'
import { DiskStore } from '../store'

const EXAMPLE = resolve(import.meta.dirname, '../../../public/examples/oroville.satlapse')
const dir = mkdtempSync(join(tmpdir(), 'satlapse-mcp-'))

async function connect(store: DiskStore) {
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createServer(store).connect(a)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(b)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args }) as { content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean }
    return { ...r, text: r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') }
  }
  return { client, call }
}

describe('MCP server', () => {
  let call: Awaited<ReturnType<typeof connect>>['call']
  let client: Client
  let projectId = '', areaId = ''

  beforeAll(async () => {
    ({ call, client } = await connect(await new DiskStore(dir).load()))
    const r = await call('import_project', { path: EXAMPLE })
    expect(r.isError).toBeFalsy()
    projectId = /\(id: ([^)]+)\)/.exec(r.text)![1]
    areaId = /\(([0-9a-f-]{36})\)/.exec(r.text)![1]
  }, 30_000)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('lists its tools with schemas', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['search_place', 'find_imagery', 'create_area', 'sync_area', 'describe_project', 'get_scene_image', 'export_project']))
    expect(tools.find((t) => t.name === 'sync_area')!.inputSchema.required).toContain('area_id')
  })

  it('describes the imported project and its history', async () => {
    expect((await call('list_projects')).text).toContain(areaId)
    const d = await call('describe_project', { project_id: projectId })
    expect(d.text).toContain('Land cover over time')
    expect(d.text).toMatch(/Flagged changes: \d+/)
    const stats = await call('get_stats', { area_id: areaId, from: '2020-01-01', to: '2020-12-31' })
    expect(stats.text.split('\n')[0]).toBe('date,sensor,vegetation_pct,water_pct,built_pct,cloud_pct')
    expect(stats.text.split('\n').length).toBeGreaterThan(1)
    expect((await call('list_events', { area_id: areaId })).isError).toBeFalsy()
  })

  it('returns scene images as JPEG with attribution', async () => {
    const r = await call('get_scene_image', { area_id: areaId, date: '2021-08-01', view: 'water', max_size: 256 })
    expect(r.isError).toBeFalsy()
    const img = r.content.find((c) => c.type === 'image')!
    expect(img.mimeType).toBe('image/jpeg')
    expect(Buffer.from(img.data!, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    expect(r.text).toContain('Copernicus Sentinel data')
  })

  it('rejects bad input with readable errors', async () => {
    expect((await call('get_stats', { area_id: 'nope' })).text).toContain('Unknown area')
    expect((await call('get_scene_image', { area_id: areaId, date: '2021/08/01' })).isError).toBe(true)
    const big = await call('create_area', { name: 'Too big', bbox: [-122, 39, -121, 40] })
    expect(big.isError).toBe(true)
    expect(big.text).toContain('the limit is 100 km²')
    expect((await call('create_area', { name: 'Both', bbox: [0, 0, 0.01, 0.01], polygon: [[0, 0], [0.01, 0], [0, 0.01]] })).isError).toBe(true)
  })

  it('saves annotations, notes and new areas to disk and reloads them', async () => {
    expect((await call('add_annotation', { area_id: areaId, lat: 39.54, lon: -121.49, date: '2022-01-15', text: 'Water level recovering' })).isError).toBeFalsy()
    expect((await call('add_note', { project_id: projectId, title: 'Findings', markdown: 'Reservoir low in 2021.' })).isError).toBeFalsy()
    const created = await call('create_area', { name: 'Dam', polygon: [[-121.49, 39.53], [-121.47, 39.53], [-121.47, 39.55]], project_id: projectId })
    expect(created.text).toContain('Created area "Dam"')
    expect(readdirSync(dir)).toEqual([`${projectId}.satlapse`])

    const reloaded = await connect(await new DiskStore(dir).load())
    expect((await reloaded.call('list_annotations', { project_id: projectId })).text).toContain('(ai): Water level recovering')
    const d = await reloaded.call('describe_project', { project_id: projectId })
    expect(d.text).toContain('Reservoir low in 2021.')
    expect(d.text).toContain('Area "Dam"')
  })

  it('exports a project file the web app can open', async () => {
    const out = join(dir, 'export.satlapse')
    expect((await call('export_project', { project_id: projectId, path: join(dir, 'bad.zip') })).isError).toBe(true)
    expect((await call('export_project', { project_id: projectId, path: out })).text).toContain('Wrote')
    expect(existsSync(out)).toBe(true)
    expect((await call('export_project', { project_id: projectId, path: out })).text).toContain('already exists')
    expect((await call('export_project', { project_id: projectId, path: out, overwrite: true })).isError).toBeFalsy()
    expect((await call('import_project', { path: '/etc/passwd' })).text).toContain('Only .satlapse files')
    expect((await call('import_project', { path: out })).isError).toBeFalsy()
  })
})
