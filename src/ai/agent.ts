// Provider-neutral tool loop: call the model, run requested tools locally,
// feed results back, repeat until the model answers (or limits are hit).
import { anthropicProvider } from './providers/anthropic'
import { geminiProvider } from './providers/gemini'
import { ollamaProvider } from './providers/ollama'
import { openaiProvider, openrouterProvider } from './providers/openaiCompatible'
import { TOOLS, validateInput, type ToolHost } from './tools'
import type { ChatMessage, ChatProvider, Part, ProviderId } from './types'

export const PROVIDERS: Record<ProviderId, ChatProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  openrouter: openrouterProvider,
  ollama: ollamaProvider,
}

const MAX_STEPS = 10

export interface RunOptions {
  provider: ChatProvider
  model: string
  key: string | null
  baseUrl?: string
  system: string
  history: ChatMessage[]
  host: ToolHost
  signal?: AbortSignal
  /** Streaming text of the turn in progress. */
  onText?(text: string): void
  /** Called whenever the transcript grows (assistant turn or tool results). */
  onMessage?(m: ChatMessage): void
}

export async function runAgent(o: RunOptions): Promise<{ messages: ChatMessage[]; stop: string }> {
  const added: ChatMessage[] = []
  const transcript = () => [...o.history, ...added]
  for (let step = 0; step < MAX_STEPS; step++) {
    let streamed = ''
    const turn = await o.provider.chat(
      { system: o.system, messages: transcript(), tools: TOOLS, model: o.model, signal: o.signal, onText: (d) => { streamed += d; o.onText?.(streamed) } },
      o.key,
      o.baseUrl,
    )
    added.push(turn.message)
    o.onMessage?.(turn.message)
    // Never run tools from a refused or truncated turn.
    if (turn.stop === 'refusal' || turn.stop === 'max_tokens' || turn.stop === 'end' || turn.stop === 'error') return { messages: added, stop: turn.stop }
    const calls = turn.message.parts.filter((p) => p.type === 'tool_call') as Extract<Part, { type: 'tool_call' }>[]
    if (!calls.length) return { messages: added, stop: 'end' }
    const results: Part[] = []
    for (const c of calls) {
      const err = validateInput(c.name, c.input)
      if (err) { results.push({ type: 'tool_result', id: c.id, name: c.name, isError: true, content: [{ type: 'text', text: err }] }); continue }
      try {
        results.push({ type: 'tool_result', id: c.id, name: c.name, content: await o.host.run(c.name, c.input) })
      } catch (e) {
        results.push({ type: 'tool_result', id: c.id, name: c.name, isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] })
      }
    }
    // All results go back in a single user message (keeps parallel tool use working).
    const msg: ChatMessage = { role: 'user', parts: results }
    added.push(msg)
    o.onMessage?.(msg)
  }
  added.push({ role: 'assistant', parts: [{ type: 'text', text: '_(Stopped after 10 tool steps. Ask a narrower question to continue.)_' }] })
  return { messages: added, stop: 'max_steps' }
}
