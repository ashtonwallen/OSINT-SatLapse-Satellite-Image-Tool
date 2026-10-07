// Minimal, safe Markdown → React renderer for investigation notes.
// Builds elements directly (never innerHTML), so notes can't inject markup.
// Supports: # headings, paragraphs, - / * / 1. lists, > quotes, ``` code
// blocks, **bold**, *italic*, `code`, [links](https://…) (http/https/mailto only).
import type { ReactNode } from 'react'

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${key}-${i++}`
    if (tok.startsWith('**')) out.push(<strong key={k} className="font-semibold text-neutral-100">{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={k} className="rounded bg-neutral-800 px-1 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!
      out.push(/^(https?:|mailto:)/i.test(href)
        ? <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">{label}</a>
        : label)
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let n = 0
  while (i < lines.length) {
    const line = lines[i]
    const key = `b${n++}`
    if (!line.trim()) { i++; continue }
    if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      i++
      blocks.push(<pre key={key} className="overflow-x-auto rounded bg-neutral-900 p-2 font-mono text-[11px]">{code.join('\n')}</pre>)
      continue
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      const cls = h[1].length === 1 ? 'text-base font-semibold' : h[1].length === 2 ? 'text-sm font-semibold' : 'text-sm font-medium text-neutral-300'
      blocks.push(<div key={key} role="heading" aria-level={h[1].length + 1} className={`${cls} mt-2 text-neutral-100`}>{inline(h[2], key)}</div>)
      i++
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(<li key={`${key}-${items.length}`}>{inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''), `${key}-${items.length}`)}</li>)
        i++
      }
      blocks.push(ordered
        ? <ol key={key} className="list-decimal space-y-0.5 pl-5">{items}</ol>
        : <ul key={key} className="list-disc space-y-0.5 pl-5">{items}</ul>)
      continue
    }
    if (line.startsWith('>')) {
      const q: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push(<blockquote key={key} className="border-l-2 border-neutral-600 pl-3 text-neutral-400">{inline(q.join(' '), key)}</blockquote>)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|>|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++])
    blocks.push(<p key={key}>{inline(para.join(' '), key)}</p>)
  }
  return <div className="space-y-2 text-sm leading-relaxed text-neutral-300">{blocks}</div>
}
