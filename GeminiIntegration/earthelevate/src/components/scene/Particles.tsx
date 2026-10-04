import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { simRuntime, useStore } from '../../store/useStore'
import { pickY, sceneState } from '../../lib/sceneState'

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

/** Ambient "data stream" motes drifting up through the volume above the terrain. */
export function AmbientParticles() {
  const n = useStore((s) => s.terrain?.size ?? 128)
  const pts = useRef<THREE.Points>(null)
  const tex = useMemo(glowTexture, [])
  const COUNT = 700
  const { geo, seeds } = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3))
    const s = new Float32Array(COUNT * 4)
    for (let i = 0; i < COUNT; i++) { s[i * 4] = Math.random() - 0.5; s[i * 4 + 1] = Math.random(); s[i * 4 + 2] = Math.random() - 0.5; s[i * 4 + 3] = 0.3 + Math.random() }
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4)
    return { geo: g, seeds: s }
  }, [])
  useFrame(({ clock }) => {
    if (!pts.current) return
    const t = clock.elapsedTime, p = geo.attributes.position as THREE.BufferAttribute
    const H = n * 0.55
    for (let i = 0; i < COUNT; i++) {
      const y = (seeds[i * 4 + 1] + t * 0.03 * seeds[i * 4 + 3]) % 1
      p.setXYZ(i, seeds[i * 4] * n * 1.3 + Math.sin(t * 0.3 + i) * 1.5, y * H, seeds[i * 4 + 2] * n * 1.3 + Math.cos(t * 0.25 + i) * 1.5)
    }
    p.needsUpdate = true
  })
  return (
    <points ref={pts} geometry={geo} frustumCulled={false}>
      <pointsMaterial map={tex} size={2.2} color="#6fe8ff" transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
    </points>
  )
}

/** Simulation particles (water or debris) following the simulation's flow field. */
export function FlowParticles() {
  const n = useStore((s) => s.terrain?.size ?? 0)
  const status = useStore((s) => s.simStatus)
  const kind = useStore((s) => s.simParams.kind)
  const pts = useRef<THREE.Points>(null)
  const tex = useMemo(glowTexture, [])
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4000 * 3), 3))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4)
    return g
  }, [])
  useFrame(() => {
    const m = pts.current, sim = simRuntime.current
    if (!m) return
    m.visible = !!sim && status !== 'idle' && sceneState.n === n
    if (!m.visible || !sim) return
    const p = geo.attributes.position as THREE.BufferAttribute
    const cnt = Math.min(sim.particleCount, p.count)
    const off = (n - 1) / 2
    for (let i = 0; i < cnt; i++) {
      const c = sim.particles[i * 2], r = sim.particles[i * 2 + 1]
      p.setXYZ(i, c - off, pickY(c, r) + 0.5, r - off)
    }
    p.needsUpdate = true
    geo.setDrawRange(0, cnt)
  })
  return (
    <points ref={pts} geometry={geo} frustumCulled={false}>
      <pointsMaterial map={tex} size={2.6} color={kind === 'flood' ? '#8ff3ff' : '#ffb347'} transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
    </points>
  )
}

/** Expanding holographic scan ring fired on terrain loads, layer changes and simulation starts. */
export function ScanPulse() {
  const burst = useStore((s) => s.burst)
  const n = useStore((s) => s.terrain?.size ?? 128)
  const ring = useRef<THREE.Mesh>(null)
  const t0 = useRef(-1)
  const clockRef = useRef(0)
  useEffect(() => { t0.current = clockRef.current }, [burst])
  useFrame(({ clock }) => {
    clockRef.current = clock.elapsedTime
    const m = ring.current
    if (!m) return
    if (t0.current < 0) t0.current = clock.elapsedTime - 99
    const k = (clock.elapsedTime - t0.current) / 1.6
    m.visible = k >= 0 && k <= 1
    if (!m.visible) return
    const s = 4 + k * n * 0.85
    m.scale.set(s, s, 1)
    m.position.y = 1 + (sceneState.rel.length ? 0 : 0)
    ;(m.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8
  })
  return (
    <mesh ref={ring} rotation-x={-Math.PI / 2} visible={false}>
      <ringGeometry args={[0.96, 1, 96]} />
      <meshBasicMaterial color="#5fe9ff" transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
    </mesh>
  )
}
