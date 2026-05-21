import type { GeoJSONSource, Map } from 'maplibre-gl'

export function mapStyleReady(map: Map) {
  return Boolean((map as { style?: unknown }).style)
}

export function getSourceSafe(map: Map, sourceId: string): GeoJSONSource | null {
  if (!mapStyleReady(map)) {
    return null
  }
  try {
    return (map.getSource(sourceId) as GeoJSONSource | undefined) ?? null
  } catch {
    return null
  }
}

export function removeLayerSafe(map: Map, layerId: string) {
  if (!mapStyleReady(map)) {
    return
  }
  try {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId)
    }
  } catch {
    // MapLibre may clear style during route unmount; cleanup should stay quiet.
  }
}

export function removeSourceSafe(map: Map, sourceId: string) {
  if (!mapStyleReady(map)) {
    return
  }
  try {
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId)
    }
  } catch {
    // MapLibre may clear style during route unmount; cleanup should stay quiet.
  }
}
