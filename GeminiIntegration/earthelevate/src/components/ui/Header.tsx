import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { generateTerrain, searchPlaces } from '../../services/api'
import type { SearchResult } from '../../types'

export function Header() {
  const terrain = useStore((s) => s.terrain)
  const terrains = useStore((s) => s.terrains)
  const loadTerrain = useStore((s) => s.loadTerrain)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setResults([]) }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [])

  const search = async () => {
    if (!q.trim()) return
    setBusy(true); setMsg(null)
    try {
      const r = await searchPlaces(q)
      setResults(r.results)
      if (!r.results.length) setMsg(r.error || 'No matches')
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  const choose = async (r: SearchResult) => {
    if (r.cached_key) { setResults([]); await loadTerrain(r.cached_key); return }
    setBusy(true); setMsg(`Downloading real DEM for ${r.label}…`)
    try {
      const g = await generateTerrain({ label: r.label, lat: r.lat, lon: r.lon })
      if (!g.ok || !g.key) throw new Error(g.error || 'DEM unavailable for this location')
      setResults([]); setMsg(null)
      await loadTerrain(g.key)
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <header className="glass relative z-30 flex items-center gap-4 px-4 py-2">
      <div className="flex items-center gap-3">
        <div className="relative h-7 w-7">
          <div className="absolute inset-0 rotate-45 border border-neon" />
          <div className="absolute inset-[7px] rotate-45 bg-neon shadow-[0_0_12px_#00e5ff]" />
        </div>
        <div>
          <div className="holo-title text-base font-bold leading-none">TERRA AI</div>
          <div className="mt-0.5 text-[10px] tracking-[0.3em] text-[#6f93b8]">ASK THE EARTH ANYTHING</div>
        </div>
      </div>

      <div ref={box} className="relative ml-4 flex-1 max-w-xl">
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Search a place or coordinates (e.g. Vancouver, or 49.28, -123.12)" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
          <button className="btn" onClick={search} disabled={busy}>{busy ? '…' : 'Locate'}</button>
        </div>
        {(results.length > 0 || msg) && (
          <div className="glass absolute left-0 right-0 top-full mt-1 p-1 text-xs">
            {msg && <div className="px-2 py-1 text-[#9fc3e6]">{msg}</div>}
            {results.map((r, i) => (
              <button key={i} className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-[#00e5ff1f]" onClick={() => choose(r)}>
                <span><b>{r.label}</b> <span className="text-[#6f93b8]">{r.country}</span><br />
                  <span className="font-mono text-[10px] text-[#6f93b8]">{r.lat.toFixed(4)}, {r.lon.toFixed(4)}</span></span>
                <span className={`text-[10px] ${r.cached_key ? 'text-[#4dffb0]' : 'text-[#ffc14d]'}`}>{r.cached_key ? 'DEM ready · fly to' : 'Download DEM'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 text-xs">
        <a className="btn" href={`${window.location.protocol}//${window.location.hostname}:8080/ui`}>New location</a>
        <span className="text-[#6f93b8]">DATASET</span>
        <select className="input !w-auto" value={terrain?.key ?? ''} onChange={(e) => loadTerrain(e.target.value)}>
          {terrains.map((t) => <option key={t.key} value={t.key}>{t.label} · {t.mpp} m</option>)}
        </select>
      </div>
    </header>
  )
}
