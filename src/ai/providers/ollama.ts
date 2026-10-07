// Ollama running on the user's machine (default http://localhost:11434).
// Browsers can only reach it if Ollama allows this site's origin; see the
// OLLAMA_ORIGINS note in the AI settings and README.
import type { ChatMessage, ChatProvider, ChatRequest, Part } from '../types'

function toOllama(system: string, msgs: ChatMessage[], withTools: boolean) {
  const out: Record<string, unknown>[] = [{ role: 'system', content: system }]
  for (const m of msgs) {
    const text = (ps: Part[]) => ps.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n')
    const images = (ps: Part[]) => ps.filter((p) => p.type === 'image').map((p) => (p as { data: string }).data)
    if (m.role === 'assistant') {
      const calls = m.parts.filter((p) => p.type === 'tool_call') as Extract<Part, { type: 'tool_call' }>[]
      out.push({ role: 'assistant', content: text(m.parts), ...(withTools && calls.length ? { tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.input } })) } : {}) })
      continue
    }
    for (const r of m.parts.filter((p) => p.type === 'tool_result') as Extract<Part, { type: 'tool_result' }>[]) {
      out.push({ role: withTools ? 'tool' : 'user', content: (r.isError ? 'ERROR: ' : '') + (text(r.content) || 'Image attached.'), images: images(r.content) })
    }
    const t = text(m.parts)
    const imgs = images(m.parts)
    if (t || imgs.length) out.push({ role: 'user', content: t, images: imgs })
  }
  return out
}

export const ollamaProvider: ChatProvider = {
  id: 'ollama',
  label: 'Ollama (local)',
  needsKey: false,
  defaultModel: 'qwen2.5vl',
  suggestedModels: ['qwen2.5vl', 'llama3.2-vision', 'gemma3', 'mistral-small3.1'],
  async listModels(_key, baseUrl = 'http://localhost:11434') {
    const res = await fetch(`${baseUrl}/api/tags`)
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
    const j = (await res.json()) as { models: { name: string }[] }
    return j.models.map((m) => m.name)
  },
  async chat(req: ChatRequest, _key, baseUrl = 'http://localhost:11434') {
    const send = async (withTools: boolean) => {
      let res: Response
      try {
        res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          signal: req.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: req.model,
            stream: false,
            messages: toOllama(req.system, req.messages, withTools),
            ...(withTools ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
          }),
        })
      } catch (e) {
        if (req.signal?.aborted) throw e
        throw new Error(`Couldn't reach Ollama at ${baseUrl}. Is it running, and does OLLAMA_ORIGINS allow ${location.origin}? See AI settings for the exact command.`)
      }
      return res
    }
    let res = await send(true)
    let toolsOk = true
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // Many local vision models don't support tool calling; fall back to a
      // plain conversation (the panel then attaches key images up front).
      if (/does not support tools/i.test(body)) { toolsOk = false; res = await send(false) }
      else throw new Error(`Ollama error ${res.status}: ${body.slice(0, 300)}`)
      if (!res.ok) throw new Error(`Ollama error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
    }
    const j = (await res.json()) as { message: { content?: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] }; done_reason?: string }
    const parts: Part[] = []
    if (j.message.content) { parts.push({ type: 'text', text: j.message.content }); req.onText?.(j.message.content) }
    j.message.tool_calls?.forEach((c, i) => parts.push({ type: 'tool_call', id: `o${Date.now()}-${i}`, name: c.function.name, input: c.function.arguments ?? {} }))
    if (!toolsOk) parts.push({ type: 'text', text: '\n\n_(This model does not support tool calls, so it can only see the summary data and any images attached up front.)_' })
    return { message: { role: 'assistant', parts }, stop: parts.some((p) => p.type === 'tool_call') ? 'tool_use' : j.done_reason === 'length' ? 'max_tokens' : 'end' }
  },
}
