import { useCallback, useEffect, useRef } from 'react'
import type { Feature, Position } from 'geojson'
import type { Map } from 'maplibre-gl'
import type { DrawingProject, SpatialLayer } from '../types/drone'
import type { SnapPreview } from './useSnapEngine'

export type DrawMode =
  | 'select'
  | 'point'
  | 'line'
  | 'polygon'
  // Indoor tools
  | 'room'
  | 'wall'
  | 'door'
  | 'corridor'
  | 'indoor_route'
  | 'delete'

function pointInRing(point: Position, ring: Position[]) {
  const [x, y] = point
  let inside = false
  let j = ring.length - 1
  for (let i = 0; i < ring.length; i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi
    if (intersects) {
      inside = !inside
    }
    j = i
  }
  return inside
}

function pointInBoundary(point: Position, project: DrawingProject) {
  return project.baseGeometry.coordinates.some((polygon) => {
    const [outer, ...holes] = polygon
    return pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole))
  })
}

interface UseDrawingEngineOptions {
  map: Map | null
  project: DrawingProject | null
  toolsEnabled: boolean
  isMounted: () => boolean
  modeRef: React.RefObject<DrawMode>
  snapPreviewRef: React.RefObject<SnapPreview | null>
  onAddPoint: (updater: (current: Position[]) => Position[]) => void
  onMessage: (msg: string) => void
}

export function useDrawingEngine({
  map,
  project,
  toolsEnabled,
  isMounted,
  modeRef,
  snapPreviewRef,
  onAddPoint,
  onMessage,
}: UseDrawingEngineOptions) {
  const projectRef = useRef(project)
  const toolsEnabledRef = useRef(toolsEnabled)

  useEffect(() => {
    projectRef.current = project
  }, [project])

  useEffect(() => {
    toolsEnabledRef.current = toolsEnabled
  }, [toolsEnabled])

  const handleMapClick = useCallback(
    (event: { lngLat: { lng: number; lat: number } }) => {
      if (!toolsEnabledRef.current) {
        return
      }
      onAddPoint((current) => {
        const currentProject = projectRef.current
        const currentMode = modeRef.current
        if (!currentProject || currentMode === 'select' || currentMode === 'delete') {
          return current
        }
        const point: Position = snapPreviewRef.current?.point ?? [event.lngLat.lng, event.lngLat.lat]
        if (!pointInBoundary(point, currentProject)) {
          if (isMounted()) {
            onMessage('Point rejected: it is outside the locked base boundary')
          }
          return current
        }
        // Single-point modes
        if (currentMode === 'point' || currentMode === 'door') {
          return [point]
        }
        return [...current, point]
      })
    },
    [isMounted, modeRef, onAddPoint, onMessage, snapPreviewRef],
  )

  useEffect(() => {
    if (!map) {
      return
    }
    map.on('click', handleMapClick)
    return () => {
      map.off('click', handleMapClick)
    }
  }, [map, handleMapClick])
}

// --- Shared utility functions for feature creation ---

export const featureTypeGeometry: Record<string, DrawMode> = {
  flight_zone: 'polygon',
  no_fly_zone: 'polygon',
  landing_pad: 'point',
  takeoff_point: 'point',
  waypoint: 'point',
  checkpoint: 'point',
  obstacle: 'polygon',
  crop_area: 'polygon',
  survey_area: 'polygon',
  irrigation_line: 'line',
  road: 'line',
  path: 'line',
  gate: 'point',
  sensor: 'point',
  camera: 'point',
  charging_station: 'point',
  custom_area: 'polygon',
  custom_line: 'line',
  custom_point: 'point',
  building_footprint: 'polygon',
  internal_road: 'line',
  parking_zone: 'polygon',
  outdoor_poi: 'point',
  route: 'line',
  parking_slot: 'polygon',
  entrance: 'point',
  exit: 'point',
  room: 'polygon',
  wall: 'line',
  door: 'line',
  corridor: 'polygon',
  stairs: 'polygon',
  elevator: 'polygon',
  indoor_waypoint: 'point',
  indoor_route: 'line',
  restricted_area: 'polygon',
  poi: 'point',
}

export function draftToFeature(mode: DrawMode, points: Position[], featureType: string): Feature | null {
  // Point-based modes
  if ((mode === 'point' || mode === 'door') && points.length === 1) {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: points[0] },
      properties: { featureType },
    }
  }
  // Line-based modes
  if ((mode === 'line' || mode === 'wall' || mode === 'indoor_route') && points.length >= 2) {
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: points },
      properties: { featureType },
    }
  }
  // Polygon-based modes
  if ((mode === 'polygon' || mode === 'room' || mode === 'corridor') && points.length >= 3) {
    const ring = [...points, points[0]]
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { featureType },
    }
  }
  return null
}

export function activeLayerForProject(layers: SpatialLayer[]): SpatialLayer | null {
  // Prefer a layer that has actual feature types so tools are enabled
  const usable = layers.find((layer) => !layer.locked && (layer.featureTypes?.length ?? 0) > 0)
  if (usable) return usable
  return layers.find((layer) => !layer.locked) ?? null
}

export function layerSupportsMode(layer: SpatialLayer | null, mode: DrawMode) {
  if (!layer || layer.locked) {
    return false
  }
  if (mode === 'select' || mode === 'delete') {
    return true
  }
  const featureTypes = layer.featureTypes ?? []
  // Map indoor modes to their underlying geometry modes for compatibility
  const geometryMode = indoorModeToGeometry(mode)
  return featureTypes.some((featureType) => featureTypeGeometry[featureType] === geometryMode)
}

function indoorModeToGeometry(mode: DrawMode): DrawMode {
  switch (mode) {
    case 'room':
    case 'corridor':
      return 'polygon'
    case 'wall':
    case 'indoor_route':
      return 'line'
    case 'door':
      return 'point'
    default:
      return mode
  }
}

export function featureTypeForLayer(layer: SpatialLayer | null, mode: DrawMode) {
  // Indoor modes map directly to their feature type name
  const indoorModeFeatureType: Partial<Record<DrawMode, string>> = {
    room: 'room',
    wall: 'wall',
    door: 'door',
    corridor: 'corridor',
    indoor_route: 'indoor_route',
  }
  const directMapping = indoorModeFeatureType[mode]
  if (directMapping) {
    return directMapping
  }
  if (!layer) {
    return mode === 'polygon' ? 'custom_area' : mode === 'line' ? 'custom_line' : 'custom_point'
  }
  const geometryMode = indoorModeToGeometry(mode)
  return (
    layer.featureTypes?.find((featureType) => featureTypeGeometry[featureType] === geometryMode) ??
    (mode === 'polygon' ? 'custom_area' : mode === 'line' ? 'custom_line' : 'custom_point')
  )
}

// --- Measurement utilities ---

function distanceMeters(left: Position, right: Position) {
  const radius = 6_371_000
  const lat1 = (left[1] * Math.PI) / 180
  const lat2 = (right[1] * Math.PI) / 180
  const deltaLat = ((right[1] - left[1]) * Math.PI) / 180
  const deltaLng = ((right[0] - left[0]) * Math.PI) / 180
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(meters: number) {
  if (meters < 1) return `${Math.round(meters * 100)} cm`
  if (meters < 1000) return `${meters.toFixed(1)} m`
  return `${(meters / 1000).toFixed(2)} km`
}

function formatArea(squareMeters: number) {
  if (squareMeters < 1_000_000) return `${squareMeters.toFixed(1)} m²`
  return `${(squareMeters / 1_000_000).toFixed(3)} km²`
}

function polygonAreaMeters(ring: Position[]) {
  if (ring.length < 4) return 0
  const meanLat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length
  const metersPerLng = 111_320 * Math.cos((meanLat * Math.PI) / 180)
  const metersPerLat = 110_540
  let area = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index]
    const [x2, y2] = ring[index + 1]
    area += x1 * metersPerLng * y2 * metersPerLat
    area -= x2 * metersPerLng * y1 * metersPerLat
  }
  return Math.abs(area / 2)
}

export function featureMeasurement(feature: Feature | null) {
  if (!feature) return 'No draft feature'
  if (feature.geometry.type === 'Point') {
    const [lng, lat] = feature.geometry.coordinates
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
  }
  if (feature.geometry.type === 'LineString') {
    const coordinates = feature.geometry.coordinates
    const meters = coordinates.reduce((sum, point, index) => {
      if (index === 0) return sum
      return sum + distanceMeters(coordinates[index - 1], point)
    }, 0)
    return `Length ${formatDistance(meters)}`
  }
  if (feature.geometry.type === 'Polygon') {
    const ring = feature.geometry.coordinates[0]
    const perimeter = ring.reduce((sum, point, index) => {
      if (index === 0) return sum
      return sum + distanceMeters(ring[index - 1], point)
    }, 0)
    return `Area ${formatArea(polygonAreaMeters(ring))} · Perimeter ${formatDistance(perimeter)}`
  }
  return 'Unsupported geometry'
}

export function localCoordinates(point: Position, origin: Position) {
  const meanLat = (point[1] + origin[1]) / 2
  const metersPerLng = 111_320 * Math.cos((meanLat * Math.PI) / 180)
  const metersPerLat = 110_540
  return {
    x: (point[0] - origin[0]) * metersPerLng,
    y: (point[1] - origin[1]) * metersPerLat,
  }
}
