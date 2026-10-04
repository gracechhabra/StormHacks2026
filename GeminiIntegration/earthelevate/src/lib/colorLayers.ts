import type { BaseLayer, Highlight, TerrainAnalysis, TerrainData } from '../types'
import type { Simulation } from './simulation'
import { clamp } from './geo'

type RGB = [number, number, number]
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]

function ramp(stops: [number, string][]) {
  const s = stops.map(([p, h]) => [p, hex(h)] as [number, RGB])
  return (v: number, out: RGB = [0, 0, 0]): RGB => {
    v = clamp(v, 0, 1)
    for (let i = 1; i < s.length; i++) {
      if (v <= s[i][0]) {
        const [p0, c0] = s[i - 1], [p1, c1] = s[i]
        const t = (v - p0) / (p1 - p0 || 1)
        out[0] = c0[0] + (c1[0] - c0[0]) * t; out[1] = c0[1] + (c1[1] - c0[1]) * t; out[2] = c0[2] + (c1[2] - c0[2]) * t
        return out
      }
    }
    const c = s[s.length - 1][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out
  }
}

export const RAMPS = {
  elevation: [[0, '#0a2a6b'], [0.22, '#0e8fb0'], [0.45, '#2fd6a0'], [0.65, '#e6e36a'], [0.82, '#ff8a3d'], [1, '#ffffff']] as [number, string][],
  slope: [[0, '#0b3b4a'], [0.22, '#19c37d'], [0.45, '#ffd23f'], [0.65, '#ff4d6d'], [1, '#b5179e']] as [number, string][],
  flood_risk: [[0, '#0a1a3a'], [0.5, '#1e6bff'], [1, '#7df9ff']] as [number, string][],
  landslide_risk: [[0, '#1a1230'], [0.45, '#a855f7'], [0.75, '#ff6b35'], [1, '#ff1744']] as [number, string][],
}
const rElev = ramp(RAMPS.elevation), rSlope = ramp(RAMPS.slope), rFlood = ramp(RAMPS.flood_risk), rSlide = ramp(RAMPS.landslide_risk)

export const SLOPE_FULL_SCALE_DEG = 60

export function legendFor(layer: BaseLayer, t: TerrainData, a: TerrainAnalysis) {
  switch (layer) {
    case 'elevation': return { title: 'Elevation', stops: RAMPS.elevation, lo: `${a.stats.min.toFixed(0)} m`, hi: `${a.stats.max.toFixed(0)} m` }
    case 'slope': return { title: 'Slope', stops: RAMPS.slope, lo: '0°', hi: `${SLOPE_FULL_SCALE_DEG}°+` }
    case 'flood_risk': return { title: 'Flood susceptibility (heuristic)', stops: RAMPS.flood_risk, lo: 'low', hi: 'high' }
    case 'landslide_risk': return { title: 'Landslide susceptibility (heuristic)', stops: RAMPS.landslide_risk, lo: 'low', hi: 'high' }
    default: return { title: t.blocks && t.fpgaMatch ? 'Land cover (FPGA world)' : 'Imagery', stops: [[0, '#2a5a2a'], [0.5, '#8a7a5a'], [1, '#e8eef5']] as [number, string][], lo: '', hi: '' }
  }
}

/** Derived natural-colour fallback used when imagery tiles cannot be fetched. */
function naturalColor(t: TerrainData, a: TerrainAnalysis, i: number, out: RGB) {
  if (t.blocks && t.blockColors) {
    const c = t.blockColors[String(t.blocks[i])]
    if (c) {
      const shade = 0.85 + 0.3 * (a.relElev[i] - 0.5)
      out[0] = (c[0] / 255) * shade; out[1] = (c[1] / 255) * shade; out[2] = (c[2] / 255) * shade
      return
    }
  }
  const rel = a.relElev[i], s = a.slope[i]
  if (t.elev[i] <= 1.5 && s < 1.5) { out[0] = 0.08; out[1] = 0.25; out[2] = 0.45; return }
  const g = hex('#4a7a3c'), rock = hex('#7d7a74'), snow = hex('#eef3f8'), dirt = hex('#8a6d4b')
  const rockMix = clamp((s - 18) / 22, 0, 1)
  const snowMix = clamp((rel - 0.82) / 0.12, 0, 1) * (1 - rockMix * 0.5)
  for (let k = 0; k < 3; k++) {
    let v = g[k] + (dirt[k] - g[k]) * clamp((rel - 0.35) / 0.4, 0, 1)
    v = v + (rock[k] - v) * rockMix
    out[k] = v + (snow[k] - v) * snowMix
  }
}

export function computeBaseColors(t: TerrainData, a: TerrainAnalysis, layer: BaseLayer, sat: Float32Array | null, out: Float32Array) {
  const N = t.size * t.size
  const c: RGB = [0, 0, 0]
  for (let i = 0; i < N; i++) {
    switch (layer) {
      case 'elevation': rElev(a.relElev[i], c); break
      case 'slope': rSlope(a.slope[i] / SLOPE_FULL_SCALE_DEG, c); break
      case 'flood_risk': rFlood(a.floodRisk[i], c); break
      case 'landslide_risk': rSlide(a.landslideRisk[i], c); break
      default:
        if (sat) { c[0] = sat[i * 3]; c[1] = sat[i * 3 + 1]; c[2] = sat[i * 3 + 2] } else naturalColor(t, a, i, c)
    }
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]
  }
}

export function computeOverlay(
  N: number,
  highlight: Highlight | null,
  sim: Simulation | null,
  section: Uint8Array | null,
  out: Float32Array,
) {
  for (let i = 0; i < N; i++) {
    let r = 0, g = 0, b = 0, al = 0
    if (highlight) {
      if (highlight.mask[i]) { r = 0.1; g = 0.95; b = 1; al = 0.62 } else { r = 0.01; g = 0.02; b = 0.05; al = 0.62 }
    }
    if (sim && sim.kind === 'landslide' && sim.affected) {
      const aff = sim.affected[i]
      if (sim.source && sim.source[i]) { r = 1; g = 0.95; b = 0.4; al = 0.95 }
      else if (aff > 0.02) {
        const k = Math.min(1, aff * 1.2) * 0.9
        r = 1; g = 0.35 + 0.15 * (1 - aff); b = 0.1; al = Math.max(al, k)
      }
    }
    if (section && section[i]) { r = 1; g = 0.2; b = 0.9; al = 0.95 }
    const o = i * 4
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = al
  }
}
