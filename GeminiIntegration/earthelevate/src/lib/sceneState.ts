/** Mutable, non-React state shared by the 3D components (animated heights etc.). Read inside useFrame only. */
export const sceneState = {
  n: 0,
  rel: new Float32Array(0), // displayed height above dataset minimum, metres
  vs: 1, // displayed scene units per metre
  version: 0, // bumps whenever displayed heights change
  voxelMix: 0, // 0 = smooth surface, 1 = voxel world
  colorVersion: 0,
  color: new Float32Array(0), // displayed base colour, sRGB 0..1 (N*3)
  overlay: new Float32Array(0), // displayed overlay rgba (N*4)
  sat: null as Float32Array | null,
  fps: 0, // measured browser render rate
}

export const gridToX = (c: number, n: number) => c - (n - 1) / 2
export const gridToZ = (r: number, n: number) => r - (n - 1) / 2

/** Surface height in scene units at fractional grid coordinates (vertex space, 0..n-1). */
export function surfaceYAtGrid(c: number, r: number): number {
  const { n, rel, vs } = sceneState
  if (!n) return 0
  c = Math.min(n - 1.001, Math.max(0, c)); r = Math.min(n - 1.001, Math.max(0, r))
  const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0
  const i = r0 * n + c0
  const h = rel[i] * (1 - fc) * (1 - fr) + rel[i + 1] * fc * (1 - fr) + rel[i + n] * (1 - fc) * fr + rel[i + n + 1] * fc * fr
  return h * vs
}

/** Top of the voxel column covering a cell (quantised to whole blocks, minimum one block). */
export function voxelTopY(c: number, r: number): number {
  const { n, rel, vs } = sceneState
  const ci = Math.min(n - 1, Math.max(0, Math.round(c))), ri = Math.min(n - 1, Math.max(0, Math.round(r)))
  return Math.max(1, Math.ceil(rel[ri * n + ci] * vs))
}

export function pickY(c: number, r: number): number {
  const s = surfaceYAtGrid(c, r)
  const m = sceneState.voxelMix
  return m < 0.02 ? s : s + (voxelTopY(c, r) - s) * m
}
