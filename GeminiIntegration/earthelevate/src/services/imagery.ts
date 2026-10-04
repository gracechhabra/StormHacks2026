import type { Bounds, ImageryKind } from '../types'

const URLS: Record<ImageryKind, string> = {
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  map: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
}
export const ATTRIBUTION: Record<ImageryKind, string> = {
  satellite: 'Imagery © Esri, Maxar, Earthstar Geographics',
  map: 'Map © Esri, HERE, Garmin, OpenStreetMap contributors',
}

const mercX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z
const mercY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('tile failed'))
    img.src = url
  })
}

/** Stitch XYZ tiles covering the DEM footprint, crop to it, and sample per-cell colours. */
export async function loadImagery(b: Bounds, kind: ImageryKind, cells: number) {
  const midLat = (b.north + b.south) / 2
  const spanM = (b.east - b.west) * 111320 * Math.cos((midLat * Math.PI) / 180)
  const z = Math.max(8, Math.min(17, Math.round(Math.log2((156543.03 * Math.cos((midLat * Math.PI) / 180) * 1024) / spanM))))
  const x0 = mercX(b.west, z), x1 = mercX(b.east, z), y0 = mercY(b.north, z), y1 = mercY(b.south, z)
  const tx0 = Math.floor(x0), tx1 = Math.floor(x1), ty0 = Math.floor(y0), ty1 = Math.floor(y1)
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 36) throw new Error('imagery area too large')

  const stitched = document.createElement('canvas')
  stitched.width = (tx1 - tx0 + 1) * 256
  stitched.height = (ty1 - ty0 + 1) * 256
  const sctx = stitched.getContext('2d')!
  const jobs: Promise<void>[] = []
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const url = URLS[kind].replace('{z}', String(z)).replace('{x}', String(tx)).replace('{y}', String(ty))
    jobs.push(loadImage(url).then((img) => sctx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256)))
  }
  await Promise.all(jobs)

  const out = document.createElement('canvas')
  out.width = out.height = 1024
  const octx = out.getContext('2d')!
  octx.drawImage(stitched, (x0 - tx0) * 256, (y0 - ty0) * 256, (x1 - x0) * 256, (y1 - y0) * 256, 0, 0, 1024, 1024)

  const small = document.createElement('canvas')
  small.width = small.height = cells
  const smctx = small.getContext('2d')!
  smctx.drawImage(out, 0, 0, cells, cells)
  const data = smctx.getImageData(0, 0, cells, cells).data // throws if the canvas is tainted
  const arr = new Float32Array(cells * cells * 3)
  for (let i = 0; i < cells * cells; i++) { arr[i * 3] = data[i * 4] / 255; arr[i * 3 + 1] = data[i * 4 + 1] / 255; arr[i * 3 + 2] = data[i * 4 + 2] / 255 }
  return { canvas: out, cells: arr, zoom: z }
}
