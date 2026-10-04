import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useStore } from '../../store/useStore'
import { sceneState } from '../../lib/sceneState'
import { smoothstep } from '../../lib/geo'

const toLinear = (v: number) => Math.pow(v, 2.2)

export function VoxelTerrain() {
  const n = useStore((s) => s.terrain?.size ?? 0)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const seen = useRef({ v: -1, c: -1, m: -1 })
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const geometry = useMemo(() => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g }, [])
  const delay = useMemo(() => {
    const d = new Float32Array(n * n), off = (n - 1) / 2, max = Math.hypot(off, off) || 1
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) d[r * n + c] = (Math.hypot(r - off, c - off) / max) * 0.45
    return d
  }, [n])

  useEffect(() => { seen.current = { v: -1, c: -1, m: -1 } }, [n])

  useFrame(() => {
    const m = mesh.current
    if (!m || sceneState.n !== n || !n) return
    const mix = sceneState.voxelMix
    m.visible = mix > 0.002
    if (!m.visible) { seen.current.m = -1; return }
    const s = seen.current
    const geoChanged = s.v !== sceneState.version || s.m !== mix
    if (geoChanged) {
      s.v = sceneState.version; s.m = mix
      const { rel, vs } = sceneState
      const off = (n - 1) / 2
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const i = r * n + c
        const top = Math.max(1, Math.ceil(rel[i] * vs))
        const p = smoothstep(delay[i], delay[i] + 0.55, mix * 1.5)
        const h = Math.max(0.001, top * p)
        dummy.position.set(c - off, 0, r - off)
        dummy.scale.set(0.97, h, 0.97)
        dummy.updateMatrix()
        m.setMatrixAt(i, dummy.matrix)
      }
      m.instanceMatrix.needsUpdate = true
    }
    if (s.c !== sceneState.colorVersion || geoChanged) {
      s.c = sceneState.colorVersion
      const { color, overlay } = sceneState
      const arr = (m.instanceColor ?? (m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * n * 3), 3))).array as Float32Array
      for (let i = 0; i < n * n; i++) {
        const a = overlay[i * 4 + 3] * 0.85
        arr[i * 3] = toLinear(color[i * 3] + (overlay[i * 4] - color[i * 3]) * a)
        arr[i * 3 + 1] = toLinear(color[i * 3 + 1] + (overlay[i * 4 + 1] - color[i * 3 + 1]) * a)
        arr[i * 3 + 2] = toLinear(color[i * 3 + 2] + (overlay[i * 4 + 2] - color[i * 3 + 2]) * a)
      }
      m.instanceColor!.needsUpdate = true
    }
  })

  if (!n) return null
  return (
    <instancedMesh key={n} ref={mesh} args={[geometry, undefined, n * n]} frustumCulled={false}>
      <meshStandardMaterial roughness={0.85} metalness={0.05} emissive="#0a1c2a" emissiveIntensity={0.6} />
    </instancedMesh>
  )
}
