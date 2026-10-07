// Provider-neutral chat types. Every provider adapter (Anthropic, OpenAI,
// Gemini, OpenRouter, Ollama, and later a hosted/paid provider) converts to
// and from these, so the agent loop and UI never depend on one vendor.

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama'

export type Part =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string /* base64 */; caption?: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; content: Part[]; isError?: boolean }

export interface ChatMessage {
  role: 'user' | 'assistant'
  parts: Part[]
  /** Provider-native content for this turn, replayed verbatim to the same
   *  provider (keeps e.g. Anthropic thinking blocks valid). */
  raw?: { provider: ProviderId; content: unknown }
}

export interface ToolDef {
  name: string
  description: string
  /** JSON Schema for the input object. */
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
}

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  tools: ToolDef[]
  model: string
  signal?: AbortSignal
  onText?(delta: string): void
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'error'

export interface ChatTurn {
  message: ChatMessage
  stop: StopReason
}

export interface ChatProvider {
  id: ProviderId
  label: string
  /** True if an API key is required. */
  needsKey: boolean
  defaultModel: string
  suggestedModels: string[]
  /** Where keys are created (shown in settings). */
  keyUrl?: string
  chat(req: ChatRequest, key: string | null, baseUrl?: string): Promise<ChatTurn>
  listModels?(key: string | null, baseUrl?: string): Promise<string[]>
}
