import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { simRuntime, useStore } from '../../store/useStore'
import { sceneState, voxelTopY, surfaceYAtGrid } from '../../lib/sceneState'

const VERT = /* glsl */ `
attribute float aDepth;
varying float vDepth; varying vec3 vW; varying vec2 vUv;
void main(){ vDepth = aDepth; vW = position; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const FRAG = /* glsl */ `
uniform float uTime; uniform float uMaxDepth;
varying float vDepth; varying vec3 vW; varying vec2 vUv;
void main(){
  if (vDepth < 0.02) discard;
  float k = clamp(vDepth / max(uMaxDepth, 0.5), 0.0, 1.0);
  vec3 shallow = vec3(0.25, 0.85, 1.0), deep = vec3(0.02, 0.18, 0.62);
  vec3 c = mix(shallow, deep, pow(k, 0.6));
  float rip = sin(vW.x * 0.9 + uTime * 2.2) * sin(vW.z * 0.8 - uTime * 1.7);
  c += 0.12 * rip + 0.05;
  float edge = 1.0 - smoothstep(0.0, 0.5, vDepth);
  c = mix(c, vec3(0.8, 1.0, 1.0), edge * 0.4);
  gl_FragColor = vec4(c, clamp(0.45 + 0.4 * k + 0.15 * edge, 0.0, 0.92));
}`

/** Translucent water surface driven by the flood visualisation's per-cell depth. */
export function WaterMesh() {
  const n = useStore((s) => s.terrain?.size ?? 0)
  const kind = useStore((s) => s.simParams.kind)
  const status = useStore((s) => s.simStatus)
  const mesh = useRef<THREE.Mesh>(null)
  const seen = useRef({ v: -1, s: -1 })

  const geometry = useMemo(() => {
    if (!n) return null
    const g = new THREE.BufferGeometry(), N = n * n
    const idx = new Uint32Array((n - 1) * (n - 1) * 6)
    let k = 0
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
      const a = r * n + c, b = a + 1, d = a + n, e = d + 1
      idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(N * 2), 2))
    g.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(N), 1))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), n * 2)
    return g
  }, [n])

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uMaxDepth: { value: 5 } },
  }), [])

  useEffect(() => { seen.current = { v: -1, s: -1 } }, [geometry, status])

  useFrame(({ clock }) => {
    const m = mesh.current, sim = simRuntime.current
    if (!m || !geometry) return
    const on = !!sim && sim.kind === 'flood' && !!sim.depth && status !== 'idle' && sceneState.n === n
    m.visible = on
    if (!on || !sim || !sim.depth) return
    material.uniforms.uTime.value = clock.elapsedTime
    if (seen.current.s === sim.version && seen.current.v === sceneState.version + sceneState.voxelMix) return
    seen.current = { s: sim.version, v: sceneState.version + sceneState.voxelMix }
    const pos = geometry.attributes.position as THREE.BufferAttribute
    const dep = geometry.attributes.aDepth as THREE.BufferAttribute
    const { vs, voxelMix } = sceneState
    const off = (n - 1) / 2
    let maxD = 0.5
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c
      const d = sim.depth[i]
      if (d > maxD) maxD = d
      const top = voxelMix > 0.01 ? surfaceYAtGrid(c, r) * (1 - voxelMix) + voxelTopY(c, r) * voxelMix : surfaceYAtGrid(c, r)
      pos.setXYZ(i, c - off, top + Math.max(d, 0) * vs + 0.06, r - off)
      dep.setX(i, d)
    }
    material.uniforms.uMaxDepth.value = maxD
    pos.needsUpdate = dep.needsUpdate = true
  })

  if (!geometry || kind !== 'flood') return null
  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
}
