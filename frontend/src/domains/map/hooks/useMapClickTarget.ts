import type { MapMouseEvent } from 'maplibre-gl'
import type { MapTargetDraft } from '../../drone/types'

export function mapClickEventToTarget(event: MapMouseEvent): MapTargetDraft {
  return {
    lat: event.lngLat.lat,
    lon: event.lngLat.lng,
  }
}
