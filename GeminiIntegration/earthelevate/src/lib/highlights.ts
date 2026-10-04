import type { CrossSection, Highlight, TerrainAnalysis, TerrainData } from '../types'
import { cellToLatLon, compassName } from './geo'

export function byElevation(t: TerrainData, minM?: number, maxM?: number): Highlight {
  const N = t.size * t.size
  const mask = new Uint8Array(N)
  let count = 0
  for (let i = 0; i < N; i++) {
    const e = t.elev[i]
    if ((minM == null || e >= minM) && (maxM == null || e <= maxM)) { mask[i] = 1; count++ }
  }
  const label = minM != null && maxM != null ? `${minM.toFixed(0)}–${maxM.toFixed(0)} m` : maxM != null ? `below ${maxM.toFixed(0)} m` : `above ${(minM ?? 0).toFixed(0)} m`
  return { label: `Elevation ${label}`, mask, count, percent: (count / N) * 100 }
}

export function bySlope(t: TerrainData, a: TerrainAnalysis, minDeg: number): Highlight {
  const N = t.size * t.size
  const mask = new Uint8Array(N)
  let count = 0
  for (let i = 0; i < N; i++) if (a.slope[i] >= minDeg) { mask[i] = 1; count++ }
  return { label: `Slope ≥ ${minDeg.toFixed(0)}°`, mask, count, percent: (count / N) * 100 }
}

export function byExtreme(t: TerrainData, a: TerrainAnalysis, feature: 'highest' | 'lowest' | 'steepest', percent = 8): Highlight {
  const N = t.size * t.size
  const vals = feature === 'steepest' ? a.slope : t.elev
  const sorted = Float32Array.from(vals).sort()
  const k = Math.max(1, Math.round((percent / 100) * N))
  const thr = feature === 'lowest' ? sorted[k - 1] : sorted[N - k]
  const mask = new Uint8Array(N)
  let count = 0
  for (let i = 0; i < N; i++) {
    const hit = feature === 'lowest' ? vals[i] <= thr : vals[i] >= thr
    if (hit) { mask[i] = 1; count++ }
  }
  const noun = feature === 'highest' ? 'Highest' : feature === 'lowest' ? 'Lowest' : 'Steepest'
  return { label: `${noun} ${percent.toFixed(0)}% of terrain`, mask, count, percent: (count / N) * 100 }
}

/** Describe where a mask sits in the tile (centroid, compass sector, elevation span). */
export function locateMask(t: TerrainData, mask: ArrayLike<number>, a: TerrainAnalysis) {
  const n = t.size
  let cnt = 0, sr = 0, sc = 0, lo = Infinity, hi = -Infinity
  for (let i = 0; i < n * n; i++) {
    if (!mask[i]) continue
    cnt++; sr += (i / n) | 0; sc += i % n
    lo = Math.min(lo, t.elev[i]); hi = Math.max(hi, t.elev[i])
  }
  if (!cnt) return { percent: 0 }
  const r = sr / cnt, c = sc / cnt
  const { lat, lon } = cellToLatLon(t, r, c)
  const dy = (n - 1) / 2 - r, dx = c - (n - 1) / 2
  const sector = Math.hypot(dx, dy) < n * 0.12 ? 'central' : `${compassName(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360)} part`
  void a
  return {
    percent: +((cnt / (n * n)) * 100).toFixed(1), centroid_latitude: +lat.toFixed(5), centroid_longitude: +lon.toFixed(5),
    location_in_tile: sector, elevation_range_m: [+lo.toFixed(0), +hi.toFixed(0)],
  }
}

/** Rasterise a line between two cells (Bresenham) into a mask and return the sampled path. */
export function sectionPath(t: TerrainData, s: CrossSection) {
  const n = t.size
  const path: { row: number; col: number }[] = []
  let x0 = s.a.col, y0 = s.a.row
  const x1 = s.b.col, y1 = s.b.row
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    path.push({ row: y0, col: x0 })
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
  const mask = new Uint8Array(n * n)
  for (const p of path) mask[p.row * n + p.col] = 1
  return { path, mask }
}
