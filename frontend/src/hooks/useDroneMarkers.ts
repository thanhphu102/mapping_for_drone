import { useCallback, useEffect, useRef } from 'react'
import maplibregl, { type Map, type Marker } from 'maplibre-gl'
import type { DroneRegistry } from '../types/drone'

function createDroneMarkerElement(id: string) {
  const marker = document.createElement('div')
  marker.className = 'drone-marker'
  marker.setAttribute('aria-label', `${id} position`)
  marker.title = id

  const pulse = document.createElement('span')
  pulse.className = 'drone-marker-pulse'
  marker.appendChild(pulse)

  const core = document.createElement('span')
  core.className = 'drone-marker-core'
  marker.appendChild(core)

  return marker
}

interface UseDroneMarkersOptions {
  map: Map | null
  dronesById: DroneRegistry
  dirtyIds: string[]
}

export function useDroneMarkers({
  map,
  dronesById,
  dirtyIds,
}: UseDroneMarkersOptions) {
  const markersRef = useRef<Record<string, Marker>>({})
  const dronesRef = useRef<DroneRegistry>(dronesById)

  useEffect(() => {
    dronesRef.current = dronesById
  }, [dronesById])

  const removeMarker = useCallback((droneId: string) => {
    const marker = markersRef.current[droneId]

    if (!marker) {
      return
    }

    marker.remove()
    delete markersRef.current[droneId]
  }, [])

  const isInCurrentView = useCallback(
    (lat: number, lon: number) => {
      if (!map) {
        return false
      }

      const bounds = map.getBounds()
      return bounds.contains([lon, lat])
    },
    [map],
  )

  const syncMarker = useCallback(
    (droneId: string) => {
      if (!map) {
        return
      }

      const drone = dronesRef.current[droneId]

      if (
        !drone ||
        drone.status !== 'connected' ||
        drone.lat === undefined ||
        drone.lon === undefined ||
        !isInCurrentView(drone.lat, drone.lon)
      ) {
        removeMarker(droneId)
        return
      }

      const position: [number, number] = [drone.lon, drone.lat]
      const currentMarker = markersRef.current[droneId]

      if (currentMarker) {
        currentMarker.setLngLat(position)
        return
      }

      markersRef.current[droneId] = new maplibregl.Marker({
        element: createDroneMarkerElement(droneId),
      })
        .setLngLat(position)
        .setPopup(new maplibregl.Popup({ offset: 12 }).setText(droneId))
        .addTo(map)
    },
    [isInCurrentView, map, removeMarker],
  )

  const refreshVisibleMarkers = useCallback(() => {
    Object.keys(dronesRef.current).forEach(syncMarker)
  }, [syncMarker])

  useEffect(() => {
    if (!map) {
      return
    }

    dirtyIds.forEach(syncMarker)
  }, [dirtyIds, map, syncMarker])

  useEffect(() => {
    if (!map) {
      return
    }

    map.on('moveend', refreshVisibleMarkers)
    map.on('zoomend', refreshVisibleMarkers)
    map.on('load', refreshVisibleMarkers)

    return () => {
      map.off('moveend', refreshVisibleMarkers)
      map.off('zoomend', refreshVisibleMarkers)
      map.off('load', refreshVisibleMarkers)
    }
  }, [map, refreshVisibleMarkers])

  useEffect(() => {
    return () => {
      Object.values(markersRef.current).forEach((marker) => marker.remove())
      markersRef.current = {}
    }
  }, [])
}

