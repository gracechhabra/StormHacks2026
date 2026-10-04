import { useStore } from '../../store/useStore'
import { fmtM } from '../../lib/geo'

export function SimulationPanel() {
  const s = useStore()
  const { simParams: p, simStatus: st, simStats: m, analysis: a } = s
  const active = st !== 'idle'
  return (
    <div className="glass w-64 p-3">
      <div className="section-title">Disaster simulation</div>
      <div className="grid grid-cols-2 gap-1.5">
        {(['flood', 'landslide'] as const).map((k) => <button key={k} className={`btn ${p.kind === k ? 'on' : ''}`} disabled={active} onClick={() => s.setSimParams({ kind: k })}>{k === 'flood' ? 'Flood' : 'Landslide'}</button>)}
      </div>

      {p.kind === 'flood' && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button className={`btn ${p.mode === 'rainfall' ? 'on' : ''}`} disabled={active} onClick={() => s.setSimParams({ mode: 'rainfall' })}>Rainfall</button>
          <button className={`btn ${p.mode === 'level' ? 'on' : ''}`} disabled={active} onClick={() => s.setSimParams({ mode: 'level' })}>Water level</button>
        </div>
      )}
      {(p.kind === 'landslide' || p.mode === 'rainfall') ? (
        <label className="mt-2 block text-[11px] text-[#8fb0d0]">{p.kind === 'landslide' ? 'Rainfall trigger' : 'Rainfall'} <b className="font-mono text-white">{p.rainfallMm} mm</b>
          <input type="range" min={10} max={500} step={10} value={p.rainfallMm} disabled={active} onChange={(e) => s.setSimParams({ rainfallMm: +e.target.value })} className="w-full accent-[#00e5ff]" />
        </label>
      ) : a && (
        <label className="mt-2 block text-[11px] text-[#8fb0d0]">Water level <b className="font-mono text-white">{fmtM(p.waterLevelM ?? a.stats.min)}</b>
          <input type="range" min={Math.floor(a.stats.min)} max={Math.ceil(a.stats.max)} step={1} value={p.waterLevelM ?? a.stats.min} disabled={active} onChange={(e) => s.setSimParams({ waterLevelM: +e.target.value })} className="w-full accent-[#00e5ff]" />
        </label>
      )}

      <div className="mt-2 flex gap-1.5">
        {!active && <button className="btn on flex-1" onClick={() => s.startSim()}>▶ Run</button>}
        {st === 'running' && <button className="btn flex-1" onClick={s.pauseSim}>❚❚ Pause</button>}
        {st === 'paused' && <button className="btn flex-1" onClick={s.resumeSim}>▶ Resume</button>}
        {active && <button className="btn flex-1" onClick={s.stopSim}>■ Clear</button>}
      </div>

      {m && active && (
        <div className="mt-2">
          <div className="h-1 bg-[#00e5ff1a]"><div className="h-full bg-neon transition-all" style={{ width: `${(m.progress * 100).toFixed(0)}%` }} /></div>
          <div className="mt-1.5 text-[11px]">
            {m.kind === 'flood' ? <>
              <div className="stat"><span>Inundated area</span><b>{m.wetPercent?.toFixed(1)}%</b></div>
              <div className="stat"><span>Max depth</span><b>{m.maxDepthM?.toFixed(1)} m</b></div>
              <div className="stat"><span>Mean depth (wet)</span><b>{m.meanDepthM?.toFixed(2)} m</b></div>
              {m.currentLevelM != null && <div className="stat"><span>Water surface</span><b>{fmtM(m.currentLevelM)}</b></div>}
              {m.flowDirection && <div className="stat"><span>Flow direction</span><b>{m.flowDirection}</b></div>}
            </> : <>
              <div className="stat"><span>Source cells</span><b>{m.sourceCells}</b></div>
              <div className="stat"><span>Affected area</span><b>{m.affectedPercent?.toFixed(1)}%</b></div>
              <div className="stat"><span>Max runout</span><b>{m.maxRunoutM?.toFixed(0)} m</b></div>
              {m.flowDirection && <div className="stat"><span>Movement</span><b>{m.flowDirection}</b></div>}
            </>}
          </div>
        </div>
      )}
      <div className="mt-2 text-[9px] leading-snug text-[#ffc14d]">Illustrative visualization derived only from the DEM. Not a certified hazard prediction.</div>
    </div>
  )
}
