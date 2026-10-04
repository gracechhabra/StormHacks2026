import type { Bounds, TerrainData } from '../types'

export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

export function compassName(deg: number): string {
  if (deg < 0) return 'flat'
  return COMPASS[Math.round(((deg % 360) / 22.5)) % 16]
}

export function terrainBounds(t: Pick<TerrainData, 'lat' | 'lon' | 'mpp' | 'size'>): Bounds {
  const spanM = t.mpp * t.size
  const dlat = spanM / 2 / 111320
  const dlon = spanM / 2 / (111320 * Math.max(0.15, Math.cos((t.lat * Math.PI) / 180)))
  return { north: t.lat + dlat, south: t.lat - dlat, west: t.lon - dlon, east: t.lon + dlon }
}

/** Centre-of-cell geographic coordinate. Row 0 is north, col 0 is west. */
export function cellToLatLon(t: Pick<TerrainData, 'lat' | 'lon' | 'mpp' | 'size'>, row: number, col: number) {
  const b = terrainBounds(t)
  const lat = b.north - ((row + 0.5) / t.size) * (b.north - b.south)
  const lon = b.west + ((col + 0.5) / t.size) * (b.east - b.west)
  return { lat, lon }
}

export function latLonToCell(t: Pick<TerrainData, 'lat' | 'lon' | 'mpp' | 'size'>, lat: number, lon: number) {
  const b = terrainBounds(t)
  const row = Math.floor(((b.north - lat) / (b.north - b.south)) * t.size)
  const col = Math.floor(((lon - b.west) / (b.east - b.west)) * t.size)
  if (row < 0 || col < 0 || row >= t.size || col >= t.size) return null
  return { row, col }
}

export function fmtLat(v: number) {
  return `${Math.abs(v).toFixed(5)}° ${v >= 0 ? 'N' : 'S'}`
}
export function fmtLon(v: number) {
  return `${Math.abs(v).toFixed(5)}° ${v >= 0 ? 'E' : 'W'}`
}
export function fmtM(v: number, digits = 0) {
  return `${v.toFixed(digits)} m`
}
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
