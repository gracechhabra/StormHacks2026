import { useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { sectionPath } from '../../lib/highlights'
import { cellToLatLon } from '../../lib/geo'

export function ElevationProfile() {
  const t = useStore((s) => s.terrain)
  const cs = useStore((s) => s.crossSection)
  const hover = useStore((s) => s.profileHover)
  const setHover = useStore((s) => s.setProfileHover)
  const setCs = useStore((s) => s.setCrossSection)
  const data = useMemo(() => {
    if (!t || !cs) return null
    const { path } = sectionPath(t, cs)
    const e = path.map((p) => t.elev[p.row * t.size + p.col])
    const ds = path.length > 1 ? Math.hypot(cs.b.row - cs.a.row, cs.b.col - cs.a.col) * t.mpp : 0
    return { e, ds, path }
  }, [t, cs])
  if (!data || !t || !cs) return null
  const W = 520, H = 90, P = 4
  const lo = Math.min(...data.e), hi = Math.max(...data.e), rg = Math.max(hi - lo, 1)
  const x = (i: number) => P + (i / Math.max(data.e.length - 1, 1)) * (W - 2 * P)
  const y = (v: number) => H - P - ((v - lo) / rg) * (H - 2 * P)
  const pts = data.e.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const hi_i = hover != null ? Math.round(hover * (data.e.length - 1)) : null
  const hp = hi_i != null ? data.path[hi_i] : null
  const ll = hp ? cellToLatLon(t, hp.row, hp.col) : null
  return (
    <div className="glass fade-in w-[560px] p-2">
      <div className="mb-1 flex items-center justify-between text-[10px]">
        <span className="section-title !mb-0">Elevation profile · {cs.label}</span>
        <button className="text-[#ff9fbd]" onClick={() => setCs(null)}>✕</button>
      </div>
      <svg width={W} height={H} className="block max-w-full" viewBox={`0 0 ${W} ${H}`}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.min(1, Math.max(0, ((e.clientX - r.left) / r.width * W - P) / (W - 2 * P)))) }}
        onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id="pf" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#c43bff" stopOpacity=".5" /><stop offset="1" stopColor="#c43bff" stopOpacity="0" /></linearGradient></defs>
        <polygon points={`${P},${H - P} ${pts} ${W - P},${H - P}`} fill="url(#pf)" />
        <polyline points={pts} fill="none" stroke="#ff5df0" strokeWidth="1.6" />
        {hi_i != null && <><line x1={x(hi_i)} x2={x(hi_i)} y1={0} y2={H} stroke="#fff" strokeOpacity=".6" /><circle cx={x(hi_i)} cy={y(data.e[hi_i])} r="3.5" fill="#fff" /></>}
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-[#8fb0d0]">
        <span>{lo.toFixed(0)}–{hi.toFixed(0)} m · {(data.ds / 1000).toFixed(2)} km</span>
        {hi_i != null && ll && <span className="text-white">{data.e[hi_i].toFixed(0)} m @ {ll.lat.toFixed(4)}, {ll.lon.toFixed(4)}</span>}
      </div>
    </div>
  )
}
