import { describe, expect, it } from 'vitest'
import { runAgent } from '../agent'
import { validateInput, type ToolHost } from '../tools'
import type { ChatProvider, ChatRequest, ChatTurn } from '../types'

/** Scripted fake model: calls tools on the first turn, then answers. */
function fakeProvider(script: ((req: ChatRequest) => ChatTurn)[]): ChatProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = []
  return {
    id: 'openai', label: 'fake', needsKey: false, defaultModel: 'm', suggestedModels: [], calls,
    async chat(req) { calls.push({ ...req, messages: structuredClone(req.messages) }); return script[calls.length - 1](req) },
  }
}

describe('agent loop', () => {
  it('runs tools, returns all results in one message, then finishes', async () => {
    const p = fakeProvider([
      () => ({ stop: 'tool_use', message: { role: 'assistant', parts: [
        { type: 'tool_call', id: 'a', name: 'list_annotations', input: {} },
        { type: 'tool_call', id: 'b', name: 'get_stats', input: { area_id: 'x', from: '2024-01-01' } },
      ] } }),
      (req) => {
        const last = req.messages.at(-1)!
        expect(last.role).toBe('user')
        expect(last.parts.filter((x) => x.type === 'tool_result')).toHaveLength(2)
        return { stop: 'end', message: { role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] } }
      },
    ])
    const ran: string[] = []
    const host: ToolHost = { async run(name) { ran.push(name); return [{ type: 'text', text: 'ok' }] } }
    const r = await runAgent({ provider: p, model: 'm', key: null, system: 's', history: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], host })
    expect(ran).toEqual(['list_annotations', 'get_stats'])
    expect(r.stop).toBe('end')
    expect(r.messages.at(-1)!.parts[0]).toEqual({ type: 'text', text: 'Done.' })
  })

  it('returns validation errors to the model instead of running bad calls', async () => {
    const p = fakeProvider([
      () => ({ stop: 'tool_use', message: { role: 'assistant', parts: [{ type: 'tool_call', id: 'a', name: 'get_scene_image', input: { area_id: 'x', date: 'last tuesday' } }] } }),
      (req) => {
        const res = req.messages.at(-1)!.parts[0]
        expect(res.type === 'tool_result' && res.isError).toBe(true)
        return { stop: 'end', message: { role: 'assistant', parts: [] } }
      },
    ])
    let ran = false
    await runAgent({ provider: p, model: 'm', key: null, system: 's', history: [], host: { async run() { ran = true; return [] } } })
    expect(ran).toBe(false)
  })

  it('never runs tools from a refused turn', async () => {
    const p = fakeProvider([() => ({ stop: 'refusal', message: { role: 'assistant', parts: [{ type: 'tool_call', id: 'a', name: 'list_annotations', input: {} }] } })])
    let ran = false
    const r = await runAgent({ provider: p, model: 'm', key: null, system: 's', history: [], host: { async run() { ran = true; return [] } } })
    expect(ran).toBe(false)
    expect(r.stop).toBe('refusal')
  })

  it('validates draft annotation coordinates', () => {
    expect(validateInput('draft_annotation', { area_id: 'a', lat: 120, lon: 0, date: '2024-01-01', text: 'x' })).toMatch(/out of range/)
    expect(validateInput('draft_annotation', { area_id: 'a', lat: 10, lon: 0, date: '2024-01-01', text: 'x' })).toBeNull()
    expect(validateInput('get_stats', { area_id: 'a', bogus: 1 })).toMatch(/Unexpected/)
  })
})
