import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useStore } from '../../store/useStore'
import { sectionPath } from '../../lib/highlights'
import { pickY, sceneState } from '../../lib/sceneState'

/** Translucent vertical curtain under the cross-section line, with a marker linked to the profile hover. */
export function CrossSectionCurtain() {
  const terrain = useStore((s) => s.terrain)
  const cs = useStore((s) => s.crossSection)
  const path = useMemo(() => (terrain && cs ? sectionPath(terrain, cs).path : null), [terrain, cs])
  const marker = useRef<THREE.Mesh>(null)
  const seen = useRef(-1)

  const { curtain, line } = useMemo(() => {
    const len = path?.length ?? 0
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(len * 6), 3))
    const idx: number[] = []
    for (let i = 0; i < len - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    g.setIndex(idx)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4)
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(len * 3), 3))
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4)
    const l = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: '#ff5df0' }))
    l.frustumCulled = false
    return { curtain: g, line: l }
  }, [path])
  useEffect(() => { seen.current = -1 }, [path])

  useFrame(() => {
    if (!path || !terrain) return
    const off = (terrain.size - 1) / 2
    if (seen.current !== sceneState.version + sceneState.voxelMix) {
      seen.current = sceneState.version + sceneState.voxelMix
      const p = curtain.attributes.position as THREE.BufferAttribute
      const lp = line.geometry.attributes.position as THREE.BufferAttribute
      path.forEach((q, i) => {
        const y = pickY(q.col, q.row) + 0.4
        p.setXYZ(i * 2, q.col - off, 0, q.row - off)
        p.setXYZ(i * 2 + 1, q.col - off, y, q.row - off)
        lp.setXYZ(i, q.col - off, y, q.row - off)
      })
      p.needsUpdate = lp.needsUpdate = true
    }
    const hv = useStore.getState().profileHover
    if (marker.current) {
      marker.current.visible = hv != null
      if (hv != null) {
        const q = path[Math.min(path.length - 1, Math.round(hv * (path.length - 1)))]
        marker.current.position.set(q.col - off, pickY(q.col, q.row) + 1.2, q.row - off)
      }
    }
  })

  if (!path || !cs) return null
  return (
    <group>
      <mesh geometry={curtain} frustumCulled={false}>
        <meshBasicMaterial color="#c43bff" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <primitive object={line} />
      <mesh ref={marker}><sphereGeometry args={[1.4, 16, 16]} /><meshBasicMaterial color="#ffffff" /></mesh>
    </group>
  )
}
