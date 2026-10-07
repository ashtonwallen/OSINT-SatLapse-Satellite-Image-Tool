import { Check, ClipboardCopy, Download, KeyRound, LoaderCircle, Send, Settings2, Square, Trash, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PROVIDERS, runAgent } from '../ai/agent'
import { ANALYSIS_INSTRUCTIONS, STARTER_PROMPTS, copyPrompt, describeProject } from '../ai/context'
import { clearKey, getKey, getOllamaUrl, isPersisted, setKey, setOllamaUrl } from '../ai/keys'
import type { Draft } from '../ai/tools'
import type { ChatMessage, Part, ProviderId } from '../ai/types'
import { APP_CONFIG } from '../config/app'
import type { Investigation } from '../core/types'
import { addAnnotation, updateInvestigation } from '../app/actions'
import { buildBundle, createToolHost, keyScenes, loadProjectData } from '../app/aiHost'
import { storage } from '../storage/idb'
import { download, slug } from '../export/timelapse'
import { Button, Section } from './kit'
import { Markdown } from './Markdown'

// Conversations live in memory for this tab only (never written to disk).
const sessions = new Map<string, { messages: ChatMessage[]; drafts: Draft[] }>()

const VIEW_WORDS: Record<string, string> = {
  get_stats: 'Read the land-cover series', list_events: 'Listed flagged changes', list_annotations: 'Read your annotations',
  get_scene_image: 'Looked at an image', draft_annotation: 'Drafted an annotation', draft_report_section: 'Drafted a report section',
}

function ToolStep({ p }: { p: Extract<Part, { type: 'tool_call' }> }) {
  const i = p.input as Record<string, string | boolean>
  const detail = p.name === 'get_scene_image' ? `${String(i.view ?? 'true_color').replace(/_/g, ' ')}, ${i.date}${i.aerial ? ' (aerial)' : ''}`
    : p.name === 'get_stats' || p.name === 'list_events' ? [i.from, i.to].filter(Boolean).join(' → ') : ''
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
      <Check size={11} className="text-emerald-400" /> {VIEW_WORDS[p.name] ?? p.name}{detail && <span className="text-neutral-400">· {detail}</span>}
    </div>
  )
}

export function AiPanel({ project }: { project: Investigation }) {
  const session = sessions.get(project.id) ?? { messages: [], drafts: [] }
  sessions.set(project.id, session)
  const [messages, setMessages] = useState<ChatMessage[]>(session.messages)
  const [drafts, setDrafts] = useState<Draft[]>(session.drafts)
  const [streaming, setStreaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [copied, setCopied] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const ctrl = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  const providerId = (project.ai?.provider as ProviderId | undefined) ?? 'anthropic'
  const provider = PROVIDERS[providerId]
  const model = project.ai?.model || provider.defaultModel
  const [keyDraft, setKeyDraft] = useState('')
  const [persist, setPersist] = useState(isPersisted(providerId))
  const [ollamaUrl, setOllamaUrlState] = useState(getOllamaUrl(APP_CONFIG.ollamaUrl))
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null)
  const hasKey = !provider.needsKey || !!getKey(providerId)
  const [, force] = useState(0)

  useEffect(() => { session.messages = messages; session.drafts = drafts }, [messages, drafts, session])
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [messages, streaming])
  useEffect(() => { setPersist(isPersisted(providerId)); setKeyDraft('') }, [providerId])

  const setAi = (patch: { provider?: ProviderId; model?: string }) => {
    const p = patch.provider ?? providerId
    void updateInvestigation(project.id, { ai: { provider: p, model: patch.model ?? (patch.provider ? PROVIDERS[p].defaultModel : model) } })
  }

  async function copy() {
    const data = await loadProjectData(project.id)
    await navigator.clipboard.writeText(copyPrompt(data))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function send(text: string) {
    if (!text.trim() || busy) return
    setError(null)
    const data = await loadProjectData(project.id)
    const parts: Part[] = [{ type: 'text', text: text.trim() }]
    // Local models often lack tool calling: give them the key images up front.
    if (providerId === 'ollama' && messages.length === 0) {
      for (const k of keyScenes(data, 3)) {
        const r = await createToolHost(data, () => {}).run('get_scene_image', { area_id: data.areas.find((a) => a.area.name === k.area)!.area.id, date: k.scene.date })
        parts.push(...r.filter((p) => p.type === 'image'))
      }
    }
    const user: ChatMessage = { role: 'user', parts }
    const history = [...messages, user]
    setMessages(history)
    setInput('')
    setBusy(true)
    ctrl.current = new AbortController()
    try {
      await runAgent({
        provider, model, key: getKey(providerId), baseUrl: providerId === 'ollama' ? ollamaUrl : undefined,
        system: `${ANALYSIS_INSTRUCTIONS}\n\nThe user's project data follows. Use tools to fetch images and detail.\n\n${describeProject(data)}`,
        history, host: createToolHost(data, (d) => setDrafts((ds) => [...ds, d])), signal: ctrl.current.signal,
        onText: (t) => setStreaming(t),
        onMessage: (m) => { setStreaming(null); setMessages((ms) => [...ms, m]) },
      })
    } catch (e) {
      if (!ctrl.current.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setStreaming(null)
    }
  }

  async function approve(d: Draft) {
    if (d.kind === 'annotation' && d.lngLat && d.date) {
      await addAnnotation({ investigationId: project.id, areaId: d.areaId, lngLat: d.lngLat, date: d.date, text: d.body, author: 'ai' })
    } else {
      const cur = (await storage.getInvestigation(project.id))?.notes ?? ''
      await updateInvestigation(project.id, { notes: `${cur.trim()}\n\n## ${d.title}\n\n${d.body.trim()}\n\n_Drafted with AI (${provider.label}, ${model}) and approved on ${new Date().toISOString().slice(0, 10)}._\n` })
    }
    setDrafts((ds) => ds.map((x) => (x.id === d.id ? { ...x, status: 'approved' } : x)))
  }

  const pending = drafts.filter((d) => d.status === 'pending')

  return (
    <div className="space-y-3">
      <Section title="Copy to AI (no key needed)">
        <p className="mb-2 text-[11px] leading-relaxed text-neutral-400">
          Paste this project's data and analysis instructions into any AI chat, or download a bundle with the prompt plus labelled key images to upload.
        </p>
        <div className="flex gap-2">
          <Button className="flex-1 text-xs" onClick={copy}>{copied ? <><Check size={13} /> Copied</> : <><ClipboardCopy size={13} /> Copy prompt</>}</Button>
          <Button className="flex-1 text-xs" onClick={async () => download(await buildBundle(await loadProjectData(project.id)), `${slug(project.name)}-ai-bundle.zip`)}>
            <Download size={13} /> Prompt + images
          </Button>
        </div>
      </Section>

      <Section title="Chat with a model" aside={
        <button type="button" onClick={() => setShowSettings((s) => !s)} className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-100">
          <Settings2 size={12} /> {provider.label} · {model}
        </button>
      }>
        {(showSettings || !hasKey) && (
          <div className="mb-3 space-y-2 rounded-md border border-line bg-panel p-2.5 text-xs">
            <label className="block text-[11px] text-neutral-400">Provider
              <select value={providerId} onChange={(e) => setAi({ provider: e.target.value as ProviderId })}
                className="mt-0.5 w-full rounded border border-line bg-panel-2 px-2 py-1 text-xs text-neutral-200">
                {Object.values(PROVIDERS).map((p) => <option key={p.id} value={p.id}>{p.label}{p.needsKey ? '' : ' (no key)'}</option>)}
              </select>
            </label>
            <label className="block text-[11px] text-neutral-400">Model
              <input list={`models-${providerId}`} value={model} onChange={(e) => setAi({ model: e.target.value })}
                className="mt-0.5 w-full rounded border border-line bg-panel-2 px-2 py-1 font-mono text-xs text-neutral-200" />
              <datalist id={`models-${providerId}`}>{(ollamaModels ?? provider.suggestedModels).map((m) => <option key={m} value={m} />)}</datalist>
            </label>
            {provider.needsKey ? (
              <div className="space-y-1.5">
                {getKey(providerId) ? (
                  <div className="flex items-center justify-between rounded bg-emerald-950/40 px-2 py-1.5 text-[11px] text-emerald-200">
                    <span className="flex items-center gap-1.5"><KeyRound size={12} /> Key set {isPersisted(providerId) ? '(saved on this device)' : '(this tab only)'}</span>
                    <button type="button" onClick={() => { clearKey(providerId); force((n) => n + 1) }} className="text-emerald-300 hover:text-white">Remove</button>
                  </div>
                ) : (
                  <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); setKey(providerId, keyDraft, persist); setKeyDraft(''); force((n) => n + 1) }}>
                    <input type="password" autoComplete="off" spellCheck={false} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)}
                      placeholder={`${provider.label} API key`} className="min-w-0 flex-1 rounded border border-line bg-panel-2 px-2 py-1 font-mono text-xs" />
                    <Button type="submit" variant="primary" className="text-xs" disabled={!keyDraft.trim()}>Use key</Button>
                  </form>
                )}
                <label className="flex items-start gap-1.5 text-[11px] text-neutral-400">
                  <input type="checkbox" checked={persist} onChange={(e) => { setPersist(e.target.checked); const k = getKey(providerId); if (k) setKey(providerId, k, e.target.checked); force((n) => n + 1) }} className="mt-0.5 accent-sky-400" />
                  <span>Remember on this device. <span className="text-amber-300/90">Anyone with access to this browser profile could read it.</span> Off = forgotten when this tab closes.</span>
                </label>
                <p className="text-[10px] leading-relaxed text-neutral-500">
                  Your key is sent only to {provider.label}'s API, directly from this browser. Use a dedicated key with a low spend limit
                  {provider.keyUrl && <> (<a className="underline" href={provider.keyUrl} target="_blank" rel="noopener noreferrer">create one</a>)</>}. See the security page for details.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="block text-[11px] text-neutral-400">Ollama URL
                  <input value={ollamaUrl} onChange={(e) => { setOllamaUrlState(e.target.value); setOllamaUrl(e.target.value) }}
                    className="mt-0.5 w-full rounded border border-line bg-panel-2 px-2 py-1 font-mono text-xs" />
                </label>
                <Button className="text-xs" onClick={async () => {
                  try { setOllamaModels(await PROVIDERS.ollama.listModels!(null, ollamaUrl)); setError(null) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
                }}>Check connection & list models</Button>
                <p className="text-[10px] leading-relaxed text-neutral-500">
                  Runs on your machine; nothing leaves it. Ollama must allow this site's origin. Start it with:{' '}
                  <code className="break-all rounded bg-neutral-800 px-1">OLLAMA_ORIGINS={location.origin} ollama serve</code>. Vision models (e.g. qwen2.5vl) can see images.
                </p>
              </div>
            )}
          </div>
        )}

        {messages.length === 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {STARTER_PROMPTS.map((p) => (
              <button type="button" key={p} disabled={!hasKey || busy} onClick={() => void send(p)}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] text-neutral-300 hover:border-accent hover:text-white disabled:opacity-40">{p}</button>
            ))}
          </div>
        )}

        <div className="scroll-thin max-h-[50vh] space-y-3 overflow-y-auto">
          {messages.map((m, i) => m.role === 'user' ? (
            m.parts.some((p) => p.type === 'text') && (
              <div key={i} className="ml-6 rounded-lg bg-accent/15 px-3 py-2 text-sm text-neutral-100">
                {m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n')}
                {m.parts.some((p) => p.type === 'image') && <div className="mt-1 text-[10px] text-neutral-400">+ {m.parts.filter((p) => p.type === 'image').length} key images attached</div>}
              </div>
            )
          ) : (
            <div key={i} className="space-y-1">
              {m.parts.map((p, j) => p.type === 'text' ? <Markdown key={j} source={p.text} /> : p.type === 'tool_call' ? <ToolStep key={j} p={p} /> : null)}
            </div>
          ))}
          {streaming && <div className="opacity-80"><Markdown source={streaming} /></div>}
          {busy && !streaming && <div className="flex items-center gap-2 text-xs text-neutral-500"><LoaderCircle size={13} className="animate-spin" /> Thinking…</div>}
          <div ref={bottom} />
        </div>

        {error && <p className="mt-2 rounded bg-red-950/50 p-2 text-xs text-red-300">{error}</p>}

        {pending.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">Drafts awaiting your approval</div>
            {pending.map((d) => (
              <div key={d.id} className="rounded-md border border-amber-700/50 bg-amber-950/20 p-2 text-xs">
                <div className="font-medium text-amber-100">{d.title}</div>
                {d.kind === 'report' ? <div className="mt-1 max-h-40 overflow-y-auto"><Markdown source={d.body} /></div> : <p className="mt-1 text-neutral-300">{d.body}</p>}
                <div className="mt-2 flex gap-2">
                  <Button variant="primary" className="text-xs" onClick={() => void approve(d)}><Check size={12} /> {d.kind === 'report' ? 'Add to notes' : 'Save annotation'}</Button>
                  <Button className="text-xs" onClick={() => setDrafts((ds) => ds.map((x) => (x.id === d.id ? { ...x, status: 'discarded' } : x)))}><X size={12} /> Discard</Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(input) }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} disabled={!hasKey}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input) } }}
            placeholder={hasKey ? 'Ask about this project…' : provider.needsKey ? 'Add an API key above to chat' : 'Set up Ollama above'}
            className="min-w-0 flex-1 resize-none rounded-md border border-line bg-panel px-2.5 py-2 text-sm outline-none focus:border-accent disabled:opacity-50" />
          {busy ? (
            <Button type="button" onClick={() => ctrl.current?.abort()} aria-label="Stop"><Square size={13} /></Button>
          ) : (
            <Button type="submit" variant="primary" disabled={!hasKey || !input.trim()} aria-label="Send"><Send size={13} /></Button>
          )}
        </form>
        {messages.length > 0 && (
          <button type="button" onClick={() => { setMessages([]); setDrafts([]) }} className="mt-2 flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-200"><Trash size={11} /> Clear conversation</button>
        )}
        <p className="mt-2 text-[10px] text-neutral-500">Conversations stay in this tab's memory and aren't saved. AI output can be wrong; check it against the imagery.</p>
      </Section>
    </div>
  )
}
