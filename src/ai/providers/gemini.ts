// Google Gemini via the REST API (generativelanguage.googleapis.com), which
// accepts browser requests with the key in the x-goog-api-key header.
import type { ChatMessage, ChatProvider, ChatRequest, Part } from '../types'

type GPart = Record<string, unknown>

function toContents(msgs: ChatMessage[]) {
  return msgs.map((m) => {
    if (m.role === 'assistant' && m.raw?.provider === 'gemini') return m.raw.content
    const parts: GPart[] = []
    for (const p of m.parts) {
      if (p.type === 'text' && p.text) parts.push({ text: p.text })
      if (p.type === 'image') parts.push({ inlineData: { mimeType: p.mediaType, data: p.data } })
      if (p.type === 'tool_call') parts.push({ functionCall: { name: p.name, args: p.input } })
      if (p.type === 'tool_result') {
        const text = p.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n')
        parts.push({ functionResponse: { name: p.name, response: { result: (p.isError ? 'ERROR: ' : '') + (text || 'Image attached.') } } })
        for (const c of p.content) if (c.type === 'image') parts.push({ inlineData: { mimeType: c.mediaType, data: c.data } })
      }
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts }
  })
}

/** Gemini accepts a subset of JSON Schema; drop keywords it rejects. */
function clean(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(clean)
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(schema)) if (k !== 'additionalProperties') out[k] = clean(v)
    return out
  }
  return schema
}

export const geminiProvider: ChatProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  needsKey: true,
  defaultModel: 'gemini-2.5-pro',
  suggestedModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  keyUrl: 'https://aistudio.google.com/apikey',
  async chat(req: ChatRequest, key: string | null) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`, {
      method: 'POST',
      signal: req.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key ?? '' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: toContents(req.messages),
        tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: clean(t.parameters) })) }],
      }),
    })
    if (!res.ok) throw new Error(`Gemini error ${res.status}${res.status === 400 || res.status === 403 ? ' (check the API key and model name)' : ''}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
    const j = (await res.json()) as { candidates?: { content?: { role: string; parts?: GPart[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } }
    const cand = j.candidates?.[0]
    if (!cand?.content) return { message: { role: 'assistant', parts: [{ type: 'text', text: `Gemini returned no answer${j.promptFeedback?.blockReason ? ` (blocked: ${j.promptFeedback.blockReason})` : ''}.` }] }, stop: 'refusal' }
    const parts: Part[] = []
    let n = 0
    for (const p of cand.content.parts ?? []) {
      if (typeof p.text === 'string' && !p.thought) { parts.push({ type: 'text', text: p.text }); req.onText?.(p.text) }
      const fc = p.functionCall as { name: string; args?: Record<string, unknown> } | undefined
      if (fc) parts.push({ type: 'tool_call', id: `g${Date.now()}-${n++}`, name: fc.name, input: fc.args ?? {} })
    }
    const stop = parts.some((p) => p.type === 'tool_call') ? 'tool_use' : cand.finishReason === 'MAX_TOKENS' ? 'max_tokens' : cand.finishReason === 'SAFETY' ? 'refusal' : 'end'
    return { message: { role: 'assistant', parts, raw: { provider: 'gemini', content: cand.content } }, stop }
  },
}
