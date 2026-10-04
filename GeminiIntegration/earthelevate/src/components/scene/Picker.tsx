import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useStore } from '../../store/useStore'
import { pickY, sceneState } from '../../lib/sceneState'
import { cellInfo } from '../../lib/analysis'

/** Heightfield ray-march picking: hover + click select, with a drag threshold so orbiting never selects. */
export function Picker() {
  const { gl, camera } = useThree()

  useEffect(() => {
    const el = gl.domElement
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const p = new THREE.Vector3()
    let down: { x: number; y: number } | null = null
    let raf = 0
    let last: { x: number; y: number; buttons: number } | null = null

    const cast = (cx: number, cy: number): { row: number; col: number } | null => {
      const { n } = sceneState
      if (!n) return null
      const rc = el.getBoundingClientRect()
      ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const off = (n - 1) / 2
      const inside = (v: THREE.Vector3) => v.x >= -off && v.x <= off && v.z >= -off && v.z <= off
      const above = (t: number) => { ray.ray.at(t, p); return p.y - pickY(p.x + off, p.z + off) }
      const step = 0.7, max = camera.position.length() * 2 + n * 2
      let prevT = 0, prevD = 0, first = true
      for (let t = 0; t < max; t += step) {
        ray.ray.at(t, p)
        if (!inside(p)) { first = true; continue }
        const d = above(t)
        if (!first && prevD > 0 && d <= 0) {
          let lo = prevT, hi = t
          for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (above(mid) > 0) lo = mid; else hi = mid }
          ray.ray.at(hi, p)
          return { row: Math.round(Math.min(n - 1, Math.max(0, p.z + off))), col: Math.round(Math.min(n - 1, Math.max(0, p.x + off))) }
        }
        if (d <= 0 && first) { // ray started below the surface; ignore
          first = false; prevT = t; prevD = d; continue
        }
        first = false; prevT = t; prevD = d
      }
      return null
    }

    const doHover = () => {
      raf = 0
      const st = useStore.getState()
      if (!last || !st.terrain || !st.analysis) return
      if (last.buttons !== 0) { if (st.hover) st.setHover(null); return }
      const hit = cast(last.x, last.y)
      if (!hit) { if (st.hover) st.setHover(null); return }
      if (st.hover && st.hover.row === hit.row && st.hover.col === hit.col) return
      st.setHover(cellInfo(st.terrain, st.analysis, hit.row, hit.col))
    }
    const onMove = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY, buttons: e.buttons }; if (!raf) raf = requestAnimationFrame(doHover) }
    const onDown = (e: PointerEvent) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY } }
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 5) return
      const hit = cast(e.clientX, e.clientY)
      const st = useStore.getState()
      if (!hit) return
      if (st.sectionPicking) {
        const a = st.sectionPicking.a
        if (!a) st.setSectionPicking({ a: hit })
        else st.setCrossSection({ a, b: hit, label: 'Custom cross-section' })
        return
      }
      st.selectCell(hit.row, hit.col)
    }
    const onLeave = () => { last = null; useStore.getState().setHover(null) }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp); el.removeEventListener('pointerleave', onLeave)
      cancelAnimationFrame(raf)
    }
  }, [gl, camera])
  return null
}
