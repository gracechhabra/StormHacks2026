import { useEffect } from 'react'

import { useStore } from '../../store/useStore'
import { deriveHazards } from '../../lib/analysis'
import { fmtLat, fmtLon, fmtM } from '../../lib/geo'
import { useLiveStore } from '../../store/useLiveStore'
import { fmtLocal } from '../../services/live'
import { useState } from 'react'

function Led({ c }: { c: 'green' | 'amber' | 'red' | 'gray' }) { return <span className={`led ${c}`} /> }

function LiveCard() {
  const { live, status, error, label } = useLiveStore()
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  const loc = live ? fmtLocal(live, now) : null
  return (
    <div>
      <div className="section-title">Live location data {status === 'loading' && <span className="text-[#8fb0d0]">· updating…</span>}</div>
      {label && <div className="mb-1 text-[10px] text-[#6f93b8]">{label}</div>}
      {status === 'error' && <div className="text-xs text-[#ffb06f]">Live data unavailable: {error}</div>}
      {live && loc && (
        <>
          <div className="stat"><span>Local date</span><b>{loc.date}</b></div>
          <div className="stat"><span>Local time</span><b>{loc.time} {live.timezone_abbreviation}</b></div>
          <div className="stat"><span>Timezone</span><b>{live.timezone}</b></div>
          <div className="stat"><span>Temperature</span><b>{live.temperature_c != null ? `${live.temperature_c.toFixed(1)} °C` : '—'}</b></div>
          <div className="stat"><span>Weather</span><b>{live.weather ?? '—'}{live.is_day === false ? ' · night' : ''}</b></div>
          <div className="stat"><span>Elevation</span><b>{live.elevation_m != null ? fmtM(live.elevation_m) : '—'}</b></div>
          <div className="stat"><span>Latitude</span><b>{fmtLat(live.latitude)}</b></div>
          <div className="stat"><span>Longitude</span><b>{fmtLon(live.longitude)}</b></div>
          <div className="mt-1 text-[10px] text-[#6f93b8]">Source: {live.source}</div>
        </>
      )}
    </div>
  )
}

export function IntelPanel() {
  const t = useStore((s) => s.terrain)
  const a = useStore((s) => s.analysis)
  const sel = useStore((s) => s.selected)
  const sim = useStore((s) => s.simStats)
  if (!t || !a) return <aside className="glass corner-brackets h-full p-4 text-xs text-[#8fb0d0]">No terrain loaded.</aside>
  const st = a.stats
  const hz = deriveHazards(t, a)
  const hmax = Math.max(...a.hist, 1)
  return (
    <aside className="glass corner-brackets scroll flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
      <div>
        <div className="section-title">◈ Terrain intelligence</div>
        <div className="mb-1 text-sm font-semibold">{t.label}</div>
        <div className="stat"><span>Minimum elevation</span><b>{fmtM(st.min)}</b></div>
        <div className="stat"><span>Maximum elevation</span><b>{fmtM(st.max)}</b></div>
        <div className="stat"><span>Average elevation</span><b>{fmtM(st.mean)}</b></div>
        <div className="stat"><span>Elevation range</span><b>{fmtM(st.range)}</b></div>
        <div className="stat"><span>Mean / max slope</span><b>{st.meanSlope.toFixed(1)}° / {st.maxSlope.toFixed(0)}°</b></div>
        <div className="stat"><span>Extent</span><b>{st.spanKm.toFixed(2)} km · {t.size}² @ {t.mpp} m</b></div>
        <div className="stat"><span>Centre</span><b>{fmtLat(t.lat)} {fmtLon(t.lon)}</b></div>
        <div className="mt-1 text-[10px] text-[#6f93b8]">Source: {t.source}</div>
        <div className="mt-2 flex h-10 items-end gap-px">
          {a.hist.map((h, i) => <div key={i} className="flex-1 bg-gradient-to-t from-[#0a6a8a] to-neon" style={{ height: `${Math.max(3, (h / hmax) * 100)}%`, opacity: 0.85 }} />)}
        </div>
        <div className="flex justify-between font-mono text-[9px] text-[#6f93b8]"><span>{st.min.toFixed(0)}</span><span>hypsometry</span><span>{st.max.toFixed(0)}</span></div>
      </div>

      <div>
        <div className="section-title">Selected region</div>
        {sel ? <>
          <div className="stat"><span>Position</span><b>{fmtLat(sel.lat)} {fmtLon(sel.lon)}</b></div>
          <div className="stat"><span>Elevation</span><b>{fmtM(sel.elev)}</b></div>
          <div className="stat"><span>Slope / aspect</span><b>{sel.slope.toFixed(1)}° {sel.aspectName}</b></div>
          <div className="stat"><span>Terrain type</span><b className="!text-[11px]">{sel.terrainType}</b></div>
          {sel.landCover && <div className="stat"><span>Land cover</span><b>{sel.landCover}</b></div>}
          <div className="stat"><span>Local relief (5×5)</span><b>{sel.localMin.toFixed(0)}–{sel.localMax.toFixed(0)} m</b></div>
          <div className="stat"><span>Flood / slide index</span><b>{(sel.floodRisk * 100).toFixed(0)}% / {(sel.landslideRisk * 100).toFixed(0)}%</b></div>
        </> : <div className="text-xs text-[#6f93b8]">Click the terrain to lock a point.</div>}
      </div>

      <div>
        <div className="section-title">Potential hazards <span className="normal-case tracking-normal text-[#ffc14d]">· heuristic</span></div>
        {hz.map((h, i) => (
          <div key={i} className="mb-1 flex gap-2 text-[11px] leading-snug">
            <Led c={h.level === 'high' ? 'red' : h.level === 'watch' ? 'amber' : 'gray'} /><span>{h.text}</span>
          </div>
        ))}
      </div>

      {sim && (
        <div>
          <div className="section-title">Simulation result</div>
          <div className="text-[11px] text-[#cfe9ff]">
            {sim.kind === 'flood' ? `Inundated ${sim.wetPercent?.toFixed(1)}% · max depth ${sim.maxDepthM?.toFixed(1)} m` : `Affected ${sim.affectedPercent?.toFixed(1)}% · runout ≤ ${sim.maxRunoutM?.toFixed(0)} m`}
          </div>
          <div className="text-[9px] text-[#ffc14d]">Visualization, not a certified prediction.</div>
        </div>
      )}

      <LiveCard />
    </aside>
  )
}
