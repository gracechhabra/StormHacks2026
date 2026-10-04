import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChat } from '../../hooks/useChat'
import type { ChatMessage } from '../../types'

const SUGGESTED = [
  'What am I looking at?', 'What is the highest point?', 'Explain the elevation changes',
  'Where is this terrain most vulnerable to flooding?', 'Simulate 100 mm of rainfall', 'Find the steepest slope',
  'What would happen during a landslide?', 'Show me the highest areas', 'Show slope', 'Rotate the terrain north',
]

function Bubble({ m, last, onRegen, busy }: { m: ChatMessage; last: boolean; onRegen: () => void; busy: boolean }) {
  const [copied, setCopied] = useState(false)
  if (m.role === 'user') {
    return <div className="fade-in ml-8 self-end border border-[#a855f755] bg-[#a855f71f] px-3 py-2 text-sm">{m.text}</div>
  }
  return (
    <div className="fade-in mr-4 self-start">
      {m.actions.length > 0 && (
        <div className="mb-1.5 flex flex-col gap-1">
          {m.actions.map((a, i) => (
            <div key={i} className={`flex items-center gap-2 border px-2 py-1 font-mono text-[10px] ${a.ok ? 'border-[#00e5ff44] text-[#9cf0ff]' : 'border-[#ff3d7f66] text-[#ff9fbd]'}`}>
              <span className={`led ${a.ok ? 'green' : 'red'}`} /> {a.name} → {a.summary}
            </div>
          ))}
        </div>
      )}
      {(m.text || m.streaming) && (
        <div className="border border-[#00e5ff33] bg-[#00e5ff0d] px-3 py-2 text-sm">
          {m.text ? <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown></div> : null}
          {m.streaming && !m.text && <span className="flex gap-1 py-1"><i className="typing-dot" /><i className="typing-dot" /><i className="typing-dot" /></span>}
        </div>
      )}
      {m.error && <div className="mt-1 border border-[#ff3d7f66] bg-[#ff3d7f14] px-3 py-2 text-xs text-[#ffb3cb]">⚠ {m.error}</div>}
      {!m.streaming && (
        <div className="mt-1 flex gap-3 text-[10px] text-[#6f93b8]">
          {m.text && <button className="hover:text-neon" onClick={() => { navigator.clipboard?.writeText(m.text); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>{copied ? '✓ copied' : 'copy'}</button>}
          {last && <button className="hover:text-neon disabled:opacity-40" disabled={busy} onClick={onRegen}>↻ regenerate</button>}
        </div>
      )}
    </div>
  )
}

export function ChatPanel() {
  const { messages, busy, phase, send, regenerate, stop, clear } = useChat()
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')?.id

  const submit = () => { if (text.trim()) { send(text); setText('') } }
  return (
    <aside className="glass corner-brackets flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[#00e5ff22] px-3 py-2">
        <div><div className="section-title !mb-0">◈ Gemini · Terrain Copilot</div>
          <div className="text-[10px] text-[#6f93b8]">{busy ? (phase === 'acting' ? 'controlling terrain…' : phase === 'streaming' ? 'responding…' : 'thinking…') : 'sees your current view'}</div></div>
        <button className="text-[10px] text-[#6f93b8] hover:text-neon" onClick={clear}>clear</button>
      </div>

      <div className="scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="text-xs leading-relaxed text-[#8fb0d0]">
            Ask about this terrain, or tell it what to do — “highlight everything below 4000 m”, “show the steepest regions”, “start a flood simulation”.
          </div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} last={m.id === lastAssistant} onRegen={regenerate} busy={busy} />)}
        <div ref={end} />
      </div>

      <div className="border-t border-[#00e5ff22] p-2">
        {messages.length === 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTED.map((s) => <button key={s} className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>)}
          </div>
        )}
        <div className="flex gap-2">
          <textarea className="input scroll h-12 flex-1 resize-none" placeholder="Ask the Earth anything…" value={text}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} />
          {busy ? <button className="btn" onClick={stop}>■</button> : <button className="btn on" onClick={submit} disabled={!text.trim()}>Send</button>}
        </div>
      </div>
    </aside>
  )
}
