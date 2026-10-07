// Anthropic (Claude) via the official SDK, called directly from the browser.
// `dangerouslyAllowBrowser` makes the SDK send the required
// `anthropic-dangerous-direct-browser-access` header; the key never leaves
// this browser except to api.anthropic.com.
import type { ChatMessage, ChatProvider, ChatRequest, Part } from '../types'

type Block = Record<string, unknown> & { type: string }

function toAnthropicContent(parts: Part[]): Block[] {
  return parts.flatMap((p): Block[] => {
    if (p.type === 'text') return p.text ? [{ type: 'text', text: p.text }] : []
    if (p.type === 'image') return [{ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } }]
    if (p.type === 'tool_call') return [{ type: 'tool_use', id: p.id, name: p.name, input: p.input }]
    return [{
      type: 'tool_result',
      tool_use_id: p.id,
      is_error: p.isError || undefined,
      content: p.content.flatMap((c) => toAnthropicContent([c])).filter((b) => b.type === 'text' || b.type === 'image'),
    }]
  })
}

function toMessages(msgs: ChatMessage[]) {
  return msgs.map((m) => ({
    role: m.role,
    // Replay native content unchanged (thinking/fallback blocks must round-trip).
    content: m.role === 'assistant' && m.raw?.provider === 'anthropic' ? m.raw.content : toAnthropicContent(m.parts),
  }))
}

export const anthropicProvider: ChatProvider = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  needsKey: true,
  defaultModel: 'claude-opus-5-5',
  suggestedModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
  keyUrl: 'https://console.anthropic.com/settings/keys',

  async chat(req: ChatRequest, key: string | null) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: key ?? '', dangerouslyAllowBrowser: true })
    const params: Record<string, unknown> = {
      model: req.model,
      max_tokens: 16000,
      system: req.system,
      messages: toMessages(req.messages),
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters, eager_input_streaming: true })),
      // If the model declines, re-run on a fallback model chosen by the API.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }
    const stream = client.beta.messages.stream(params as never, { signal: req.signal })
    stream.on('text', (d: string) => req.onText?.(d))
    let msg: { content: Block[]; stop_reason: string | null }
    try {
      msg = (await stream.finalMessage()) as unknown as typeof msg
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('Anthropic rejected the API key (401). Check it in AI settings.')
      if (e instanceof Anthropic.RateLimitError) throw new Error('Anthropic rate limit reached (429). Wait a moment and try again.')
      if (e instanceof Anthropic.APIError) throw new Error(`Anthropic API error ${e.status ?? ''}: ${e.message}`)
      throw e
    }
    const parts: Part[] = []
    for (const b of msg.content) {
      if (b.type === 'text') parts.push({ type: 'text', text: String(b.text ?? '') })
      if (b.type === 'tool_use') parts.push({ type: 'tool_call', id: String(b.id), name: String(b.name), input: (b.input ?? {}) as Record<string, unknown> })
    }
    const stop = msg.stop_reason === 'tool_use' ? 'tool_use' : msg.stop_reason === 'max_tokens' ? 'max_tokens' : msg.stop_reason === 'refusal' ? 'refusal' : 'end'
    return { message: { role: 'assistant', parts, raw: { provider: 'anthropic', content: msg.content } }, stop }
  },
}
