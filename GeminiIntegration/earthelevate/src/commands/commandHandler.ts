import { useStore } from '../store/useStore'
import { cellInfo } from '../lib/analysis'
import { byElevation, byExtreme } from '../lib/highlights'
import { cellToLatLon, clamp, latLonToCell, terrainBounds } from '../lib/geo'
import { searchPlaces } from '../services/api'
import type { BaseLayer, CellInfo } from '../types'

type Args = Record<string, any>
export interface CommandResult { ok: boolean; summary: string; data: Record<string, unknown> }

const AZ: Record<string, number> = { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 }
const r = (v: number, d = 1) => +v.toFixed(d)
const fail = (summary: string): CommandResult => ({ ok: false, summary, data: { error: summary } })
const ok = (summary: string, data: Record<string, unknown> = {}): CommandResult => ({ ok: true, summary, data: { status: 'done', ...data } })

const brief = (c: CellInfo) => ({ latitude: r(c.lat, 5), longitude: r(c.lon, 5), elevation_m: r(c.elev), slope_deg: r(c.slope), terrain_type: c.terrainType })

function pick(row: number, col: number, fly = true) {
  const s = useStore.getState()
  const c = s.selectCell(row, col)
  if (c && fly) s.flyToCell(row, col)
  return c
}

/** Executes a Gemini function call against the frontend store. Always returns a structured result for the model. */
export async function runCommand(name: string, args: Args): Promise<CommandResult> {
  const s = useStore.getState()
  const { terrain: t, analysis: a } = s
  if (!t || !a) return fail('No terrain is loaded yet.')

  switch (name) {
    case 'set_layer': {
      const layer = String(args.layer)
      const enabled = args.enabled !== false
      if (layer === 'contours') { s.toggleContours(enabled); return ok(`Contours ${enabled ? 'on' : 'off'}`) }
      if (layer === 'voxel') { s.setViewMode(enabled ? 'voxel' : 'surface'); return ok(enabled ? 'Voxel view on' : 'Smooth surface view') }
      if (!['elevation', 'slope', 'flood_risk', 'landslide_risk', 'satellite'].includes(layer)) return fail(`Unknown layer "${layer}"`)
      s.setBaseLayer(enabled ? (layer as BaseLayer) : 'elevation')
      return ok(`Layer: ${enabled ? layer : 'elevation'}`)
    }
    case 'highlight_elevation_range': {
      const min = typeof args.min_m === 'number' ? args.min_m : undefined
      const max = typeof args.max_m === 'number' ? args.max_m : undefined
      if (min == null && max == null) return fail('Provide min_m and/or max_m.')
      const h = byElevation(t, min, max)
      s.setHighlight(h)
      return ok(`Highlighted ${h.label} (${h.percent.toFixed(1)}%)`, { cells_highlighted: h.count, percent_of_terrain: r(h.percent), terrain_min_m: r(a.stats.min), terrain_max_m: r(a.stats.max) })
    }
    case 'highlight_extreme': {
      const f = args.feature as 'highest' | 'lowest' | 'steepest'
      if (!['highest', 'lowest', 'steepest'].includes(f)) return fail('feature must be highest, lowest or steepest')
      const h = byExtreme(t, a, f, clamp(Number(args.percent) || 8, 1, 50))
      s.setHighlight(h)
      return ok(`Highlighted ${h.label}`, { percent_of_terrain: r(h.percent) })
    }
    case 'clear_highlights':
      s.setHighlight(null); s.setCrossSection(null); useStore.setState({ selected: null })
      return ok('Overlays cleared')
    case 'focus_on': {
      const st = a.stats
      const target = String(args.target)
      const p = target === 'highest_point' ? st.highest : target === 'lowest_point' ? st.lowest : target === 'steepest_slope' ? st.steepest
        : target === 'center' ? { row: (t.size - 1) >> 1, col: (t.size - 1) >> 1 } : s.selected ? { row: s.selected.row, col: s.selected.col } : null
      if (!p) return fail('No point is selected.')
      const c = pick(p.row, p.col)
      return c ? ok(`Focused on ${target.replace('_', ' ')}`, brief(c)) : fail('Could not select point')
    }
    case 'select_point': {
      const lat = Number(args.latitude), lon = Number(args.longitude)
      const b = terrainBounds(t)
      if (!(lat <= b.north && lat >= b.south && lon >= b.west && lon <= b.east)) return fail(`Point is outside the loaded terrain (lat ${b.south.toFixed(4)}..${b.north.toFixed(4)}, lon ${b.west.toFixed(4)}..${b.east.toFixed(4)}).`)
      const cellRef = latLonToCell(t, lat, lon)
      if (!cellRef) return fail('Point is outside the loaded terrain.')
      const c = pick(cellRef.row, cellRef.col)
      return c ? ok('Point selected', brief(c)) : fail('Could not select point')
    }
    case 'rotate_camera': {
      const d = String(args.direction)
      if (d in AZ) { s.flyTo({ azimuth: AZ[d], duration: 1.6 }); return ok(`Rotated to look ${d}`) }
      const deg = Number(args.degrees) || 45
      s.flyTo({ azimuthDelta: ((d === 'left' ? 1 : -1) * deg * Math.PI) / 180, duration: 1.4 })
      return ok(`Orbited ${d} ${deg}°`)
    }
    case 'zoom': {
      const act = String(args.action), f = Number(args.factor) || 1.6
      if (act === 'in') s.flyTo({ radiusFactor: 1 / f, duration: 1.1 })
      else if (act === 'out') s.flyTo({ radiusFactor: f, duration: 1.1 })
      else if (act === 'reset') s.overview()
      else if (act === 'mountain') { const h = a.stats.highest; pick(h.row, h.col, false); s.flyToCell(h.row, h.col, t.size * 0.22) }
      else if (act === 'selected_point') { if (!s.selected) return fail('No point is selected.'); s.flyToCell(s.selected.row, s.selected.col, t.size * 0.2) }
      else return fail(`Unknown zoom action "${act}"`)
      return ok(`Zoom ${act}`, act === 'mountain' ? brief(cellInfo(t, a, a.stats.highest.row, a.stats.highest.col)) : {})
    }
    case 'set_view_mode':
      s.setViewMode(args.mode === 'voxel' ? 'voxel' : 'surface')
      return ok(`View: ${args.mode}`)
    case 'start_simulation': {
      const kind = args.type === 'landslide' ? 'landslide' : 'flood'
      const rain = typeof args.rainfall_mm === 'number' ? clamp(args.rainfall_mm, 1, 1000) : undefined
      const lvl = typeof args.water_level_m === 'number' ? args.water_level_m : undefined
      s.startSim({ kind, rainfallMm: rain ?? s.simParams.rainfallMm, waterLevelM: lvl ?? s.simParams.waterLevelM, mode: kind === 'flood' && lvl != null && rain == null ? 'level' : 'rainfall' })
      if (kind === 'flood') s.setBaseLayer(s.baseLayer)
      return ok(`${kind} visualization started`, { parameters: useStore.getState().simParams, disclaimer: 'Illustrative DEM-based visualization, not a certified prediction.' })
    }
    case 'stop_simulation': s.stopSim(); return ok('Simulation stopped')
    case 'show_cross_section': {
      const n = t.size, m = n - 1
      const pos = clamp(Number(args.position_percent ?? 50), 0, 100) / 100
      const o = String(args.orientation)
      let sec
      if (o === 'east_west') { const y = Math.round(pos * m); sec = { a: { row: y, col: 0 }, b: { row: y, col: m }, label: `West→East at ${Math.round(pos * 100)}% from north` } }
      else if (o === 'north_south') { const x = Math.round(pos * m); sec = { a: { row: 0, col: x }, b: { row: m, col: x }, label: `North→South at ${Math.round(pos * 100)}% from west` } }
      else if (o === 'through_selected') {
        if (!s.selected) return fail('No point is selected.')
        sec = { a: { row: s.selected.row, col: 0 }, b: { row: s.selected.row, col: m }, label: 'West→East through selected point' }
      } else if (o === 'highest_to_lowest') sec = { a: { ...a.stats.highest }, b: { ...a.stats.lowest }, label: 'Highest → lowest point' }
      else return fail(`Unknown orientation "${o}"`)
      s.setCrossSection(sec)
      return ok(`Cross-section: ${sec.label}`)
    }
    case 'set_vertical_exaggeration': {
      const v = clamp(Number(args.value) || 1, 0.5, 6)
      s.setExaggeration(v)
      return ok(`Vertical exaggeration ×${v}`)
    }
    case 'search_location': {
      const q = String(args.query || '')
      const res = await searchPlaces(q).catch((e) => ({ results: [], error: String(e.message) }))
      const hit = res.results[0]
      if (!hit) return fail(res.error || `No place found for "${q}".`)
      if (hit.cached_key) {
        await s.loadTerrain(hit.cached_key)
        return ok(`Moved to ${hit.label}`, { location: hit.label, latitude: hit.lat, longitude: hit.lon })
      }
      return { ok: false, summary: `No DEM loaded for ${hit.label}`, data: { error: `No elevation dataset has been downloaded for ${hit.label} (${hit.lat.toFixed(4)}, ${hit.lon.toFixed(4)}). Tell the user to use the search bar and press "Download DEM" for this place.` } }
    }
    default:
      return fail(`Unknown command "${name}"`)
  }
}

export { cellToLatLon }
