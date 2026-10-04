import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useStore } from '../../store/useStore'
import { sceneState } from '../../lib/sceneState'
import { clamp } from '../../lib/geo'

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute vec4 aOverlay;
attribute float aRel;
varying vec3 vColor; varying vec4 vOverlay; varying vec2 vUv; varying vec3 vN; varying float vRel; varying vec3 vW;
void main(){
  vColor = aColor; vOverlay = aOverlay; vUv = uv; vN = normal; vRel = aRel; vW = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const FRAG = /* glsl */ `
uniform sampler2D uSat; uniform float uSatMix; uniform float uContour; uniform float uInterval;
uniform float uVox; uniform float uN; uniform float uTime;
varying vec3 vColor; varying vec4 vOverlay; varying vec2 vUv; varying vec3 vN; varying float vRel; varying vec3 vW;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  if (uVox > 0.001 && hash(floor(vUv * uN)) < uVox) discard;
  vec3 base = vColor;
  if (uSatMix > 0.001) base = mix(base, texture2D(uSat, vUv).rgb, uSatMix);
  vec3 N = normalize(vN);
  vec3 L = normalize(vec3(-0.45, 0.85, 0.35));
  float d = max(dot(N, L), 0.0);
  vec3 lit = base * (0.36 + 0.82 * d);
  float h = vRel / uInterval;
  float fw = max(fwidth(h), 1e-4);
  float line = 1.0 - min(abs(fract(h - 0.5) - 0.5) / fw, 1.0);
  float h5 = h / 5.0;
  float major = 1.0 - min(abs(fract(h5 - 0.5) - 0.5) / max(fwidth(h5), 1e-4), 1.0);
  lit = mix(lit, vec3(0.55, 0.95, 1.0), clamp(line * 0.45 + major * 0.35, 0.0, 0.8) * uContour);
  lit = mix(lit, vOverlay.rgb, vOverlay.a);
  float rim = pow(1.0 - abs(dot(N, normalize(cameraPosition - vW))), 3.0);
  lit += vec3(0.05, 0.28, 0.45) * rim * 0.4;
  float pulse = 0.5 + 0.5 * sin(uTime * 2.0 - vW.x * 0.05 - vW.z * 0.05);
  lit += vOverlay.a * 0.12 * pulse * vOverlay.rgb;
  gl_FragColor = vec4(lit, 1.0);
}`

function niceInterval(range: number) {
  const raw = Math.max(range, 1) / 16
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

export function TerrainMesh() {
  const terrain = useStore((s) => s.terrain)
  const analysis = useStore((s) => s.analysis)
  const satCanvas = useStore((s) => s.satellite.canvas)
  const mesh = useRef<THREE.Mesh>(null)
  const seen = useRef({ v: -1, c: -1 })
  const n = terrain?.size ?? 0

  const texture = useMemo(() => {
    if (!satCanvas) return null
    const t = new THREE.CanvasTexture(satCanvas)
    t.colorSpace = THREE.NoColorSpace
    t.anisotropy = 8
    return t
  }, [satCanvas])

  const geometry = useMemo(() => {
    if (!n) return null
    const g = new THREE.BufferGeometry()
    const N = n * n
    const uv = new Float32Array(N * 2)
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const i = r * n + c; uv[i * 2] = c / (n - 1); uv[i * 2 + 1] = 1 - r / (n - 1) }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6)
    let k = 0
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
      const a = r * n + c, b = a + 1, d = a + n, e = d + 1
      idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
    g.setAttribute('aOverlay', new THREE.BufferAttribute(new Float32Array(N * 4), 4))
    g.setAttribute('aRel', new THREE.BufferAttribute(new Float32Array(N), 1))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), n * 2)
    return g
  }, [n])

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
    uniforms: {
      uSat: { value: null }, uSatMix: { value: 0 }, uContour: { value: 1 }, uInterval: { value: 50 },
      uVox: { value: 0 }, uN: { value: 128 }, uTime: { value: 0 },
    },
  }), [])

  useEffect(() => { material.uniforms.uSat.value = texture }, [texture, material])
  useEffect(() => { seen.current = { v: -1, c: -1 } }, [geometry])

  useFrame(({ clock }, dt) => {
    if (!mesh.current || !geometry || !analysis || sceneState.n !== n) return
    const u = material.uniforms
    const st = useStore.getState()
    u.uTime.value = clock.elapsedTime
    u.uVox.value = sceneState.voxelMix
    u.uN.value = n - 1
    u.uInterval.value = niceInterval(analysis.stats.range)
    const k = 1 - Math.exp(-dt * 5)
    u.uContour.value += ((st.contours ? 1 : 0) - u.uContour.value) * k
    const satOn = st.baseLayer === 'satellite' && texture && st.satellite.status === 'ready' ? 1 : 0
    u.uSatMix.value += (satOn - u.uSatMix.value) * k
    mesh.current.visible = sceneState.voxelMix < 0.995

    if (seen.current.v !== sceneState.version) {
      seen.current.v = sceneState.version
      const { rel, vs } = sceneState
      const pos = geometry.attributes.position as THREE.BufferAttribute
      const nor = geometry.attributes.normal as THREE.BufferAttribute
      const aRel = geometry.attributes.aRel as THREE.BufferAttribute
      const h = (r: number, c: number) => rel[clamp(r, 0, n - 1) * n + clamp(c, 0, n - 1)]
      const off = (n - 1) / 2
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const i = r * n + c
        pos.setXYZ(i, c - off, rel[i] * vs, r - off)
        aRel.setX(i, rel[i])
        const dx = ((h(r, c + 1) - h(r, c - 1)) * vs) / 2, dz = ((h(r + 1, c) - h(r - 1, c)) * vs) / 2
        const l = Math.hypot(dx, 1, dz)
        nor.setXYZ(i, -dx / l, 1 / l, -dz / l)
      }
      pos.needsUpdate = nor.needsUpdate = aRel.needsUpdate = true
    }
    if (seen.current.c !== sceneState.colorVersion) {
      seen.current.c = sceneState.colorVersion
      const col = geometry.attributes.aColor as THREE.BufferAttribute
      const ov = geometry.attributes.aOverlay as THREE.BufferAttribute
      ;(col.array as Float32Array).set(sceneState.color)
      ;(ov.array as Float32Array).set(sceneState.overlay)
      col.needsUpdate = ov.needsUpdate = true
    }
  })

  if (!geometry) return null
  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} />
}
