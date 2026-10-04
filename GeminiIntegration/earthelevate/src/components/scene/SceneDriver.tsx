import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { simRuntime, useStore } from '../../store/useStore'
import { sceneState } from '../../lib/sceneState'
import { computeBaseColors, computeOverlay } from '../../lib/colorLayers'
import { sectionPath } from '../../lib/highlights'
import { clamp } from '../../lib/geo'

/** Headless component: owns the animated heights/colours/overlays that the meshes render. */
export function SceneDriver() {
  const terrain = useStore((s) => s.terrain)
  const analysis = useStore((s) => s.analysis)
  const baseLayer = useStore((s) => s.baseLayer)
  const satellite = useStore((s) => s.satellite)
  const highlight = useStore((s) => s.highlight)
  const crossSection = useStore((s) => s.crossSection)
  const simStatus = useStore((s) => s.simStatus)

  const tgtRel = useRef(new Float32Array(0))
  const tgtColor = useRef(new Float32Array(0))
  const tgtOverlay = useRef(new Float32Array(0))
  const fresh = useRef(true)
  const simVer = useRef(-1)
  const statsT = useRef(0)
  const fpsAcc = useRef({ t: 0, f: 0 })

  useEffect(() => {
    if (!terrain || !analysis) return
    const n = terrain.size, N = n * n
    const rel = new Float32Array(N)
    for (let i = 0; i < N; i++) rel[i] = terrain.elev[i] - analysis.stats.min
    tgtRel.current = rel
    fresh.current = sceneState.n !== n
    if (fresh.current) {
      sceneState.n = n
      sceneState.rel = new Float32Array(N) // new terrains rise from flat
      sceneState.color = new Float32Array(N * 3)
      sceneState.overlay = new Float32Array(N * 4)
      sceneState.vs = useStore.getState().exaggeration / terrain.mpp
    }
    tgtColor.current = new Float32Array(N * 3)
    tgtOverlay.current = new Float32Array(N * 4)
    sceneState.version++
  }, [terrain, analysis])

  const refreshOverlay = () => {
    const { terrain: t, highlight: h, crossSection: cs } = useStore.getState()
    if (!t || !tgtOverlay.current.length) return
    const sec = cs ? sectionPath(t, cs).mask : null
    computeOverlay(t.size * t.size, h, simRuntime.current, sec, tgtOverlay.current)
    if (fresh.current) sceneState.overlay.set(tgtOverlay.current)
  }

  useEffect(() => {
    if (!terrain || !analysis || !tgtColor.current.length) return
    const sat = baseLayer === 'satellite' && satellite.status === 'ready' && satellite.forKey === terrain.key ? satellite.cells : null
    sceneState.sat = sat
    computeBaseColors(terrain, analysis, baseLayer, sat, tgtColor.current)
    if (fresh.current) sceneState.color.set(tgtColor.current)
    sceneState.colorVersion++
  }, [terrain, analysis, baseLayer, satellite])

  useEffect(() => {
    refreshOverlay()
    simVer.current = -1
    sceneState.colorVersion++
    if (fresh.current) fresh.current = false
  }, [terrain, analysis, highlight, crossSection, simStatus])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const f = fpsAcc.current
    f.t += dtRaw; f.f++
    if (f.t >= 0.5) { sceneState.fps = f.f / f.t; f.t = 0; f.f = 0 }

    const st = useStore.getState()
    const t = st.terrain
    if (!t || !sceneState.n) return

    const kRel = 1 - Math.exp(-dt * 3.2)
    const rel = sceneState.rel, tr = tgtRel.current
    if (tr.length === rel.length) {
      let moved = false
      for (let i = 0; i < rel.length; i++) {
        const d = tr[i] - rel[i]
        if (d > 0.01 || d < -0.01) { rel[i] += d * kRel; moved = true } else if (d !== 0) { rel[i] = tr[i]; moved = true }
      }
      const vsT = st.exaggeration / t.mpp
      const dv = vsT - sceneState.vs
      if (Math.abs(dv) > 1e-5) { sceneState.vs += dv * (1 - Math.exp(-dt * 5)); moved = true } else if (dv !== 0) { sceneState.vs = vsT; moved = true }
      if (moved) sceneState.version++
    }

    const vmT = st.viewMode === 'voxel' ? 1 : 0
    const dm = vmT - sceneState.voxelMix
    if (Math.abs(dm) > 0.001) { sceneState.voxelMix = clamp(sceneState.voxelMix + Math.sign(dm) * dt * 0.7, 0, 1); sceneState.version++; sceneState.colorVersion++ } else sceneState.voxelMix = vmT

    const sim = simRuntime.current
    if (sim && st.simStatus === 'running') {
      sim.update(dt)
      statsT.current += dt
      if (statsT.current > 0.25 || sim.done) { statsT.current = 0; st.setSimStats(sim.stats(), sim.done) }
      if (sim.kind === 'landslide' && sim.version !== simVer.current) { simVer.current = sim.version; refreshOverlay() }
    }

    const c = sceneState.color, tc = tgtColor.current
    const o = sceneState.overlay, to = tgtOverlay.current
    if (tc.length === c.length && to.length === o.length) {
      const kc = 1 - Math.exp(-dt * 6)
      let ch = false
      for (let i = 0; i < c.length; i++) { const d = tc[i] - c[i]; if (d > 0.004 || d < -0.004) { c[i] += d * kc; ch = true } else if (d !== 0) { c[i] = tc[i]; ch = true } }
      for (let i = 0; i < o.length; i++) { const d = to[i] - o[i]; if (d > 0.004 || d < -0.004) { o[i] += d * kc * 1.5; ch = true } else if (d !== 0) { o[i] = to[i]; ch = true } }
      if (ch) sceneState.colorVersion++
    }
  })
  return null
}
