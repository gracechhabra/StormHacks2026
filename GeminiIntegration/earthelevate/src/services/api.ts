import type { FpgaStatus, SearchResult, TerrainData, TerrainSummary } from '../types'

async function j<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((body as { error?: string }).error || `HTTP ${r.status}`)
  return body as T
}

export const fetchTerrains = () => fetch('/api/terrains').then((r) => j<{ terrains: TerrainSummary[] }>(r)).then((d) => d.terrains)

export async function fetchTerrain(key: string): Promise<TerrainData> {
  const d = await fetch(`/api/terrain/${encodeURIComponent(key)}`).then((r) => j<any>(r))
  return {
    key: d.key, label: d.label, lat: d.lat, lon: d.lon, mpp: d.mpp, size: d.size, source: d.source, weather: d.weather,
    elev: Float32Array.from(d.elev),
    blocks: d.blocks ? Uint8Array.from((d.blocks as number[][]).flat()) : null,
    blockTypes: d.block_types ?? null, blockColors: d.block_colors ?? null, fpgaMatch: !!d.fpga_match,
  }
}

export const searchPlaces = (q: string) =>
  fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => j<{ results: SearchResult[]; error?: string }>(r))

export const generateTerrain = (body: { label: string; lat: number; lon: number; mpp?: number }) =>
  fetch('/api/terrain/generate', { method: 'POST', body: JSON.stringify(body) }).then((r) => j<{ ok: boolean; key?: string; error?: string }>(r))

export const fetchFpga = () => fetch('/api/fpga/status').then((r) => j<FpgaStatus>(r))
export const fetchHealth = () => fetch('/api/health').then((r) => j<{ ok: boolean; gemini_key_configured: boolean; model: string }>(r))
