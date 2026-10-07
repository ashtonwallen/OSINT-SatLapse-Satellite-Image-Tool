// OpenAI Chat Completions, also used for OpenRouter (same wire format).
// Tool results can only carry text there, so requested images are sent in a
// follow-up user message right after the tool results.
import type { ChatMessage, ChatProvider, ChatRequest, Part } from '../types'

type OAMsg = Record<string, unknown>

function toOpenAI(system: string, msgs: ChatMessage[]): OAMsg[] {
  const out: OAMsg[] = [{ role: 'system', content: system }]
  for (const m of msgs) {
    if (m.role === 'assistant') {
      const text = m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('')
      const calls = m.parts.filter((p) => p.type === 'tool_call') as Extract<Part, { type: 'tool_call' }>[]
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
      })
      continue
    }
    const results = m.parts.filter((p) => p.type === 'tool_result') as Extract<Part, { type: 'tool_result' }>[]
    const images: Extract<Part, { type: 'image' }>[] = []
    for (const r of results) {
      const text = r.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n')
      r.content.forEach((c) => c.type === 'image' && images.push(c))
      out.push({ role: 'tool', tool_call_id: r.id, content: (r.isError ? 'ERROR: ' : '') + (text || (images.length ? 'Image attached in the next message.' : 'OK')) })
    }
    const content: Record<string, unknown>[] = []
    for (const p of m.parts) {
      if (p.type === 'text' && p.text) content.push({ type: 'text', text: p.text })
      if (p.type === 'image') images.push(p)
    }
    for (const img of images) {
      if (img.caption) content.push({ type: 'text', text: img.caption })
      content.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } })
    }
    if (content.length) out.push({ role: 'user', content })
  }
  return out
}

function make(id: 'openai' | 'openrouter', label: string, baseUrl: string, defaultModel: string, models: string[], keyUrl: string): ChatProvider {
  return {
    id, label, needsKey: true, defaultModel, suggestedModels: models, keyUrl,
    async chat(req: ChatRequest, key: string | null) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: req.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key ?? ''}`,
          ...(id === 'openrouter' ? { 'X-Title': 'SatLapse' } : {}),
        },
        body: JSON.stringify({
          model: req.model,
          messages: toOpenAI(req.system, req.messages),
          tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`${label} error ${res.status}${res.status === 401 ? ' (check the API key)' : ''}: ${body.slice(0, 300)}`)
      }
      const j = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; refusal?: string | null }; finish_reason: string }[] }
      const choice = j.choices[0]
      const parts: Part[] = []
      if (choice.message.content) { parts.push({ type: 'text', text: choice.message.content }); req.onText?.(choice.message.content) }
      if (choice.message.refusal) parts.push({ type: 'text', text: choice.message.refusal })
      for (const c of choice.message.tool_calls ?? []) {
        let input: Record<string, unknown> = {}
        try { input = JSON.parse(c.function.arguments || '{}') } catch { input = { __invalid_json: c.function.arguments } }
        parts.push({ type: 'tool_call', id: c.id, name: c.function.name, input })
      }
      const fr = choice.finish_reason
      return {
        message: { role: 'assistant', parts },
        stop: fr === 'tool_calls' || parts.some((p) => p.type === 'tool_call') ? 'tool_use' : fr === 'length' ? 'max_tokens' : fr === 'content_filter' ? 'refusal' : 'end',
      }
    },
  }
}

export const openaiProvider = make('openai', 'OpenAI', 'https://api.openai.com/v1', 'gpt-5', ['gpt-5', 'gpt-5-mini', 'gpt-4.1'], 'https://platform.openai.com/api-keys')
export const openrouterProvider = make('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'anthropic/claude-opus-5-5',
  ['anthropic/claude-opus-5-5', 'openai/gpt-5', 'google/gemini-2.5-pro', 'qwen/qwen2.5-vl-72b-instruct'], 'https://openrouter.ai/settings/keys')
