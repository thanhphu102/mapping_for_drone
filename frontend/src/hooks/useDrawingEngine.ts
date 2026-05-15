import { useCallback, useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, Position } from 'geojson'
import type { Map } from 'maplibre-gl'
import type { DrawingProject, SpatialLayer } from '../types/drone'
import type { SnapPreview } from './useSnapEngine'

export type DrawMode =
  | 'select'
  | 'point'
  | 'line'
  | 'polygon'
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
  draftPointsRef: React.RefObject<Position[]>
  onAddPoint: (updater: (current: Position[]) => Position[]) => void
  onSaveDraft: () => void
  onMessage: (msg: string) => void
}

export function useDrawingEngine({
  map,
  project,
  toolsEnabled,
  isMounted,
  modeRef,
  snapPreviewRef,
  draftPointsRef,
  onAddPoint,
  onSaveDraft,
  onMessage,
}: UseDrawingEngineOptions) {
  const projectRef = useRef(project)
  const toolsEnabledRef = useRef(toolsEnabled)
  const onSaveDraftRef = useRef(onSaveDraft)

  useEffect(() => {
    projectRef.current = project
  }, [project])

  useEffect(() => {
    toolsEnabledRef.current = toolsEnabled
  }, [toolsEnabled])

  useEffect(() => {
    onSaveDraftRef.current = onSaveDraft
  }, [onSaveDraft])

  const handleMapClick = useCallback(
    (event: any) => {
      if (!toolsEnabledRef.current || !map) {
        return
      }

      // Do not add a point if we clicked on an existing vertex
      const features = map.queryRenderedFeatures(event.point, { layers: ['draft-feature-vertex'] })
      if (features.length > 0) {
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
    [isMounted, modeRef, onAddPoint, onMessage, snapPreviewRef, map],
  )

  useEffect(() => {
    if (!map) return

    let draggingIndex: number | null = null

    const handleMouseDown = (e: any) => {
      if (!toolsEnabledRef.current) return
      const currentPoints = draftPointsRef.current ?? []
      if (currentPoints.length === 0) return

      let closestIndex = -1
      let minDist = Infinity
      currentPoints.forEach((pt, i) => {
        const screenPt = map.project(pt as any)
        const dist = Math.hypot(screenPt.x - e.point.x, screenPt.y - e.point.y)
        if (dist < 15) {
          if (dist < minDist) {
            minDist = dist
            closestIndex = i
          }
        }
      })

      if (closestIndex === -1) return

      if (e.originalEvent.altKey || e.originalEvent.button === 2) {
        e.preventDefault()
        onAddPoint((cur) => cur.filter((_, idx) => idx !== closestIndex))
        return
      }

      if (e.originalEvent.button === 0) {
        e.preventDefault()
        draggingIndex = closestIndex
        map.getCanvas().style.cursor = 'grabbing'
        map.dragPan.disable()
      }
    }

    const handleMouseMove = (e: any) => {
      if (draggingIndex !== null) {
        const point: Position = snapPreviewRef.current?.point ?? [e.lngLat.lng, e.lngLat.lat]
        onAddPoint((cur) => {
          const next = [...cur]
          next[draggingIndex!] = point
          return next
        })
      }
    }

    const handleMouseUp = () => {
      if (draggingIndex !== null) {
        draggingIndex = null
        map.getCanvas().style.cursor = ''
        map.dragPan.enable()
      }
    }

    const handleContextMenu = (e: any) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['draft-feature-vertex'] })
      if (features.length > 0) {
        e.preventDefault()
      }
    }

    const handleDblClick = (e: any) => {
      if (!toolsEnabledRef.current || modeRef.current === 'select' || modeRef.current === 'delete') return
      e.preventDefault()
      onSaveDraftRef.current()
    }

    map.on('click', handleMapClick)
    map.on('mousedown', 'draft-feature-vertex', handleMouseDown)
    map.on('mousemove', handleMouseMove)
    map.on('mouseup', handleMouseUp)
    map.on('contextmenu', handleContextMenu)
    map.on('dblclick', handleDblClick)

    map.doubleClickZoom.disable()

    return () => {
      map.off('click', handleMapClick)
      map.off('mousedown', 'draft-feature-vertex', handleMouseDown)
      map.off('mousemove', handleMouseMove)
      map.off('mouseup', handleMouseUp)
      map.off('contextmenu', handleContextMenu)
      map.off('dblclick', handleDblClick)
      map.doubleClickZoom.enable()
    }
  }, [map, handleMapClick, onAddPoint, draftPointsRef, snapPreviewRef, modeRef])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!toolsEnabledRef.current || modeRef.current === 'select' || modeRef.current === 'delete') return

      if (e.key === 'Enter') {
        e.preventDefault()
        onSaveDraftRef.current()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onAddPoint(() => [])
      } else if (e.key === 'Backspace' || e.key === 'Delete' || (e.ctrlKey && e.key === 'z') || (e.metaKey && e.key === 'z')) {
        e.preventDefault()
        onAddPoint((cur) => cur.slice(0, -1))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onAddPoint, modeRef])
}

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

export function draftToFeatures(
  mode: DrawMode,
  points: Position[],
  featureType: string,
  hoverCoordinate: Position | null
): FeatureCollection | null {
  if (points.length === 0) return null

  const features: Feature[] = []
  
  features.push({
    type: 'Feature',
    geometry: { type: 'MultiPoint', coordinates: points },
    properties: { featureType, isDraftVertex: true },
  })

  const previewPoints = [...points]
  if (hoverCoordinate && !['point', 'door'].includes(mode)) {
    previewPoints.push(hoverCoordinate)
  }

  if (['point', 'door'].includes(mode)) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: previewPoints[0] },
      properties: { featureType },
    })
  } else if (['line', 'wall', 'indoor_route'].includes(mode)) {
    if (previewPoints.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: previewPoints },
        properties: { featureType },
      })
    }
  } else if (['polygon', 'room', 'corridor'].includes(mode)) {
    if (previewPoints.length >= 3) {
      const ring = [...previewPoints, previewPoints[0]]
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { featureType },
      })
    } else if (previewPoints.length === 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: previewPoints },
        properties: { featureType },
      })
    }
  }

  return { type: 'FeatureCollection', features }
}

export function activeLayerForProject(layers: SpatialLayer[]): SpatialLayer | null {
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
  if (!layer) {
    return mode === 'polygon' ? 'custom_area' : mode === 'line' ? 'custom_line' : 'custom_point'
  }
  return (
    layer.featureTypes?.find((featureType) => featureTypeGeometry[featureType] === mode) ??
    (mode === 'polygon' ? 'custom_area' : mode === 'line' ? 'custom_line' : 'custom_point')
  )
}

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

export function featureMeasurement(draftCollection: FeatureCollection | null) {
  if (!draftCollection) return 'No draft feature'
  const feature = draftCollection.features.find(f => !f.properties?.isDraftVertex && (f.geometry.type === 'Polygon' || f.geometry.type === 'LineString')) || draftCollection.features[0]
  if (!feature) return 'No draft feature'
  if (feature.geometry.type === 'Point') {
    const [lng, lat] = feature.geometry.coordinates as Position
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
  }
  if (feature.geometry.type === 'LineString') {
    const coordinates = feature.geometry.coordinates as Position[]
    const meters = coordinates.reduce((sum, point, index) => {
      if (index === 0) return sum
      return sum + distanceMeters(coordinates[index - 1], point)
    }, 0)
    return `Length ${formatDistance(meters)}`
  }
  if (feature.geometry.type === 'Polygon') {
    const ring = (feature.geometry.coordinates as Position[][])[0]
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
