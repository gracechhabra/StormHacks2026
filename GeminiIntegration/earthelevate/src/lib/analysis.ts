import type { CellInfo, TerrainAnalysis, TerrainData } from '../types'
import { cellToLatLon, clamp, compassName, smoothstep } from './geo'

export const TERRAIN_CLASSES = [
  'Sea-level / water surface (DEM ≈ 0 m)',
  'Summit / ridge crest',
  'Steep escarpment',
  'Steep mountain slope',
  'Valley / depression',
  'Low-lying plain',
  'Flat plateau / terrace',
  'Hillside / rolling terrain',
]

const DX = [-1, 0, 1, -1, 1, -1, 0, 1]
const DY = [-1, -1, -1, 0, 0, 1, 1, 1]
const DIST = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2]

/** Horn slope/aspect, TPI, D8 flow accumulation, minimax flood levels, and heuristic hazard indices. */
export function analyzeTerrain(t: TerrainData): TerrainAnalysis {
  const n = t.size
  const e = t.elev
  const N = n * n
  const at = (r: number, c: number) => e[clamp(r, 0, n - 1) * n + clamp(c, 0, n - 1)]

  const slope = new Float32Array(N)
  const aspect = new Float32Array(N)
  let min = Infinity, max = -Infinity, sum = 0
  for (let i = 0; i < N; i++) { const v = e[i]; if (v < min) min = v; if (v > max) max = v; sum += v }
  const mean = sum / N
  const range = Math.max(1e-6, max - min)

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = at(r - 1, c - 1), b = at(r - 1, c), cc = at(r - 1, c + 1)
      const d = at(r, c - 1), f = at(r, c + 1)
      const g = at(r + 1, c - 1), h = at(r + 1, c), ii = at(r + 1, c + 1)
      const dzdx = ((cc + 2 * f + ii) - (a + 2 * d + g)) / (8 * t.mpp)
      const dzdy = ((g + 2 * h + ii) - (a + 2 * b + cc)) / (8 * t.mpp) // +y is south
      const s = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI)
      const idx = r * n + c
      slope[idx] = s
      if (s < 0.2) aspect[idx] = -1
      else {
        // downslope direction = -gradient; compass bearing with +x east, +y south
        const bearing = (Math.atan2(-dzdx, dzdy) * 180) / Math.PI
        aspect[idx] = (bearing + 360) % 360
      }
    }
  }

  // Topographic position index, 4-cell radius.
  const tpi = new Float32Array(N)
  const R = 4
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      let s2 = 0, k = 0
      for (let dr = -R; dr <= R; dr += 2) for (let dc = -R; dc <= R; dc += 2) {
        const rr = r + dr, cc = c + dc
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue
        s2 += e[rr * n + cc]; k++
      }
      tpi[r * n + c] = e[r * n + c] - s2 / k
    }
  }

  const relElev = new Float32Array(N)
  for (let i = 0; i < N; i++) relElev[i] = (e[i] - min) / range

  // D8 downhill + flow accumulation
  const downhill = new Int32Array(N).fill(-1)
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r * n + c
    let best = 0, bi = -1
    for (let k = 0; k < 8; k++) {
      const rr = r + DY[k], cc = c + DX[k]
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue
      const drop = (e[i] - e[rr * n + cc]) / DIST[k]
      if (drop > best) { best = drop; bi = rr * n + cc }
    }
    downhill[i] = bi
  }
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => e[b] - e[a])
  const acc = new Float32Array(N).fill(1)
  for (const i of order) { const d = downhill[i]; if (d >= 0) acc[d] += acc[i] }
  const flowAcc = new Float32Array(N)
  const logMax = Math.log(Math.max(2, Math.max(...acc)))
  for (let i = 0; i < N; i++) flowAcc[i] = Math.log(acc[i]) / logMax

  // Minimax flood level: lowest water level at which a cell is wet AND hydraulically connected to the lowest region.
  const floodNeed = new Float32Array(N).fill(Infinity)
  const heap: number[] = []
  const push = (i: number) => { heap.push(i); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (floodNeed[heap[p]] <= floodNeed[heap[k]]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p } }
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { let l = 2 * k + 1, r2 = l + 1, m = k; if (l < heap.length && floodNeed[heap[l]] < floodNeed[heap[m]]) m = l; if (r2 < heap.length && floodNeed[heap[r2]] < floodNeed[heap[m]]) m = r2; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m } } return top }
  const seedTol = min + Math.max(0.6, range * 0.01)
  for (let i = 0; i < N; i++) if (e[i] <= seedTol) { floodNeed[i] = e[i]; push(i) }
  while (heap.length) {
    const i = pop(); const r = (i / n) | 0, c = i % n
    for (let k = 0; k < 8; k++) {
      const rr = r + DY[k], cc = c + DX[k]
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue
      const j = rr * n + cc
      const need = Math.max(floodNeed[i], e[j])
      if (need < floodNeed[j]) { floodNeed[j] = need; push(j) }
    }
  }

  // Local minimum window (radius 14) for "low relative to surroundings"
  const floodRisk = new Float32Array(N)
  const landslideRisk = new Float32Array(N)
  const wr = 14
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    let lo = Infinity
    for (let dr = -wr; dr <= wr; dr += 2) for (let dc = -wr; dc <= wr; dc += 2) {
      const rr = r + dr, cc = c + dc
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue
      lo = Math.min(lo, e[rr * n + cc])
    }
    const i = r * n + c
    const above = e[i] - lo
    const lowness = 1 - smoothstep(0, Math.max(4, range * 0.18), above)
    const flat = 1 - smoothstep(1.5, 12, slope[i])
    floodRisk[i] = clamp(0.45 * lowness + 0.3 * flat + 0.25 * smoothstep(0.25, 0.9, flowAcc[i]) * flat * 2, 0, 1)

    const steep = smoothstep(14, 40, slope[i]) * (1 - 0.5 * smoothstep(55, 75, slope[i]))
    const concave = smoothstep(0, Math.max(3, range * 0.04), -tpi[i])
    landslideRisk[i] = clamp(0.78 * steep + 0.14 * concave * smoothstep(8, 25, slope[i]) + 0.08 * smoothstep(0.25, 0.9, flowAcc[i]) * steep, 0, 1)
  }

  // Terrain classes
  const terrainClass = new Uint8Array(N)
  const tpiThr = Math.max(2, range * 0.03)
  for (let i = 0; i < N; i++) {
    const s = slope[i]
    let cls = 7
    if (e[i] <= 1.5 && s < 1.5 && min <= 1.5) cls = 0
    else if (s > 38) cls = 2
    else if (s > 22) cls = 3
    else if (tpi[i] > tpiThr && relElev[i] > 0.45) cls = 1
    else if (tpi[i] < -tpiThr) cls = 4
    else if (s < 3 && relElev[i] < 0.25) cls = 5
    else if (s < 6) cls = 6
    terrainClass[i] = cls
  }

  let hi = 0, lo = 0, st = 0, slopeSum = 0
  for (let i = 0; i < N; i++) {
    if (e[i] > e[hi]) hi = i
    if (e[i] < e[lo]) lo = i
    if (slope[i] > slope[st]) st = i
    slopeSum += slope[i]
  }
  const bins = 32
  const hist = new Array(bins).fill(0)
  for (let i = 0; i < N; i++) hist[Math.min(bins - 1, Math.floor(relElev[i] * bins))]++

  return {
    size: n, slope, aspect, tpi, relElev, flowAcc, downhill, floodRisk, landslideRisk, floodNeed, terrainClass,
    hist,
    stats: {
      min, max, mean, range, meanSlope: slopeSum / N, maxSlope: slope[st], spanKm: (t.mpp * n) / 1000,
      highest: { row: (hi / n) | 0, col: hi % n },
      lowest: { row: (lo / n) | 0, col: lo % n },
      steepest: { row: (st / n) | 0, col: st % n },
    },
  }
}

export function cellInfo(t: TerrainData, a: TerrainAnalysis, row: number, col: number): CellInfo {
  const n = t.size
  row = clamp(Math.round(row), 0, n - 1); col = clamp(Math.round(col), 0, n - 1)
  const i = row * n + col
  const { lat, lon } = cellToLatLon(t, row, col)
  let lo = Infinity, hi = -Infinity, sum = 0, ss = 0, k = 0
  for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) {
    const rr = row + dr, cc = col + dc
    if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue
    const v = t.elev[rr * n + cc]
    lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; ss += a.slope[rr * n + cc]; k++
  }
  let landCover: string | null = null
  if (t.blocks && t.blockTypes) landCover = t.blockTypes[String(t.blocks[i])] ?? null
  return {
    row, col, lat, lon,
    elev: t.elev[i], slope: a.slope[i], aspect: a.aspect[i], aspectName: compassName(a.aspect[i]),
    terrainType: TERRAIN_CLASSES[a.terrainClass[i]], landCover,
    floodRisk: a.floodRisk[i], landslideRisk: a.landslideRisk[i], relElev: a.relElev[i],
    localMin: lo, localMax: hi, localMean: sum / k, localSlope: ss / k,
  }
}

export interface HazardItem { level: 'info' | 'watch' | 'high'; text: string }

export function deriveHazards(t: TerrainData, a: TerrainAnalysis): HazardItem[] {
  const N = t.size * t.size
  let steep = 0, vsteep = 0, flood = 0, slide = 0
  for (let i = 0; i < N; i++) {
    if (a.slope[i] > 30) steep++
    if (a.slope[i] > 45) vsteep++
    if (a.floodRisk[i] > 0.7) flood++
    if (a.landslideRisk[i] > 0.6) slide++
  }
  const pct = (x: number) => ((x / N) * 100).toFixed(1)
  const out: HazardItem[] = []
  out.push({ level: slide / N > 0.1 ? 'high' : slide / N > 0.02 ? 'watch' : 'info', text: `Landslide-susceptible terrain (heuristic index > 0.6): ${pct(slide)}% of area; slopes > 30°: ${pct(steep)}%, > 45°: ${pct(vsteep)}%.` })
  out.push({ level: flood / N > 0.2 ? 'high' : flood / N > 0.05 ? 'watch' : 'info', text: `Flood-prone low/flat ground (heuristic index > 0.7): ${pct(flood)}% of area.` })
  out.push({ level: 'info', text: `Max slope ${a.stats.maxSlope.toFixed(0)}° at row ${a.stats.steepest.row}, col ${a.stats.steepest.col}.` })
  return out
}

export function terrainSummaryForLLM(t: TerrainData, a: TerrainAnalysis) {
  const pt = (p: { row: number; col: number }) => {
    const c = cellInfo(t, a, p.row, p.col)
    return { latitude: +c.lat.toFixed(5), longitude: +c.lon.toFixed(5), elevation_m: +c.elev.toFixed(1), slope_deg: +c.slope.toFixed(1) }
  }
  return { pt }
}
