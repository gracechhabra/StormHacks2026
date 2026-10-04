import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useStore, cellScenePos } from '../../store/useStore'
import { pickY, sceneState } from '../../lib/sceneState'
import { fmtLat, fmtLon, fmtM } from '../../lib/geo'
import type { CellInfo } from '../../types'

function placeAt(g: THREE.Object3D | null, c: CellInfo | null, n: number, lift = 0) {
  if (!g || !c || !sceneState.n) return
  const off = (n - 1) / 2
  g.position.set(c.col - off, pickY(c.col, c.row) + lift, c.row - off)
}

export function HoverRing() {
  const hover = useStore((s) => s.hover)
  const n = useStore((s) => s.terrain?.size ?? 0)
  const g = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!g.current) return
    g.current.visible = !!hover
    placeAt(g.current, hover, n, 0.25)
    g.current.rotation.y = clock.elapsedTime * 1.5
  })
  return (
    <group ref={g} visible={false}>
      <mesh rotation-x={-Math.PI / 2}><ringGeometry args={[1.4, 1.8, 32]} /><meshBasicMaterial color="#9cf6ff" transparent opacity={0.85} depthTest={false} /></mesh>
    </group>
  )
}

export function SelectionMarker() {
  const sel = useStore((s) => s.selected)
  const n = useStore((s) => s.terrain?.size ?? 0)
  const g = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!g.current) return
    g.current.visible = !!sel
    placeAt(g.current, sel, n)
    if (ring.current) { const k = (clock.elapsedTime * 0.9) % 1; ring.current.scale.setScalar(1 + k * 5); (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k) }
  })
  if (!sel) return <group ref={g} visible={false} />
  const H = Math.max(14, n * 0.14)
  return (
    <group ref={g}>
      <mesh position-y={H / 2}><cylinderGeometry args={[0.12, 0.12, H, 8]} /><meshBasicMaterial color="#6ff0ff" transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
      <mesh position-y={0.5}><sphereGeometry args={[0.9, 20, 20]} /><meshBasicMaterial color="#ffffff" /></mesh>
      <mesh position-y={0.5}><sphereGeometry args={[1.8, 20, 20]} /><meshBasicMaterial color="#38d9ff" transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.4}><ringGeometry args={[0.9, 1, 48]} /><meshBasicMaterial color="#6ff0ff" transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} /></mesh>
      <Html position={[0, H + 1, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className="hud-card">
          <div className="hud-title">◈ TARGET LOCK</div>
          <div className="hud-grid">
            <span>LAT</span><b>{fmtLat(sel.lat)}</b>
            <span>LON</span><b>{fmtLon(sel.lon)}</b>
            <span>ELEV</span><b>{fmtM(sel.elev)}</b>
            <span>SLOPE</span><b>{sel.slope.toFixed(1)}°</b>
            <span>ASPECT</span><b>{sel.aspectName}</b>
            <span>TYPE</span><b>{sel.terrainType}</b>
            {sel.landCover && (<><span>COVER</span><b>{sel.landCover}</b></>)}
            <span>FLOOD</span><b>{(sel.floodRisk * 100).toFixed(0)}%</b>
            <span>SLIDE</span><b>{(sel.landslideRisk * 100).toFixed(0)}%</b>
          </div>
        </div>
      </Html>
    </group>
  )
}

/** Holographic labels on the summit, the lowest point, plus compass and coordinate ticks around the edge. */
export function TerrainLabels() {
  const terrain = useStore((s) => s.terrain)
  const analysis = useStore((s) => s.analysis)
  const exag = useStore((s) => s.exaggeration)
  const vm = useStore((s) => s.viewMode)
  if (!terrain || !analysis) return null
  const n = terrain.size, off = (n - 1) / 2
  const hi = analysis.stats.highest, lo = analysis.stats.lowest
  const hp = cellScenePos(terrain, analysis, exag, hi.row, hi.col)
  const lp = cellScenePos(terrain, analysis, exag, lo.row, lo.col)
  const b = { n: terrain.lat + (off * terrain.mpp) / 111320, s: terrain.lat - (off * terrain.mpp) / 111320 }
  const dlon = (off * terrain.mpp) / (111320 * Math.cos((terrain.lat * Math.PI) / 180))
  const ticks = [0.25, 0.5, 0.75]
  void vm
  return (
    <group>
      <Html position={[hp[0], hp[1] + 6, hp[2]]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="holo-label">▲ SUMMIT {fmtM(analysis.stats.max)}</div>
      </Html>
      <Html position={[lp[0], lp[1] + 5, lp[2]]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="holo-label low">▼ LOW {fmtM(analysis.stats.min)}</div>
      </Html>
      {[['N', 0, -off - 8], ['S', 0, off + 8], ['E', off + 8, 0], ['W', -off - 8, 0]].map(([l, x, z]) => (
        <Html key={String(l)} position={[x as number, 0, z as number]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`compass ${l === 'N' ? 'north' : ''}`}>{l}</div>
        </Html>
      ))}
      {ticks.map((k) => (
        <group key={k}>
          <Html position={[-off - 4, 0, -off + k * (n - 1)]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <div className="tick">{(b.n - k * (b.n - b.s)).toFixed(3)}°</div>
          </Html>
          <Html position={[-off + k * (n - 1), 0, off + 4]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <div className="tick">{(terrain.lon - dlon + k * 2 * dlon).toFixed(3)}°</div>
          </Html>
        </group>
      ))}
    </group>
  )
}
