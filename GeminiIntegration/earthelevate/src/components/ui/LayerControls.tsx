import { useStore } from '../../store/useStore'
import { legendFor } from '../../lib/colorLayers'
import { ATTRIBUTION } from '../../services/imagery'
import type { BaseLayer } from '../../types'

const LAYERS: [BaseLayer, string][] = [['elevation', 'Elevation'], ['slope', 'Slope'], ['flood_risk', 'Flood Risk'], ['landslide_risk', 'Landslide Risk'], ['satellite', 'Map / Satellite']]

export function LayerControls() {
  const s = useStore()
  const { terrain, analysis, baseLayer } = s
  const legend = terrain && analysis ? legendFor(baseLayer, terrain, analysis) : null
  return (
    <div className="glass w-56 p-3">
      <div className="section-title">Layers</div>
      <div className="flex flex-col gap-1.5">
        {LAYERS.map(([k, label]) => <button key={k} className={`btn ${baseLayer === k ? 'on' : ''}`} onClick={() => s.setBaseLayer(k)}>{label}</button>)}
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          <button className={`btn ${s.contours ? 'on' : ''}`} onClick={() => s.toggleContours()}>Contours</button>
          <button className={`btn ${s.viewMode === 'voxel' ? 'on' : ''}`} onClick={() => s.setViewMode(s.viewMode === 'voxel' ? 'surface' : 'voxel')}>Voxel View</button>
        </div>
      </div>
      {baseLayer === 'satellite' && (
        <div className="mt-2 text-[10px] text-[#8fb0d0]">
          <div className="flex gap-1.5">
            {(['satellite', 'map'] as const).map((k) => <button key={k} className={`btn flex-1 !py-0.5 ${s.imagery === k ? 'on' : ''}`} onClick={() => s.setImagery(k)}>{k}</button>)}
          </div>
          <div className="mt-1.5">
            {s.satellite.status === 'loading' && 'Loading imagery tiles…'}
            {s.satellite.status === 'ready' && ATTRIBUTION[s.satellite.kind]}
            {s.satellite.status === 'error' && <span className="text-[#ffb06f]">Imagery unavailable ({s.satellite.error}). Showing relief-derived colours.</span>}
          </div>
        </div>
      )}
      <div className="mt-3">
        <div className="flex justify-between text-[10px] text-[#8fb0d0]"><span>Vertical exaggeration</span><b className="font-mono">×{s.exaggeration.toFixed(1)}</b></div>
        <input type="range" min={0.5} max={6} step={0.1} value={s.exaggeration} onChange={(e) => s.setExaggeration(+e.target.value)} className="w-full accent-[#00e5ff]" />
      </div>
      {legend && (
        <div className="mt-2">
          <div className="text-[10px] text-[#8fb0d0]">{legend.title}</div>
          {baseLayer !== 'satellite' && <>
            <div className="mt-1 h-2" style={{ background: `linear-gradient(90deg, ${legend.stops.map(([p, c]) => `${c} ${p * 100}%`).join(',')})` }} />
            <div className="flex justify-between font-mono text-[10px] text-[#8fb0d0]"><span>{legend.lo}</span><span>{legend.hi}</span></div>
          </>}
        </div>
      )}
      {s.highlight && (
        <div className="mt-2 flex items-center justify-between border border-[#00e5ff44] px-2 py-1 text-[10px] text-[#9cf0ff]">
          <span>▣ {s.highlight.label} · {s.highlight.percent.toFixed(1)}%</span>
          <button className="text-[#ff9fbd]" onClick={() => s.setHighlight(null)}>✕</button>
        </div>
      )}
    </div>
  )
}
