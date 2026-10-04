/** Browser-side client for our server-side Gemini proxy. The API key never reaches the browser. */
export interface GeminiPart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string }
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string }
  [k: string]: unknown
}
export interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }

export interface StreamResult { parts: GeminiPart[]; finishReason?: string; blockedReason?: string }

export async function streamChat(opts: {
  contents: GeminiContent[]
  context: unknown
  model?: string
  signal?: AbortSignal
  onText: (delta: string) => void
}): Promise<StreamResult> {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    signal: opts.signal,
    body: JSON.stringify({ contents: opts.contents, context: opts.context, model: opts.model }),
  })
  if (!res.ok || !res.body) throw new Error(`Chat request failed (HTTP ${res.status})`)

  const parts: GeminiPart[] = []
  let finishReason: string | undefined
  let blockedReason: string | undefined
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''

  const handle = (payload: string) => {
    let evt: any
    try { evt = JSON.parse(payload) } catch { return }
    if (evt.error) throw new Error(typeof evt.error === 'string' ? evt.error : evt.error.message || 'Gemini error')
    if (evt.promptFeedback?.blockReason) blockedReason = evt.promptFeedback.blockReason
    const cand = evt.candidates?.[0]
    if (!cand) return
    if (cand.finishReason) finishReason = cand.finishReason
    for (const p of (cand.content?.parts ?? []) as GeminiPart[]) {
      if (p.thought) continue
      if (typeof p.text === 'string' && !p.functionCall) {
        opts.onText(p.text)
        const last = parts[parts.length - 1]
        if (last && typeof last.text === 'string' && !last.functionCall && !p.thoughtSignature) last.text += p.text
        else parts.push({ ...p })
      } else parts.push({ ...p })
    }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (line.startsWith('data:')) handle(line.slice(5).trim())
    }
  }
  if (buf.trim().startsWith('data:')) handle(buf.trim().slice(5).trim())
  return { parts, finishReason, blockedReason }
}
