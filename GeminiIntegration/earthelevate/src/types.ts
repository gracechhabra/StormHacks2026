export type BaseLayer = 'elevation' | 'slope' | 'flood_risk' | 'landslide_risk' | 'satellite'
export type ViewMode = 'surface' | 'voxel'
export type ImageryKind = 'satellite' | 'map'
export type SimKind = 'flood' | 'landslide'
export type SimStatus = 'idle' | 'running' | 'paused' | 'done'

export interface TerrainData {
  key: string
  label: string
  lat: number
  lon: number
  mpp: number // metres per cell
  size: number // cells per side
  source: string
  weather?: Record<string, number | string> | null
  elev: Float32Array // row-major, row 0 = north, col 0 = west
  blocks: Uint8Array | null // FPGA land cover classes when the FPGA world matches
  blockTypes: Record<string, string> | null
  blockColors: Record<string, [number, number, number]> | null
  fpgaMatch: boolean
}

export interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

export interface TerrainStats {
  min: number
  max: number
  mean: number
  range: number
  meanSlope: number
  maxSlope: number
  spanKm: number
  highest: { row: number; col: number }
  lowest: { row: number; col: number }
  steepest: { row: number; col: number }
}

export interface TerrainAnalysis {
  size: number
  slope: Float32Array // degrees
  aspect: Float32Array // degrees clockwise from north, -1 when flat
  tpi: Float32Array // metres relative to local mean
  relElev: Float32Array // 0..1
  flowAcc: Float32Array // 0..1 (log scaled)
  downhill: Int32Array // D8 downhill neighbour index or -1
  floodRisk: Float32Array // 0..1 heuristic
  landslideRisk: Float32Array // 0..1 heuristic
  floodNeed: Float32Array // minimal connected water level (m) at which the cell floods
  terrainClass: Uint8Array
  stats: TerrainStats
  hist: number[]
}

export interface CellInfo {
  row: number
  col: number
  lat: number
  lon: number
  elev: number
  slope: number
  aspect: number
  aspectName: string
  terrainType: string
  landCover: string | null
  floodRisk: number
  landslideRisk: number
  relElev: number
  localMin: number
  localMax: number
  localMean: number
  localSlope: number
}

export interface Highlight {
  label: string
  mask: Uint8Array
  count: number
  percent: number
}

export interface CrossSection {
  a: { row: number; col: number }
  b: { row: number; col: number }
  label: string
}

export interface CameraRequest {
  id: number
  target?: [number, number, number]
  radius?: number
  radiusFactor?: number
  azimuth?: number // radians, 0 = camera south of target looking north
  azimuthDelta?: number
  polar?: number
  duration?: number
}

export interface SimParams {
  kind: SimKind
  rainfallMm: number
  waterLevelM: number | null
  mode: 'rainfall' | 'level'
}

export interface SimStats {
  kind: SimKind
  progress: number
  wetPercent?: number
  maxDepthM?: number
  meanDepthM?: number
  volumeM3?: number
  currentLevelM?: number
  flowDirection?: string
  flowDegrees?: number
  sourceCells?: number
  affectedPercent?: number
  maxRunoutM?: number
  thresholdDeg?: number
  vulnerableLowAreaPercent?: number
  note?: string
}

export interface ToolAction {
  name: string
  args: Record<string, unknown>
  ok: boolean
  summary: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  actions: ToolAction[]
  streaming?: boolean
  error?: string
  createdAt: number
}

export interface FpgaStatus {
  world_present: boolean
  label: string | null
  generated_utc: string | null
  grid: { size: number; meters_per_block: number; span_km: number; height_levels: number } | null
  block_counts: Record<string, number> | null
  bin_bytes: number | null
  frame_bytes: number | null
  frame_crc_ok: boolean | null
  artifacts: Record<string, boolean>
  board: { configured: boolean; host: string | null; reachable: boolean | null }
  fps: number | null
  fps_measured: boolean
}

export interface SearchResult {
  label: string
  lat: number
  lon: number
  country: string
  coords: boolean
  cached_key: string | null
}

export interface TerrainSummary {
  key: string
  label: string
  lat: number
  lon: number
  mpp: number
}
