import { Canvas } from '@react-three/fiber'
import { Grid, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../../store/useStore'
import { SceneDriver } from './SceneDriver'
import { TerrainMesh } from './TerrainMesh'
import { VoxelTerrain } from './VoxelTerrain'
import { WaterMesh } from './WaterMesh'
import { AmbientParticles, FlowParticles, ScanPulse } from './Particles'
import { CameraRig } from './CameraRig'
import { Picker } from './Picker'
import { HoverRing, SelectionMarker, TerrainLabels } from './Markers'
import { CrossSectionCurtain } from './CrossSectionCurtain'

export function TerrainViewer() {
  const n = useStore((s) => s.terrain?.size ?? 128)
  return (
    <Canvas
      flat
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, n * 0.8, n * 1.1], fov: 45, near: 0.5, far: 4000 }}
      onCreated={({ gl }) => gl.setClearColor('#02050c')}
    >
      <fog attach="fog" args={['#02050c', n * 2.2, n * 6]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[-60, 120, 45]} intensity={2.2} />
      <hemisphereLight args={['#6ab8ff', '#150a30', 0.5]} />
      <Stars radius={900} depth={120} count={3500} factor={5} saturation={0} fade speed={0.6} />
      <Grid
        position={[0, -0.6, 0]} args={[10, 10]} cellSize={4} cellThickness={0.6} cellColor="#12526a" sectionSize={16} sectionThickness={1.1}
        sectionColor="#2b8fb5" fadeDistance={n * 2.4} fadeStrength={1.6} infiniteGrid side={THREE.DoubleSide}
      />
      <SceneDriver />
      <TerrainMesh />
      <VoxelTerrain />
      <WaterMesh />
      <FlowParticles />
      <AmbientParticles />
      <ScanPulse />
      <CrossSectionCurtain />
      <HoverRing />
      <SelectionMarker />
      <TerrainLabels />
      <Picker />
      <CameraRig />
    </Canvas>
  )
}
