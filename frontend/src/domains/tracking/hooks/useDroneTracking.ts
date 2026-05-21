import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, LineString } from 'geojson'
import maplibregl, {
  type Map,
  type MapMouseEvent,
  type Marker,
} from 'maplibre-gl'
import { saveTrackedRoute } from '../services/routes'
import {
  DRONE_TRACKING_ROUTE_LAYER_ID,
  DRONE_TRACKING_ROUTE_SOURCE_ID,
} from '../../map/layers/droneLayers'
import {
  getSourceSafe,
  mapStyleReady,
  removeLayerSafe,
  removeSourceSafe,
} from '../../map/hooks/useMapSources'
import type {
  SaveTrackedRouteResponse,
  TrackingPoint,
  TrackingRoute,
  TrackingSource,
  TrackingStatus,
} from '../types'

const minDistanceMeters = 2
const minAppendIntervalMs = 150
const maxTrackingPoints = 10_000

export interface TrackingNotice {
  tone: 'info' | 'success' | 'error'
  title: string
  detail?: string
}

interface TrackingPositionSource {
  kind: TrackingSource
  start: (onPosition: (point: TrackingPoint) => void) => void
  stop: () => void
}

interface UseDroneTrackingOptions {
  map: Map | null
  onNotice?: (notice: TrackingNotice) => void
}

interface UseDroneTrackingResult {
  droneId: string | null
  status: TrackingStatus
  points: TrackingPoint[]
  source: TrackingSource
  isSaving: boolean
  canSave: boolean
  maxPoints: number
  startTracking: (droneId: string) => void
  stopTracking: () => void
  clearTracking: () => void
  saveTrackingRoute: () => Promise<SaveTrackedRouteResponse>
}

function createTrackingMarkerElement() {
  const marker = document.createElement('div')
  marker.className = 'drone-tracking-marker'
  marker.setAttribute('aria-label', 'Tracked object position')

  const pulse = document.createElement('span')
  pulse.className = 'drone-tracking-marker-pulse'
  marker.appendChild(pulse)

  const core = document.createElement('span')
  core.className = 'drone-tracking-marker-core'
  marker.appendChild(core)
  return marker
}

function toLineStringFeature(
  points: TrackingPoint[],
  source: TrackingSource,
  droneId: string,
): Feature<LineString> {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: points.map((point) => [point.lng, point.lat]),
    },
    properties: {
      source,
      droneId,
    },
  }
}

function distanceMeters(left: [number, number], right: [number, number]) {
  const radius = 6_371_000
  const lat1 = (left[1] * Math.PI) / 180
  const lat2 = (right[1] * Math.PI) / 180
  const deltaLat = ((right[1] - left[1]) * Math.PI) / 180
  const deltaLng = ((right[0] - left[0]) * Math.PI) / 180
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function shouldAppendPoint(lastPoint: TrackingPoint | undefined, nextPoint: TrackingPoint) {
  if (!lastPoint) {
    return true
  }
  const distance = distanceMeters(
    [lastPoint.lng, lastPoint.lat],
    [nextPoint.lng, nextPoint.lat],
  )
  return distance >= minDistanceMeters
}

function makeRouteName() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mins = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `tracked-route-${yyyy}${mm}${dd}-${hh}${mins}${ss}`
}

function createMouseMapPositionSource(map: Map): TrackingPositionSource {
  let handler: ((event: MapMouseEvent) => void) | null = null
  return {
    kind: 'mouse_simulation',
    start(onPosition) {
      this.stop()
      handler = (event: MapMouseEvent) => {
        onPosition({
          lng: event.lngLat.lng,
          lat: event.lngLat.lat,
          timestamp: Date.now(),
        })
      }
      map.on('mousemove', handler)
    },
    stop() {
      if (handler) {
        map.off('mousemove', handler)
        handler = null
      }
    },
  }
}

export function useDroneTracking({
  map,
  onNotice,
}: UseDroneTrackingOptions): UseDroneTrackingResult {
  const [route, setRoute] = useState<TrackingRoute>({
    name: '',
    status: 'idle',
    droneId: '',
    source: 'mouse_simulation',
    points: [],
  })
  const [isSaving, setIsSaving] = useState(false)
  const markerRef = useRef<Marker | null>(null)
  const positionSourceRef = useRef<TrackingPositionSource | null>(null)
  const routeRef = useRef(route)
  const lastAcceptedTimestampRef = useRef(0)

  useEffect(() => {
    routeRef.current = route
  }, [route])

  const setRouteData = useCallback((points: TrackingPoint[], source: TrackingSource, droneId: string) => {
    if (!map) {
      return
    }
    const sourceRef = getSourceSafe(map, DRONE_TRACKING_ROUTE_SOURCE_ID)
    if (!sourceRef) {
      return
    }
    sourceRef.setData(toLineStringFeature(points, source, droneId))
  }, [map])

  const updateMarker = useCallback((point: TrackingPoint) => {
    if (!map) {
      return
    }
    const position: [number, number] = [point.lng, point.lat]
    if (markerRef.current) {
      markerRef.current.setLngLat(position)
      return
    }
    markerRef.current = new maplibregl.Marker({
      element: createTrackingMarkerElement(),
    })
      .setLngLat(position)
      .addTo(map)
  }, [map])

  const clearMarker = useCallback(() => {
    markerRef.current?.remove()
    markerRef.current = null
  }, [])

  const stopPositionSource = useCallback(() => {
    positionSourceRef.current?.stop()
    positionSourceRef.current = null
  }, [])

  const stopTracking = useCallback(() => {
    if (routeRef.current.status !== 'tracking') {
      return
    }
    stopPositionSource()
    setRoute((current) => ({
      ...current,
      status: current.points.length > 0 ? 'completed' : 'idle',
    }))
  }, [stopPositionSource])

  const clearTracking = useCallback(() => {
    stopPositionSource()
    lastAcceptedTimestampRef.current = 0
    setRoute({
      name: '',
      status: 'idle',
      droneId: routeRef.current.droneId,
      source: routeRef.current.source,
      points: [],
    })
    setRouteData([], routeRef.current.source, routeRef.current.droneId)
    clearMarker()
  }, [clearMarker, setRouteData, stopPositionSource])

  const handleTrackingPositionUpdate = useCallback((point: TrackingPoint) => {
    const currentRoute = routeRef.current
    if (currentRoute.status !== 'tracking') {
      return
    }

    const nowTimestamp = point.timestamp
    const points = currentRoute.points
    if (
      points.length > 0 &&
      nowTimestamp - lastAcceptedTimestampRef.current < minAppendIntervalMs
    ) {
      return
    }

    const lastPoint = points[points.length - 1]
    if (!shouldAppendPoint(lastPoint, point)) {
      return
    }

    const nextPoints = [...points, point]
    const reachedMaxPoints = nextPoints.length >= maxTrackingPoints
    lastAcceptedTimestampRef.current = nowTimestamp

    setRoute((current) => ({
      ...current,
      points: nextPoints,
      status: reachedMaxPoints ? 'completed' : current.status,
    }))
    updateMarker(point)
    setRouteData(nextPoints, currentRoute.source, currentRoute.droneId)

    if (reachedMaxPoints) {
      stopPositionSource()
      onNotice?.({
        tone: 'info',
        title: 'Tracking auto-stopped',
        detail: `Reached the max of ${maxTrackingPoints.toLocaleString()} points.`,
      })
    }
  }, [onNotice, setRouteData, stopPositionSource, updateMarker])

  const startTracking = useCallback((droneId: string) => {
    if (!map) {
      onNotice?.({
        tone: 'error',
        title: 'Map is not ready',
        detail: 'Please wait for the map to finish loading.',
      })
      return
    }
    if (!droneId.trim()) {
      onNotice?.({
        tone: 'error',
        title: 'Drone is not selected',
        detail: 'Select a drone before starting tracking.',
      })
      return
    }

    const currentRoute = routeRef.current
    if (
      currentRoute.status === 'completed' &&
      currentRoute.points.length > 0
    ) {
      const ok = window.confirm('Clear the current tracked route and start a new one?')
      if (!ok) {
        return
      }
    }

    stopPositionSource()
    lastAcceptedTimestampRef.current = 0
    const nextSource = createMouseMapPositionSource(map)
    positionSourceRef.current = nextSource
    setRoute({
      name: makeRouteName(),
      status: 'tracking',
      droneId,
      source: nextSource.kind,
      points: [],
    })
    setRouteData([], nextSource.kind, droneId)
    clearMarker()
    nextSource.start(handleTrackingPositionUpdate)
  }, [clearMarker, handleTrackingPositionUpdate, map, onNotice, setRouteData, stopPositionSource])

  const saveTrackingRoute = useCallback(async () => {
    const currentRoute = routeRef.current
    if (currentRoute.status !== 'completed') {
      throw new Error('Route can only be saved after tracking is completed.')
    }
    if (currentRoute.points.length < 2) {
      throw new Error('Route needs at least 2 points to be saved.')
    }

    setIsSaving(true)
    try {
      const response = await saveTrackedRoute({
        name: currentRoute.name || makeRouteName(),
        droneId: currentRoute.droneId,
        source: currentRoute.source,
        geometry: {
          type: 'LineString',
          coordinates: currentRoute.points.map((point) => [point.lng, point.lat]),
        },
        points: currentRoute.points,
      })
      setRoute((current) => ({
        ...current,
        id: response.route.id,
      }))
      return response
    } finally {
      setIsSaving(false)
    }
  }, [])

  const canSave = useMemo(
    () => route.status === 'completed' && route.points.length >= 2 && !isSaving,
    [isSaving, route.points.length, route.status],
  )

  useEffect(() => {
    if (!map) {
      return
    }

    const ensureTrackingLayer = () => {
      if (!mapStyleReady(map)) {
        return
      }
      if (!map.getSource(DRONE_TRACKING_ROUTE_SOURCE_ID)) {
        map.addSource(DRONE_TRACKING_ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: toLineStringFeature([], routeRef.current.source, routeRef.current.droneId),
        })
      }
      if (!map.getLayer(DRONE_TRACKING_ROUTE_LAYER_ID)) {
        map.addLayer({
          id: DRONE_TRACKING_ROUTE_LAYER_ID,
          type: 'line',
          source: DRONE_TRACKING_ROUTE_SOURCE_ID,
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#00AEEF',
            'line-width': 4,
            'line-opacity': 0.9,
          },
        })
      }
      setRouteData(routeRef.current.points, routeRef.current.source, routeRef.current.droneId)
    }

    const onLoad = () => {
      ensureTrackingLayer()
    }

    if (map.isStyleLoaded()) {
      ensureTrackingLayer()
    } else {
      map.once('load', onLoad)
    }

    return () => {
      map.off('load', onLoad)
      stopPositionSource()
      clearMarker()
      removeLayerSafe(map, DRONE_TRACKING_ROUTE_LAYER_ID)
      removeSourceSafe(map, DRONE_TRACKING_ROUTE_SOURCE_ID)
    }
  }, [clearMarker, map, setRouteData, stopPositionSource])

  return {
    droneId: route.droneId || null,
    status: route.status,
    points: route.points,
    source: route.source,
    isSaving,
    canSave,
    maxPoints: maxTrackingPoints,
    startTracking,
    stopTracking,
    clearTracking,
    saveTrackingRoute,
  }
}
