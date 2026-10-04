import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, ToolAction } from '../types'
import { streamChat, type GeminiContent, type GeminiPart } from '../services/gemini'
import { buildContext } from '../lib/context'
import { runCommand } from '../commands/commandHandler'

export const CHAT_KEY = 'terra-ai.chat.v1'
const MAX_ROUNDS = 5
const uid = () => Math.random().toString(36).slice(2, 10)

interface Stored { messages: ChatMessage[]; history: GeminiContent[] }
function load(): Stored {
  try {
    const s = JSON.parse(localStorage.getItem(CHAT_KEY) || '')
    if (Array.isArray(s.messages) && Array.isArray(s.history)) return { messages: s.messages.map((m: ChatMessage) => ({ ...m, streaming: false })), history: s.history }
  } catch { /* ignore */ }
  return { messages: [], history: [] }
}

export function useChat() {
  const init = useRef<Stored>(load())
  const [messages, setMessages] = useState<ChatMessage[]>(init.current.messages)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'streaming' | 'acting'>('idle')
  const history = useRef<GeminiContent[]>(init.current.history)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify({ messages: messages.slice(-60), history: history.current.slice(-60) })) } catch { /* quota */ }
  }, [messages])

  const patch = (id: string, f: (m: ChatMessage) => ChatMessage) => setMessages((ms) => ms.map((m) => (m.id === id ? f(m) : m)))

  /** One user turn: stream, execute any function calls, send results back, repeat until plain text. */
  const run = useCallback(async (userText: string | null, assistantId: string) => {
    const ac = new AbortController()
    abort.current = ac
    setBusy(true); setPhase('thinking')
    const base = history.current.length
    try {
      if (userText != null) history.current.push({ role: 'user', parts: [{ text: userText }] })
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const res = await streamChat({
          contents: history.current, context: buildContext(), signal: ac.signal,
          onText: (d) => { setPhase('streaming'); patch(assistantId, (m) => ({ ...m, text: m.text + d })) },
        })
        if (res.blockedReason) throw new Error(`The request was blocked (${res.blockedReason}).`)
        if (!res.parts.length) throw new Error(res.finishReason ? `Gemini returned no content (${res.finishReason}).` : 'Gemini returned an empty response.')
        history.current.push({ role: 'model', parts: res.parts })
        const calls = res.parts.filter((p): p is GeminiPart => !!p.functionCall)
        if (!calls.length) break

        setPhase('acting')
        const responses: GeminiPart[] = []
        for (const p of calls) {
          const fc = p.functionCall!
          let r
          try { r = await runCommand(fc.name, fc.args ?? {}) } catch (e) { r = { ok: false, summary: String((e as Error).message), data: { error: String((e as Error).message) } } }
          const action: ToolAction = { name: fc.name, args: fc.args ?? {}, ok: r.ok, summary: r.summary }
          patch(assistantId, (m) => ({ ...m, actions: [...m.actions, action] }))
          responses.push({ functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: r.ok ? r.data : { error: r.data.error ?? r.summary } } })
        }
        history.current.push({ role: 'user', parts: responses })
        // Let the scene settle so the next context reflects the new state.
        await new Promise((res) => setTimeout(res, 120))
        setPhase('thinking')
        if (round === MAX_ROUNDS - 1) patch(assistantId, (m) => ({ ...m, text: m.text || 'Done.' }))
      }
      patch(assistantId, (m) => ({ ...m, streaming: false, text: m.text || (m.actions.length ? 'Done.' : '') }))
    } catch (e) {
      if ((e as Error).name === 'AbortError') patch(assistantId, (m) => ({ ...m, streaming: false }))
      else patch(assistantId, (m) => ({ ...m, streaming: false, error: (e as Error).message }))
      // Roll back this turn so the stored history stays valid for the next request.
      history.current.length = Math.min(history.current.length, base)
    } finally {
      setBusy(false); setPhase('idle'); abort.current = null
    }
  }, [])

  const send = useCallback((text: string) => {
    const t = text.trim()
    if (!t || busy) return
    const aid = uid()
    setMessages((ms) => [...ms, { id: uid(), role: 'user', text: t, actions: [], createdAt: Date.now() }, { id: aid, role: 'assistant', text: '', actions: [], streaming: true, createdAt: Date.now() }])
    void run(t, aid)
  }, [busy, run])

  const regenerate = useCallback(() => {
    if (busy) return
    const lastUser = [...history.current].map((c, i) => ({ c, i })).reverse().find(({ c }) => c.role === 'user' && c.parts.some((p) => typeof p.text === 'string'))
    if (!lastUser) return
    const text = lastUser.c.parts.find((p) => p.text)!.text!
    history.current.length = lastUser.i // drop that user turn and everything after; run() re-adds it
    setMessages((ms) => {
      let idx = -1
      for (let i = ms.length - 1; i >= 0; i--) if (ms[i].role === 'user') { idx = i; break }
      return idx < 0 ? ms : ms.slice(0, idx)
    })
    const uidMsg = uid(), aid = uid()
    setMessages((ms) => [...ms, { id: uidMsg, role: 'user', text, actions: [], createdAt: Date.now() }, { id: aid, role: 'assistant', text: '', actions: [], streaming: true, createdAt: Date.now() }])
    void run(text, aid)
  }, [busy, run])

  const stop = useCallback(() => abort.current?.abort(), [])
  const clear = useCallback(() => { abort.current?.abort(); history.current = []; setMessages([]); localStorage.removeItem(CHAT_KEY) }, [])

  return { messages, busy, phase, send, regenerate, stop, clear }
}
