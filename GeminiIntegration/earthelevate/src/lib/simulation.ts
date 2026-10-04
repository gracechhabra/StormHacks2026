import type { SimParams, SimStats, TerrainAnalysis, TerrainData } from '../types'
import { clamp, compassName, easeInOut } from './geo'

/**
 * Illustrative disaster visualisations driven only by the DEM (elevation + slope).
 * They are NOT hydrological / geotechnical models and must never be presented as certified predictions.
 */
export interface Simulation {
  kind: 'flood' | 'landslide'
  depth: Float32Array | null
  affected: Float32Array | null
  source: Uint8Array | null
  particles: Float32Array // [col,row] pairs in cell coordinates
  particleCount: number
  done: boolean
  progress: number
  version: number
  update(dt: number): void
  stats(): SimStats
}

const DX = [-1, 0, 1, -1, 1, -1, 0, 1]
const DY = [-1, -1, -1, 0, 0, 1, 1, 1]
const DIST = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2]
const RUNOFF = 0.7
const MAX_PARTICLES = 1400

function hash(i: number) {
  let x = (i + 1) * 2654435761
  x ^= x >>> 13; x = Math.imul(x, 1274126177); x ^= x >>> 16
  return (x >>> 0) / 4294967295
}

class FloodSim implements Simulation {
  kind = 'flood' as const
  depth: Float32Array
  affected = null
  source = null
  particles = new Float32Array(MAX_PARTICLES * 2)
  particleCount = 0
  done = false
  progress = 0
  version = 0
  private water: Float32Array
  private delta: Float32Array
  private elapsed = 0
  private iter = 0
  private acc = 0
  private level: number
  private vx = 0
  private vz = 0
  private ages = new Float32Array(MAX_PARTICLES)
  private readonly totalIters = 700
  private readonly rainIters = 320
  private readonly levelDuration = 9

  constructor(private t: TerrainData, private a: TerrainAnalysis, private p: SimParams) {
    const N = t.size * t.size
    this.depth = new Float32Array(N)
    this.water = new Float32Array(N)
    this.delta = new Float32Array(N)
    this.level = a.stats.min
    this.particleCount = MAX_PARTICLES
    for (let i = 0; i < MAX_PARTICLES; i++) this.ages[i] = -1
  }

  update(dt: number) {
    if (this.done) { this.moveParticles(dt); return }
    this.elapsed += dt
    if (this.p.mode === 'level' && this.p.waterLevelM != null) this.stepLevel()
    else this.stepRain(dt)
    this.moveParticles(dt)
    this.version++
  }

  private stepLevel() {
    const { a, t } = this
    const target = this.p.waterLevelM!
    const prog = clamp(this.elapsed / this.levelDuration, 0, 1)
    this.progress = prog
    this.level = a.stats.min + (target - a.stats.min) * easeInOut(prog)
    const n = t.size * t.size
    for (let i = 0; i < n; i++) {
      this.depth[i] = a.floodNeed[i] <= this.level ? Math.max(0, this.level - t.elev[i]) : 0
    }
    if (prog >= 1) this.done = true
  }

  private stepRain(dt: number) {
    const { t } = this
    this.acc += dt * 36
    let steps = Math.min(8, Math.floor(this.acc))
    this.acc -= steps
    const n = t.size
    const h = t.elev, w = this.water, d = this.delta
    const perIter = ((this.p.rainfallMm / 1000) * RUNOFF) / this.rainIters
    while (steps-- > 0 && this.iter < this.totalIters) {
      if (this.iter < this.rainIters) for (let i = 0; i < w.length; i++) w[i] += perIter
      d.fill(0)
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const i = r * n + c
        const wi = w[i]
        if (wi < 1e-5) continue
        const s = h[i] + wi
        let total = 0, maxDrop = 0
        const drops = this.dropsBuf
        for (let k = 0; k < 8; k++) {
          const rr = r + DY[k], cc = c + DX[k]
          if (rr < 0 || cc < 0 || rr >= n || cc >= n) { drops[k] = 0; continue }
          const j = rr * n + cc
          const raw = Math.max(0, s - (h[j] + w[j]))
          const dr = raw / DIST[k]
          drops[k] = dr; total += dr; if (raw > maxDrop) maxDrop = raw
        }
        let move = 0
        if (total > 0) {
          move = Math.min(wi, 0.5 * maxDrop)
          for (let k = 0; k < 8; k++) if (drops[k] > 0) d[(r + DY[k]) * n + (c + DX[k])] += (move * drops[k]) / total
          d[i] -= move
        }
        if (r === 0 || c === 0 || r === n - 1 || c === n - 1) d[i] -= Math.min(wi - move, wi * 0.5) // drains off the edge of the tile
      }
      for (let i = 0; i < w.length; i++) w[i] = Math.max(0, w[i] + d[i])
      this.iter++
    }
    this.progress = this.iter / this.totalIters
    for (let i = 0; i < w.length; i++) this.depth[i] = w[i]
    if (this.iter >= this.totalIters) this.done = true
  }
  private dropsBuf = new Float32Array(8)

  private spawn(i: number): boolean {
    const n = this.t.size
    for (let tries = 0; tries < 25; tries++) {
      const cell = Math.floor(Math.random() * n * n)
      if (this.depth[cell] > 0.01) {
        this.particles[i * 2] = (cell % n) + Math.random()
        this.particles[i * 2 + 1] = ((cell / n) | 0) + Math.random()
        this.ages[i] = 0
        return true
      }
    }
    this.ages[i] = -1
    return false
  }

  private moveParticles(dt: number) {
    const n = this.t.size
    const { a, depth } = this
    let sx = 0, sz = 0, cnt = 0
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.ages[i] < 0 || this.ages[i] > 6) { if (!this.spawn(i)) { this.particles[i * 2] = -999; continue } }
      const x = this.particles[i * 2], z = this.particles[i * 2 + 1]
      const c = clamp(Math.floor(x), 0, n - 1), r = clamp(Math.floor(z), 0, n - 1)
      const cell = r * n + c
      if (depth[cell] < 0.005) { this.ages[i] = -1; continue }
      let tx = 0, tz = 0
      if (this.p.mode === 'level') {
        // direction of the advancing inundation: uphill along the connected-flood-level gradient
        let best = a.floodNeed[cell], bk = -1
        for (let k = 0; k < 8; k++) {
          const rr = r + DY[k], cc = c + DX[k]
          if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue
          const v = a.floodNeed[rr * n + cc]
          if (v > best && depth[rr * n + cc] > 0.005) { best = v; bk = k }
        }
        if (bk >= 0) { tx = DX[bk]; tz = DY[bk] }
      } else {
        const dn = a.downhill[cell]
        if (dn >= 0) { tx = (dn % n) - c; tz = ((dn / n) | 0) - r }
      }
      const sp = 5 * (0.7 + 0.6 * ((i * 37) % 10) / 10)
      const mx = tx * sp * dt + (Math.random() - 0.5) * 0.4 * dt
      const mz = tz * sp * dt + (Math.random() - 0.5) * 0.4 * dt
      this.particles[i * 2] = clamp(x + mx, 0, n - 0.01)
      this.particles[i * 2 + 1] = clamp(z + mz, 0, n - 0.01)
      this.ages[i] += dt
      sx += tx; sz += tz; cnt++
    }
    if (cnt > 0) { this.vx = this.vx * 0.9 + (sx / cnt) * 0.1; this.vz = this.vz * 0.9 + (sz / cnt) * 0.1 }
  }

  stats(): SimStats {
    const { t, a, depth } = this
    const N = t.size * t.size
    let wet = 0, sum = 0, max = 0, vul = 0, vulWet = 0
    for (let i = 0; i < N; i++) {
      const dpt = depth[i]
      if (a.floodRisk[i] > 0.7) vul++
      if (dpt > 0.01) { wet++; sum += dpt; if (dpt > max) max = dpt; if (a.floodRisk[i] > 0.7) vulWet++ }
    }
    const deg = ((Math.atan2(this.vx, -this.vz) * 180) / Math.PI + 360) % 360
    const moving = Math.hypot(this.vx, this.vz) > 0.05
    return {
      kind: 'flood', progress: this.progress,
      wetPercent: (wet / N) * 100, maxDepthM: max, meanDepthM: wet ? sum / wet : 0,
      volumeM3: sum * t.mpp * t.mpp,
      currentLevelM: this.p.mode === 'level' ? this.level : undefined,
      flowDirection: moving ? (this.p.mode === 'level' ? `spreading toward ${compassName(deg)}` : `draining toward ${compassName(deg)}`) : '—',
      flowDegrees: moving ? deg : undefined,
      vulnerableLowAreaPercent: vul ? (vulWet / vul) * 100 : 0,
    }
  }
}

interface Parcel { cell: number; energy: number; alive: boolean; start: number; dist: number; origin: number; steps: number }

class LandslideSim implements Simulation {
  kind = 'landslide' as const
  depth = null
  affected: Float32Array
  source: Uint8Array
  particles = new Float32Array(MAX_PARTICLES * 2)
  particleCount = 0
  done = false
  progress = 0
  version = 0
  private parcels: Parcel[] = []
  private clock = 0
  private tick = 0
  private threshold: number
  private maxRunout = 0
  private vx = 0
  private vz = 0
  private readonly MU = Math.tan((11 * Math.PI) / 180)

  constructor(private t: TerrainData, private a: TerrainAnalysis, p: SimParams) {
    const N = t.size * t.size
    this.affected = new Float32Array(N)
    this.source = new Uint8Array(N)
    this.threshold = clamp(42 - 0.1 * p.rainfallMm, 24, 42)
    const candidates: number[] = []
    for (let i = 0; i < N; i++) if (a.slope[i] >= this.threshold && a.landslideRisk[i] > 0.3 && a.downhill[i] >= 0) candidates.push(i)
    const cap = 420
    const stride = Math.max(1, Math.ceil(candidates.length / cap))
    for (const i of candidates) {
      if (hash(i) < 1 / stride) {
        this.source[i] = 1
        this.parcels.push({ cell: i, energy: 0, alive: true, start: hash(i + 7) * 3.5, dist: 0, origin: i, steps: 0 })
      }
    }
    if (!this.parcels.length) this.done = true
    this.particleCount = this.parcels.length
  }

  update(dt: number) {
    if (this.done) return
    this.clock += dt
    this.tick += dt
    const n = this.t.size
    const { t, a } = this
    while (this.tick >= 0.07) {
      this.tick -= 0.07
      let alive = 0, finished = 0
      for (const p of this.parcels) {
        if (!p.alive) { finished++; continue }
        alive++
        if (this.clock < p.start) continue
        const dn = a.downhill[p.cell]
        if (dn < 0) { p.alive = false; continue }
        const r = (p.cell / n) | 0, c = p.cell % n, r2 = (dn / n) | 0, c2 = dn % n
        const dxy = Math.hypot(c2 - c, r2 - r) * t.mpp
        const drop = t.elev[p.cell] - t.elev[dn]
        p.energy += drop - this.MU * dxy // energy-line (Fahrböschung) criterion: stops when drop < mu * distance
        p.dist += dxy
        p.steps++
        this.vx += (c2 - c) * 0.01; this.vz += (r2 - r) * 0.01
        if (p.energy <= -2 || p.steps > 160) { p.alive = false; this.affected[dn] = Math.min(1, this.affected[dn] + 0.6); continue }
        p.cell = dn
        this.affected[dn] = Math.min(1, this.affected[dn] + 0.18)
        const od = Math.hypot((dn % n) - (p.origin % n), ((dn / n) | 0) - ((p.origin / n) | 0)) * t.mpp
        if (od > this.maxRunout) this.maxRunout = od
      }
      this.progress = this.parcels.length ? finished / this.parcels.length : 1
      if (alive === 0) { this.done = true; this.progress = 1; break }
    }
    let k = 0
    for (const p of this.parcels) {
      if (!p.alive || this.clock < p.start) continue
      this.particles[k * 2] = (p.cell % n) + 0.5
      this.particles[k * 2 + 1] = ((p.cell / n) | 0) + 0.5
      k++
    }
    this.particleCount = k
    this.version++
  }

  stats(): SimStats {
    const N = this.t.size * this.t.size
    let src = 0, aff = 0
    for (let i = 0; i < N; i++) { if (this.source[i]) src++; if (this.affected[i] > 0.05) aff++ }
    const mag = Math.hypot(this.vx, this.vz)
    const deg = ((Math.atan2(this.vx, -this.vz) * 180) / Math.PI + 360) % 360
    return {
      kind: 'landslide', progress: this.progress, sourceCells: src, affectedPercent: (aff / N) * 100,
      maxRunoutM: this.maxRunout, thresholdDeg: this.threshold,
      flowDirection: mag > 0.01 ? `moving toward ${compassName(deg)}` : '—', flowDegrees: mag > 0.01 ? deg : undefined,
      note: src === 0 ? `No cells exceed the ${this.threshold.toFixed(0)}° failure threshold at this rainfall, so no slide is initiated.` : undefined,
    }
  }
}

export function createSimulation(t: TerrainData, a: TerrainAnalysis, p: SimParams): Simulation {
  return p.kind === 'flood' ? new FloodSim(t, a, p) : new LandslideSim(t, a, p)
}
