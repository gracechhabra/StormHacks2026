import { create } from 'zustand'
import { fetchLive, type LiveData } from '../services/live'

interface LiveState {
  live: LiveData | null
  status: 'idle' | 'loading' | 'ok' | 'error'
  error: string | null
  label: string
  load: (lat: number, lon: number, label: string) => Promise<void>
}

let token = 0

/** Live Open-Meteo data for the active location; deliberately independent of the terrain/FPGA store. */
export const useLiveStore = create<LiveState>((set) => ({
  live: null, status: 'idle', error: null, label: '',
  load: async (lat, lon, label) => {
    const my = ++token
    set({ status: 'loading', label })
    try {
      const d = await fetchLive(lat, lon)
      if (my !== token) return
      if (!d.ok) set({ status: 'error', error: d.error ?? 'Live data unavailable', live: null })
      else set({ status: 'ok', live: d, error: null })
    } catch (e) {
      if (my === token) set({ status: 'error', error: (e as Error).message, live: null })
    }
  },
}))
