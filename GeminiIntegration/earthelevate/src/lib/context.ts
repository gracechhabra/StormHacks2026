import { simRuntime, useStore } from '../store/useStore'
import { cellInfo, deriveHazards } from './analysis'
import { locateMask } from './highlights'
import { terrainBounds } from './geo'
import { useLiveStore } from '../store/useLiveStore'
import type { CellInfo } from '../types'

const r = (v: number, d = 1) => +v.toFixed(d)
const cell = (c: CellInfo) => ({
  row: c.row, col: c.col, latitude: r(c.lat, 5), longitude: r(c.lon, 5), elevation_m: r(c.elev), slope_deg: r(c.slope),
  aspect: c.aspectName, terrain_type: c.terrainType, land_cover: c.landCover,
  flood_susceptibility_0_1: r(c.floodRisk, 2), landslide_susceptibility_0_1: r(c.landslideRisk, 2),
})

/** Snapshot of everything the user is currently looking at, sent to Gemini with every request. */
export function buildContext() {
  const s = useStore.getState()
  const { terrain: t, analysis: a } = s
  if (!t || !a) return { terrain_loaded: false }
  const n = t.size
  const fl = new Uint8Array(n * n), st = new Uint8Array(n * n)
  for (let i = 0; i < n * n; i++) { fl[i] = a.floodRisk[i] > 0.7 ? 1 : 0; st[i] = a.slope[i] >= 30 ? 1 : 0 }
  const at = (p: { row: number; col: number }) => cell(cellInfo(t, a, p.row, p.col))
  const b = terrainBounds(t)
  return {
    terrain_loaded: true,
    dataset: { name: t.label, source: t.source, centre: { latitude: t.lat, longitude: t.lon }, bounds: b, grid: `${n}x${n}`, metres_per_cell: t.mpp, span_km: r(a.stats.spanKm, 2), row0_is: 'north', col0_is: 'west' },
    statistics: { min_elevation_m: r(a.stats.min), max_elevation_m: r(a.stats.max), mean_elevation_m: r(a.stats.mean), elevation_range_m: r(a.stats.range), mean_slope_deg: r(a.stats.meanSlope), max_slope_deg: r(a.stats.maxSlope) },
    highest_point: at(a.stats.highest), lowest_point: at(a.stats.lowest), steepest_point: at(a.stats.steepest),
    selected_point: s.selected ? cell(s.selected) : null,
    flood_prone_area: { definition: 'heuristic flood susceptibility index > 0.7', ...locateMask(t, fl, a) },
    steep_area: { definition: 'slope >= 30 degrees', ...locateMask(t, st, a) },
    hazards: deriveHazards(t, a).map((h) => h.text),
    view: {
      mode: s.viewMode, base_layer: s.baseLayer, contours: s.contours, vertical_exaggeration: s.exaggeration,
      highlight: s.highlight ? { label: s.highlight.label, percent_of_terrain: r(s.highlight.percent) } : null,
      cross_section: s.crossSection?.label ?? null,
    },
    simulation: { status: s.simStatus, parameters: s.simParams, live_stats: simRuntime.current ? s.simStats : null, note: 'Visualization only, not a certified prediction.' },
    land_cover_from_fpga_world: t.fpgaMatch,
    live_location: liveContext(),
  }
}

function liveContext() {
  const { live, status, error, label } = useLiveStore.getState()
  if (!live) return { ok: false, status, error }
  const now = new Date(Date.now() + live.utc_offset_seconds * 1000)
  return {
    ok: true, source: live.source, applies_to: label, latitude: live.latitude, longitude: live.longitude,
    elevation_m_open_meteo: live.elevation_m, timezone: live.timezone, utc_offset_hours: live.utc_offset_seconds / 3600,
    local_datetime_now: now.toISOString().slice(0, 19).replace('T', ' '), temperature_c: live.temperature_c,
    weather: live.weather, is_daytime: live.is_day, observation_local_time: live.local_time,
  }
}
