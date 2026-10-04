import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { useLiveStore } from '../store/useLiveStore'

/** Refetch live data whenever the selected point (or, with none selected, the dataset centre) changes. */
export function useLiveLocation() {
  const terrain = useStore((s) => s.terrain)
  const sel = useStore((s) => s.selected)
  const load = useLiveStore((s) => s.load)
  const lat = sel ? sel.lat : terrain?.lat
  const lon = sel ? sel.lon : terrain?.lon
  const label = sel ? `Selected point (${terrain?.label.split(',')[0] ?? ''})` : terrain?.label ?? ''
  useEffect(() => {
    if (lat == null || lon == null) return
    const id = setTimeout(() => void load(+lat.toFixed(4), +lon.toFixed(4), label), 350)
    return () => clearTimeout(id)
  }, [lat, lon, label, load])
}
