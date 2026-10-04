import { create } from 'zustand'
import type {
  BaseLayer, CameraRequest, CellInfo, CrossSection, FpgaStatus, Highlight, ImageryKind, SimParams, SimStats, SimStatus,
  TerrainAnalysis, TerrainData, TerrainSummary, ViewMode,
} from '../types'
import { analyzeTerrain, cellInfo } from '../lib/analysis'
import { clamp, latLonToCell, terrainBounds } from '../lib/geo'
import { createSimulation, type Simulation } from '../lib/simulation'
import { fetchTerrain, fetchTerrains, generateTerrain } from '../services/api'
import { loadImagery } from '../services/imagery'

/** The live simulation object is mutable and updated per-frame, so it lives outside React state. */
export const simRuntime = { current: null as Simulation | null }

interface SatelliteState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  kind: ImageryKind
  canvas: HTMLCanvasElement | null
  cells: Float32Array | null
  error: string | null
  forKey: string | null
}

export interface AppState {
  terrain: TerrainData | null
  analysis: TerrainAnalysis | null
  terrains: TerrainSummary[]
  loading: string | null
  error: string | null

  selected: CellInfo | null
  hover: CellInfo | null
  baseLayer: BaseLayer
  contours: boolean
  viewMode: ViewMode
  imagery: ImageryKind
  exaggeration: number
  highlight: Highlight | null
  crossSection: CrossSection | null
  sectionPicking: { a: { row: number; col: number } | null } | null
  profileHover: number | null

  simParams: SimParams
  simStatus: SimStatus
  simStats: SimStats | null

  camera: CameraRequest | null
  burst: number
  fpga: FpgaStatus | null
  satellite: SatelliteState
  toast: { id: number; text: string } | null
  leftOpen: boolean
  rightOpen: boolean

  init: () => Promise<void>
  loadTerrain: (key: string, opts?: { silent?: boolean }) => Promise<void>
  selectCell: (row: number, col: number) => CellInfo | null
  setHover: (c: CellInfo | null) => void
  setBaseLayer: (l: BaseLayer) => void
  toggleContours: (v?: boolean) => void
  setViewMode: (m: ViewMode) => void
  setImagery: (k: ImageryKind) => void
  setExaggeration: (v: number) => void
  setHighlight: (h: Highlight | null) => void
  setCrossSection: (s: CrossSection | null) => void
  setSectionPicking: (p: { a: { row: number; col: number } | null } | null) => void
  setProfileHover: (f: number | null) => void
  setSimParams: (p: Partial<SimParams>) => void
  startSim: (p?: Partial<SimParams>) => void
  pauseSim: () => void
  resumeSim: () => void
  stopSim: () => void
  setSimStats: (s: SimStats, done: boolean) => void
  flyTo: (r: Omit<CameraRequest, 'id'>) => void
  overview: () => void
  flyToCell: (row: number, col: number, radius?: number) => void
  showToast: (text: string) => void
  setFpga: (f: FpgaStatus | null) => void
  loadImagery: () => Promise<void>
  togglePanel: (side: 'left' | 'right') => void
}

let camId = 1
let toastId = 1

export const vsOf = (t: TerrainData, exag: number) => exag / t.mpp

export function cellScenePos(t: TerrainData, a: TerrainAnalysis, exag: number, row: number, col: number): [number, number, number] {
  const n = t.size
  return [col - (n - 1) / 2, (t.elev[row * n + col] - a.stats.min) * vsOf(t, exag), row - (n - 1) / 2]
}

export const useStore = create<AppState>((set, get) => ({
  terrain: null, analysis: null, terrains: [], loading: null, error: null,
  selected: null, hover: null,
  baseLayer: 'elevation', contours: true, viewMode: 'surface', imagery: 'satellite', exaggeration: 1,
  highlight: null, crossSection: null, sectionPicking: null, profileHover: null,
  simParams: { kind: 'flood', rainfallMm: 100, waterLevelM: null, mode: 'rainfall' },
  simStatus: 'idle', simStats: null,
  camera: null, burst: 0, fpga: null,
  satellite: { status: 'idle', kind: 'satellite', canvas: null, cells: null, error: null, forKey: null },
  toast: null, leftOpen: true, rightOpen: true,

  init: async () => {
    try {
      const terrains = await fetchTerrains()
      set({ terrains })
      // Arriving from the world generator: ?lat=..&lon=..&label=.. shows that place.
      const q = new URLSearchParams(window.location.search)
      const lat = parseFloat(q.get('lat') ?? ''), lon = parseFloat(q.get('lon') ?? '')
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        window.history.replaceState(null, '', window.location.pathname)
        const label = q.get('label') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`
        set({ loading: `Downloading real DEM for ${label}…` })
        const g = await generateTerrain({ label, lat, lon })
        if (g.ok && g.key) { await get().loadTerrain(g.key, { silent: true }); return }
        set({ loading: null, error: g.error || 'DEM unavailable for this location' })
        return
      }
      if (terrains.length) {
        // Prefer the terrain currently exported to the FPGA, i.e. the first one that has a matching world.
        await get().loadTerrain(terrains[0].key, { silent: true })
      } else set({ error: 'No DEM datasets found. Search for a location to download one.' })
    } catch (e) {
      set({ error: `Cannot reach the Terra AI backend: ${(e as Error).message}. Start it with: venv/bin/python earthelevate_server.py` })
    }
  },

  loadTerrain: async (key, opts) => {
    set({ loading: `Loading DEM ${key}…`, error: null })
    try {
      const t = await fetchTerrain(key)
      const a = analyzeTerrain(t)
      simRuntime.current = null
      const relief = (a.stats.range / t.mpp)
      const exag = Math.round(clamp(30 / Math.max(relief, 1), 1, 6) * 10) / 10
      set({
        terrain: t, analysis: a, loading: null, selected: null, hover: null, highlight: null, crossSection: null,
        sectionPicking: null, profileHover: null, simStatus: 'idle', simStats: null, exaggeration: exag,
        burst: get().burst + 1,
        simParams: { ...get().simParams, waterLevelM: Math.round(a.stats.min + a.stats.range * 0.25) },
        satellite: { status: 'idle', kind: get().imagery, canvas: null, cells: null, error: null, forKey: null },
      })
      get().overview()
      if (get().baseLayer === 'satellite') void get().loadImagery()
      if (!opts?.silent) get().showToast(`Loaded ${t.label}`)
      if (!get().terrains.some((x) => x.key === key)) set({ terrains: await fetchTerrains() })
    } catch (e) {
      set({ loading: null, error: (e as Error).message })
    }
  },

  selectCell: (row, col) => {
    const { terrain: t, analysis: a } = get()
    if (!t || !a) return null
    const info = cellInfo(t, a, row, col)
    set({ selected: info })
    return info
  },
  setHover: (c) => set({ hover: c }),

  setBaseLayer: (l) => {
    set({ baseLayer: l, burst: get().burst + 1 })
    if (l === 'satellite') {
      const s = get().satellite
      if (s.status === 'idle' || (s.status === 'error') || s.kind !== get().imagery) void get().loadImagery()
    }
  },
  toggleContours: (v) => set({ contours: v ?? !get().contours }),
  setViewMode: (m) => set({ viewMode: m, burst: get().burst + 1 }),
  setImagery: (k) => {
    set({ imagery: k })
    if (get().baseLayer === 'satellite') void get().loadImagery()
  },
  setExaggeration: (v) => set({ exaggeration: clamp(v, 0.5, 8) }),
  setHighlight: (h) => set({ highlight: h }),
  setCrossSection: (s) => set({ crossSection: s, sectionPicking: null }),
  setSectionPicking: (p) => set({ sectionPicking: p }),
  setProfileHover: (f) => set({ profileHover: f }),

  setSimParams: (p) => set({ simParams: { ...get().simParams, ...p } }),
  startSim: (p) => {
    const { terrain: t, analysis: a } = get()
    if (!t || !a) return
    const params = { ...get().simParams, ...p }
    if (params.kind === 'flood' && params.waterLevelM != null && params.mode === 'level') {
      params.waterLevelM = clamp(params.waterLevelM, a.stats.min, a.stats.max + 50)
    }
    simRuntime.current = createSimulation(t, a, params)
    set({ simParams: params, simStatus: 'running', simStats: simRuntime.current.stats(), burst: get().burst + 1 })
  },
  pauseSim: () => { if (simRuntime.current && get().simStatus === 'running') set({ simStatus: 'paused' }) },
  resumeSim: () => { if (simRuntime.current && get().simStatus === 'paused') set({ simStatus: 'running' }) },
  stopSim: () => { simRuntime.current = null; set({ simStatus: 'idle', simStats: null }) },
  setSimStats: (s, done) => set({ simStats: s, simStatus: done ? 'done' : get().simStatus }),

  flyTo: (r) => set({ camera: { ...r, id: camId++ } }),
  overview: () => {
    const { terrain: t, analysis: a, exaggeration } = get()
    if (!t || !a) return
    const relief = a.stats.range * vsOf(t, exaggeration)
    get().flyTo({ target: [0, relief * 0.3, 0], radius: t.size * 1.15, azimuth: 0.35, polar: 1.0, duration: 2.2 })
  },
  flyToCell: (row, col, radius) => {
    const { terrain: t, analysis: a, exaggeration } = get()
    if (!t || !a) return
    get().flyTo({ target: cellScenePos(t, a, exaggeration, row, col), radius: radius ?? t.size * 0.38, polar: 0.95, duration: 1.8 })
  },

  showToast: (text) => {
    const id = toastId++
    set({ toast: { id, text } })
    setTimeout(() => { if (get().toast?.id === id) set({ toast: null }) }, 3200)
  },
  setFpga: (f) => set({ fpga: f }),

  loadImagery: async () => {
    const { terrain: t, imagery } = get()
    if (!t) return
    set({ satellite: { status: 'loading', kind: imagery, canvas: null, cells: null, error: null, forKey: t.key } })
    try {
      const r = await loadImagery(terrainBounds(t), imagery, t.size)
      if (get().terrain?.key !== t.key) return
      set({ satellite: { status: 'ready', kind: imagery, canvas: r.canvas, cells: r.cells, error: null, forKey: t.key } })
    } catch (e) {
      if (get().terrain?.key !== t.key) return
      set({ satellite: { status: 'error', kind: imagery, canvas: null, cells: null, error: (e as Error).message, forKey: t.key } })
      get().showToast('Imagery tiles unavailable — showing derived relief colours')
    }
  },
  togglePanel: (side) => set(side === 'left' ? { leftOpen: !get().leftOpen } : { rightOpen: !get().rightOpen }),
}))

export { latLonToCell }
