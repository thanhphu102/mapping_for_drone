import type { Map } from 'maplibre-gl'

export type GoogleBaseMapMode = 'map' | 'satellite'

export const GOOGLE_RASTER_MAX_ZOOM = 21
export const GOOGLE_STREETS_SOURCE_ID = 'googleStreets'
export const GOOGLE_HYBRID_SOURCE_ID = 'googleHybrid'
export const GOOGLE_STREETS_LAYER_ID = 'google-streets'
export const GOOGLE_HYBRID_LAYER_ID = 'google-hybrid'

const googleBaseMapStorageKey = 'swarm-gsc-google-base-map-mode'

export function googleRasterTileScale() {
  if (typeof window === 'undefined') {
    return 1
  }
  return window.devicePixelRatio >= 1.25 ? 2 : 1
}

export function readStoredGoogleBaseMapMode(): GoogleBaseMapMode {
  if (typeof window === 'undefined') {
    return 'map'
  }
  return window.localStorage.getItem(googleBaseMapStorageKey) === 'satellite'
    ? 'satellite'
    : 'map'
}

export function writeStoredGoogleBaseMapMode(mode: GoogleBaseMapMode) {
  window.localStorage.setItem(googleBaseMapStorageKey, mode)
}

export function setGoogleBaseMapLayerVisibility(
  map: Map,
  mode: GoogleBaseMapMode,
) {
  if (map.getLayer(GOOGLE_STREETS_LAYER_ID)) {
    map.setLayoutProperty(
      GOOGLE_STREETS_LAYER_ID,
      'visibility',
      mode === 'map' ? 'visible' : 'none',
    )
  }

  if (map.getLayer(GOOGLE_HYBRID_LAYER_ID)) {
    map.setLayoutProperty(
      GOOGLE_HYBRID_LAYER_ID,
      'visibility',
      mode === 'satellite' ? 'visible' : 'none',
    )
  }
}
