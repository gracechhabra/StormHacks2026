import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { sceneState } from './lib/sceneState'
import { TerrainViewer } from './components/scene/TerrainViewer'
import { Header } from './components/ui/Header'
import { ChatPanel } from './components/ui/ChatPanel'
import { IntelPanel } from './components/ui/IntelPanel'
import { LayerControls } from './components/ui/LayerControls'
import { SimulationPanel } from './components/ui/SimulationPanel'
import { ElevationProfile } from './components/ui/ElevationProfile'
import { fmtLat, fmtLon, fmtM } from './lib/geo'
import { useState } from 'react'
import { useLiveLocation } from './hooks/useLiveLocation'

function Fps() {
  const [fps, setFps] = useState(0)
  useEffect(() => { const id = setInterval(() => setFps(sceneState.fps), 500); return () => clearInterval(id) }, [])
  return <span>{fps ? `${fps.toFixed(0)} fps` : '—'}</span>
}

function Viewer() {
  const s = useStore()
  const { hover, loading, error, toast, terrain, sectionPicking, crossSection } = s
  const [simOpen, setSimOpen] = useState(true)
  return (
    <main className="relative min-h-0 flex-1 overflow-hidden border border-[#00e5ff22] bg-void">
      <TerrainViewer />

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="pointer-events-auto flex flex-col gap-3"><LayerControls /></div>
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            <div className="glass flex gap-1.5 p-1.5">
              <button className="btn" onClick={s.overview}>⌂ Reset view</button>
              <button className={`btn ${sectionPicking ? 'on' : ''}`} onClick={() => s.setSectionPicking(sectionPicking ? null : { a: null })}>
                {sectionPicking ? (sectionPicking.a ? 'Click end point…' : 'Click start point…') : '⟷ Cross-section'}
              </button>
              <button className="btn" onClick={() => s.togglePanel('left')}>{s.leftOpen ? '◀ Chat' : '▶ Chat'}</button>
              <button className="btn" onClick={() => s.togglePanel('right')}>{s.rightOpen ? 'Intel ▶' : '◀ Intel'}</button>
            </div>
            <div className="glass px-2 py-1 font-mono text-[10px] text-[#8fb0d0]">
              drag rotate · scroll zoom · right-drag pan · WASD move · Q/E turn · click to lock
            </div>
          </div>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="pointer-events-auto flex flex-col gap-2">
            <button className="btn w-fit" onClick={() => setSimOpen(!simOpen)}>⚠ Simulation {simOpen ? '▾' : '▸'}</button>
            {simOpen && <SimulationPanel />}
          </div>
          <div className="pointer-events-auto flex flex-col items-center gap-2">
            {crossSection && <ElevationProfile />}
          </div>
          <div className="glass pointer-events-auto min-w-[190px] p-2 font-mono text-[10px] text-[#8fb0d0]">
            <div className="section-title !mb-1">Cursor</div>
            {hover ? <>
              <div>{fmtLat(hover.lat)} {fmtLon(hover.lon)}</div>
              <div className="text-white">{fmtM(hover.elev)} · slope {hover.slope.toFixed(1)}°</div>
              <div>{hover.terrainType}</div>
            </> : <div>hover the terrain</div>}
            <div className="mt-1 flex justify-between border-t border-[#00e5ff1f] pt-1">
              <span>browser render</span><Fps />
            </div>
          </div>
        </div>
      </div>

      {(loading || (!terrain && !error)) && (
        <div className="absolute inset-0 grid place-items-center bg-[#02050ccc]">
          <div className="holo-title animate-pulse text-sm tracking-[0.3em]">{loading ?? 'INITIALISING EARTH…'}</div>
        </div>
      )}
      {error && <div className="glass absolute left-1/2 top-1/2 max-w-md -translate-x-1/2 -translate-y-1/2 p-4 text-sm text-[#ffb3cb]">{error}</div>}
      {toast && <div key={toast.id} className="glass fade-in absolute bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 text-xs text-[#bff6ff]">{toast.text}</div>}
    </main>
  )
}

export default function App() {
  const init = useStore((s) => s.init)
  const left = useStore((s) => s.leftOpen)
  const right = useStore((s) => s.rightOpen)
  useLiveLocation()
  useEffect(() => { void init() }, [init])
  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <Header />
      <div className="flex min-h-0 flex-1 gap-2">
        <div className={`w-[340px] shrink-0 ${left ? "" : "hidden"}`}><ChatPanel /></div>
        <Viewer />
        {right && <div className="w-[300px] shrink-0"><IntelPanel /></div>}
      </div>
    </div>
  )
}
