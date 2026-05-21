export const MAIN_MAP_CAMERA_STORAGE_KEY = 'drone-dashboard-main-map-camera'
const MAIN_MAP_CAMERA_SCHEMA_VERSION = 2

export interface StoredMainMapCamera {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validLngLat(center: unknown): center is [number, number] {
  if (!Array.isArray(center) || center.length !== 2) return false
  const [lng, lat] = center
  return (
    isFiniteNumber(lng) &&
    isFiniteNumber(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  )
}

export function parseStoredMainMapCamera(raw: string | null): StoredMainMapCamera | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown
      center?: unknown
      zoom?: unknown
      bearing?: unknown
      pitch?: unknown
    }
    if (parsed.version !== MAIN_MAP_CAMERA_SCHEMA_VERSION) return null
    if (!validLngLat(parsed.center)) return null
    if (!isFiniteNumber(parsed.zoom)) return null
    if (!isFiniteNumber(parsed.bearing)) return null
    if (!isFiniteNumber(parsed.pitch)) return null
    return {
      center: parsed.center,
      zoom: parsed.zoom,
      bearing: parsed.bearing,
      pitch: parsed.pitch,
    }
  } catch {
    return null
  }
}

export function readStoredMainMapCamera(): StoredMainMapCamera | null {
  if (typeof window === 'undefined') return null
  return parseStoredMainMapCamera(window.sessionStorage.getItem(MAIN_MAP_CAMERA_STORAGE_KEY))
}

export function writeStoredMainMapCamera(camera: StoredMainMapCamera) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(
    MAIN_MAP_CAMERA_STORAGE_KEY,
    JSON.stringify({
      version: MAIN_MAP_CAMERA_SCHEMA_VERSION,
      ...camera,
    }),
  )
}
