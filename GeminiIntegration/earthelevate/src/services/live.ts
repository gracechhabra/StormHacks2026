export interface LiveData {
  ok: boolean
  error?: string
  source: string
  latitude: number
  longitude: number
  elevation_m: number | null
  timezone: string
  timezone_abbreviation: string
  utc_offset_seconds: number
  local_time: string
  temperature_c: number | null
  weather_code: number | null
  weather: string | null
  is_day: boolean | null
  fetched_at_unix: number
}

export const fetchLive = (lat: number, lon: number) =>
  fetch(`/api/live?lat=${lat}&lon=${lon}`).then((r) => r.json() as Promise<LiveData>)

/** Current wall-clock time at the location, derived from its UTC offset. */
export function localNow(d: LiveData, now = Date.now()): Date {
  return new Date(now + d.utc_offset_seconds * 1000)
}
export function fmtLocal(d: LiveData, now = Date.now()) {
  const t = localNow(d, now)
  const opts = { timeZone: 'UTC' } as const
  return {
    date: t.toLocaleDateString('en-CA', { ...opts, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
    time: t.toLocaleTimeString('en-GB', { ...opts, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  }
}
