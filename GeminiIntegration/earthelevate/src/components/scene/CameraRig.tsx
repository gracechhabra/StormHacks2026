import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OC } from 'three-stdlib'
import { useStore } from '../../store/useStore'
import { clamp, easeInOut } from '../../lib/geo'

interface Anim { t: number; dur: number; from: { tg: THREE.Vector3; r: number; az: number; po: number }; to: { tg: THREE.Vector3; r: number; az: number; po: number } }
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export function CameraRig() {
  const controls = useRef<OC>(null)
  const { camera } = useThree()
  const anim = useRef<Anim | null>(null)
  const lastId = useRef(0)
  const keys = useRef(new Set<string>())
  const n = useStore((s) => s.terrain?.size ?? 128)

  const read = (tg: THREE.Vector3) => {
    const o = camera.position.clone().sub(tg)
    const r = o.length()
    return { r, po: Math.acos(clamp(o.y / r, -1, 1)), az: Math.atan2(o.x, o.z) }
  }
  const place = (tg: THREE.Vector3, r: number, az: number, po: number) => {
    controls.current?.target.copy(tg)
    camera.position.set(tg.x + r * Math.sin(po) * Math.sin(az), tg.y + r * Math.cos(po), tg.z + r * Math.sin(po) * Math.cos(az))
    camera.lookAt(tg)
    controls.current?.update()
  }

  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey) return
      keys.current.add(e.key.toLowerCase())
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase())
    const blur = () => keys.current.clear()
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const cancel = () => { anim.current = null }
    c.addEventListener('start', cancel)
    return () => c.removeEventListener('start', cancel)
  }, [])

  useFrame((_, dtRaw) => {
    const c = controls.current
    if (!c) return
    const dt = Math.min(dtRaw, 0.1)
    const req = useStore.getState().camera
    if (req && req.id !== lastId.current) {
      const first = lastId.current === 0
      lastId.current = req.id
      const cur = read(c.target)
      const tg = req.target ? new THREE.Vector3(...req.target) : c.target.clone()
      let r = req.radius ?? cur.r * (req.radiusFactor ?? 1)
      r = clamp(r, 10, n * 3)
      let az = req.azimuth ?? cur.az
      if (req.azimuthDelta) az = cur.az + req.azimuthDelta
      const po = clamp(req.polar ?? cur.po, 0.12, 1.5)
      if (first) { place(tg, r, az, po); anim.current = null }
      else anim.current = { t: 0, dur: req.duration ?? 1.4, from: { tg: c.target.clone(), ...cur }, to: { tg, r, az: cur.az + wrap(az - cur.az), po } }
    }
    const a = anim.current
    if (a) {
      a.t += dt
      const k = easeInOut(clamp(a.t / a.dur, 0, 1))
      const tg = a.from.tg.clone().lerp(a.to.tg, k)
      const lift = 1 + Math.sin(Math.PI * k) * 0.1 // gentle pull-back mid-flight
      place(tg, (a.from.r + (a.to.r - a.from.r) * k) * lift, a.from.az + (a.to.az - a.from.az) * k, a.from.po + (a.to.po - a.from.po) * k)
      if (a.t >= a.dur) anim.current = null
    }
    const k = keys.current
    if (k.size && !anim.current) {
      const cur = read(c.target)
      const sp = cur.r * 0.9 * dt
      const fwd = new THREE.Vector3(-Math.sin(cur.az), 0, -Math.cos(cur.az))
      const right = new THREE.Vector3(Math.cos(cur.az), 0, -Math.sin(cur.az))
      const mv = new THREE.Vector3()
      if (k.has('w') || k.has('arrowup')) mv.add(fwd)
      if (k.has('s') || k.has('arrowdown')) mv.sub(fwd)
      if (k.has('d') || k.has('arrowright')) mv.add(right)
      if (k.has('a') || k.has('arrowleft')) mv.sub(right)
      const rot = (k.has('q') ? 1 : 0) - (k.has('e') ? 1 : 0)
      if (mv.lengthSq() || rot) {
        const tg = c.target.clone().add(mv.multiplyScalar(sp))
        tg.x = clamp(tg.x, -n / 2, n / 2); tg.z = clamp(tg.z, -n / 2, n / 2)
        place(tg, cur.r, cur.az + rot * dt * 1.2, cur.po)
      }
    }
  })

  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} minDistance={10} maxDistance={n * 3} maxPolarAngle={1.5} rotateSpeed={0.7} />
}
