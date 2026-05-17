import { useCallback, useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { Map, MapMouseEvent } from 'maplibre-gl'
import type { DrawingProject } from '../types/drone'
import type { SnapPreview } from './useSnapEngine'

const featureLayers = ['project-features-fill', 'project-features-line', 'project-features-point']

export type DrawMode =
  | 'select'
  | 'move'
  | 'text'
  | 'pen'
  | 'point'
  | 'line'
  | 'polygon'
  | 'rectangle'
  | 'ellipse'
  | 'square'
  | 'triangle'
  | 'room'
  | 'wall'
  | 'door'
  | 'corridor'
  | 'indoor_route'
  | 'delete_lasso'

function pointInRing(point: Position, ring: Position[]) {
  const [x, y] = point
  let inside = false
  let j = ring.length - 1
  for (let i = 0; i < ring.length; i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi
    if (intersects) inside = !inside
    j = i
  }
  return inside
}

function pointOnSegment(map: Map, point: Position, start: Position, end: Position, tolerancePx = 6) {
  const projectedPoint = map.project({ lng: point[0], lat: point[1] })
  const projectedStart = map.project({ lng: start[0], lat: start[1] })
  const projectedEnd = map.project({ lng: end[0], lat: end[1] })
  const dx = projectedEnd.x - projectedStart.x
  const dy = projectedEnd.y - projectedStart.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 1e-9) {
    return Math.hypot(projectedPoint.x - projectedStart.x, projectedPoint.y - projectedStart.y) <= tolerancePx
  }

  const t =
    ((projectedPoint.x - projectedStart.x) * dx + (projectedPoint.y - projectedStart.y) * dy) / lengthSquared
  if (t < 0 || t > 1) {
    return false
  }

  const nearestX = projectedStart.x + t * dx
  const nearestY = projectedStart.y + t * dy
  return Math.hypot(projectedPoint.x - nearestX, projectedPoint.y - nearestY) <= tolerancePx
}

function pointOnRing(map: Map, point: Position, ring: Position[]) {
  for (let index = 1; index < ring.length; index += 1) {
    if (pointOnSegment(map, point, ring[index - 1], ring[index])) {
      return true
    }
  }
  return false
}

function pointInBoundary(point: Position, project: DrawingProject, map: Map | null) {
  if (!map) {
    return false
  }
  return project.baseGeometry.coordinates.some((polygon) => {
    const [outer, ...holes] = polygon
    const insideOuter = pointInRing(point, outer) || pointOnRing(map, point, outer)
    if (!insideOuter) {
      return false
    }
    return !holes.some((hole) => pointInRing(point, hole) || pointOnRing(map, point, hole))
  })
}

function translatePosition([lng, lat]: Position, deltaLng: number, deltaLat: number): Position {
  return [lng + deltaLng, lat + deltaLat]
}

function translateGeometry(geometry: Geometry, deltaLng: number, deltaLat: number): Geometry {
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates
    return { ...geometry, coordinates: [lng + deltaLng, lat + deltaLat] }
  }
  if (geometry.type === 'LineString') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((position) => translatePosition(position, deltaLng, deltaLat)),
    }
  }
  if (geometry.type === 'MultiLineString') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((line) =>
        line.map((position) => translatePosition(position, deltaLng, deltaLat)),
      ),
    }
  }
  if (geometry.type === 'Polygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((ring) =>
        ring.map((position) => translatePosition(position, deltaLng, deltaLat)),
      ),
    }
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) => ring.map((position) => translatePosition(position, deltaLng, deltaLat))),
      ),
    }
  }
  if (geometry.type === 'MultiPoint') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((position) => translatePosition(position, deltaLng, deltaLat)),
    }
  }
  if (geometry.type === 'GeometryCollection') {
    return {
      ...geometry,
      geometries: geometry.geometries.map((child) => translateGeometry(child, deltaLng, deltaLat)),
    }
  }
  return geometry
}

interface UseDrawingEngineOptions {
  map: Map | null
  project: DrawingProject | null
  toolsEnabled: boolean
  isMounted: () => boolean
  modeRef: React.RefObject<DrawMode>
  snapPreviewRef: React.RefObject<SnapPreview | null>
  selectedFeatureIdsRef: React.RefObject<string[]>
  onAddPoint: (updater: (current: Position[]) => Position[]) => void
  onSaveDraft: () => void
  onMessage: (msg: string) => void
  onSetSelection: (featureIds: string[]) => void
  onDeleteFeatures?: (featureIds: string[]) => void
  onMoveFeatures?: (featureIds: string[], deltaLng: number, deltaLat: number) => void
  onMoveEnd?: (featureIds: string[]) => void
  onQuickCreateTextBox?: (start: Position, end: Position) => void
  onCompleteBoxShape?: (mode: 'rectangle' | 'square' | 'triangle' | 'ellipse', start: Position, end: Position) => void
  onCompletePenPath?: (points: Position[]) => void
  onCompleteLasso?: (start: Position, end: Position) => void
}

export function useDrawingEngine({
  map,
  project,
  toolsEnabled,
  isMounted,
  modeRef,
  snapPreviewRef,
  selectedFeatureIdsRef,
  onAddPoint,
  onSaveDraft,
  onMessage,
  onSetSelection,
  onDeleteFeatures,
  onMoveFeatures,
  onMoveEnd,
  onQuickCreateTextBox,
  onCompleteBoxShape,
  onCompletePenPath,
  onCompleteLasso,
}: UseDrawingEngineOptions) {
  const projectRef = useRef(project)
  const toolsEnabledRef = useRef(toolsEnabled)
  const onSaveDraftRef = useRef(onSaveDraft)
  const onSetSelectionRef = useRef(onSetSelection)
  const onDeleteFeaturesRef = useRef(onDeleteFeatures)
  const onMoveFeaturesRef = useRef(onMoveFeatures)
  const onMoveEndRef = useRef(onMoveEnd)
  const onQuickCreateTextBoxRef = useRef(onQuickCreateTextBox)
  const onCompleteBoxShapeRef = useRef(onCompleteBoxShape)
  const onCompletePenPathRef = useRef(onCompletePenPath)
  const onCompleteLassoRef = useRef(onCompleteLasso)
  const boxStartRef = useRef<{ x: number; y: number } | null>(null)
  const movingFeaturesRef = useRef<{ featureIds: string[]; lastLng: number; lastLat: number; moved: boolean } | null>(null)
  const boxShapeStartRef = useRef<Position | null>(null)
  const freehandStartedRef = useRef(false)
  const freehandPointsRef = useRef<Position[]>([])
  const lassoStartedRef = useRef(false)
  const lassoStartRef = useRef<Position | null>(null)

  useEffect(() => {
    projectRef.current = project
  }, [project])

  useEffect(() => {
    toolsEnabledRef.current = toolsEnabled
  }, [toolsEnabled])

  useEffect(() => {
    onSaveDraftRef.current = onSaveDraft
  }, [onSaveDraft])

  useEffect(() => {
    onSetSelectionRef.current = onSetSelection
  }, [onSetSelection])

  useEffect(() => {
    onDeleteFeaturesRef.current = onDeleteFeatures
  }, [onDeleteFeatures])

  useEffect(() => {
    onMoveFeaturesRef.current = onMoveFeatures
  }, [onMoveFeatures])

  useEffect(() => {
    onMoveEndRef.current = onMoveEnd
  }, [onMoveEnd])

  useEffect(() => {
    onQuickCreateTextBoxRef.current = onQuickCreateTextBox
  }, [onQuickCreateTextBox])

  useEffect(() => {
    onCompleteBoxShapeRef.current = onCompleteBoxShape
  }, [onCompleteBoxShape])

  useEffect(() => {
    onCompletePenPathRef.current = onCompletePenPath
  }, [onCompletePenPath])

  useEffect(() => {
    onCompleteLassoRef.current = onCompleteLasso
  }, [onCompleteLasso])

  const suppressClickRef = useRef(false)
  const constrainSquareByPixels = useCallback((start: Position, rawEnd: Position): Position => {
    if (!map) return rawEnd
    const startPx = map.project([start[0], start[1]])
    const endPx = map.project([rawEnd[0], rawEnd[1]])
    const dx = endPx.x - startPx.x
    const dy = endPx.y - startPx.y
    const side = Math.min(Math.abs(dx), Math.abs(dy))
    const constrainedPx = {
      x: startPx.x + Math.sign(dx || 1) * side,
      y: startPx.y + Math.sign(dy || 1) * side,
    }
    const unprojected = map.unproject([constrainedPx.x, constrainedPx.y])
    return [unprojected.lng, unprojected.lat]
  }, [map])

  const handleMapClick = useCallback(
    (event: MapMouseEvent) => {
      if (!toolsEnabledRef.current || !map) return
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }

      const currentMode = modeRef.current
      const featureHits = map.queryRenderedFeatures(event.point, { layers: featureLayers })
      const firstFeature = featureHits.find((f) => f.id || f.properties?.id)
      const firstId = firstFeature?.id ?? firstFeature?.properties?.id

      if (currentMode === 'move') {
        return
      }

      if (currentMode === 'select') {
        if (firstId) {
          if (event.originalEvent?.shiftKey) {
            const currentIds = selectedFeatureIdsRef.current ?? []
            const nextIds = currentIds.includes(String(firstId))
              ? currentIds.filter((id) => id !== String(firstId))
              : [...currentIds, String(firstId)]
            onSetSelectionRef.current(nextIds)
          } else {
            onSetSelectionRef.current([String(firstId)])
          }
        } else if (!event.originalEvent?.shiftKey) {
          onSetSelectionRef.current([])
        }
        return
      }

      onAddPoint((current) => {
        const currentProject = projectRef.current
        const draftMode = modeRef.current
        if (!currentProject || draftMode === 'select' || draftMode === 'move') return current
        const point: Position = snapPreviewRef.current?.point ?? [event.lngLat.lng, event.lngLat.lat]
        if (!pointInBoundary(point, currentProject, map)) {
          if (isMounted()) onMessage('Point rejected: it is outside the locked base boundary')
          return current
        }
        if (draftMode === 'point' || draftMode === 'door') return [point]
        if (draftMode === 'rectangle' || draftMode === 'square' || draftMode === 'triangle' || draftMode === 'ellipse' || draftMode === 'text') {
          if (current.length === 0) return [point]
          return [current[0], point]
        }
        return [...current, point]
      })
    },
    [isMounted, modeRef, onAddPoint, onMessage, snapPreviewRef, map, selectedFeatureIdsRef],
  )

  useEffect(() => {
    if (!map) return

    const setCursor = (value: string) => {
      map.getCanvas().style.cursor = value
    }

    const handleMouseDown = (e: MapMouseEvent) => {
      if (!toolsEnabledRef.current) return
      const mode = modeRef.current

      if (mode === 'rectangle' || mode === 'square' || mode === 'triangle' || mode === 'ellipse' || mode === 'text') {
        if (e.originalEvent.button !== 0) return
        const start: Position = [e.lngLat.lng, e.lngLat.lat]
        boxShapeStartRef.current = start
        onAddPoint(() => [start, start])
        map.dragPan.disable()
        setCursor('crosshair')
        return
      }

      if (mode === 'pen') {
        if (e.originalEvent.button !== 0) return
        const start: Position = [e.lngLat.lng, e.lngLat.lat]
        const currentProject = projectRef.current
        if (!currentProject || !pointInBoundary(start, currentProject, map)) {
          if (isMounted()) onMessage('Point rejected: it is outside the locked base boundary')
          return
        }
        freehandPointsRef.current = [start]
        onAddPoint(() => [start])
        freehandStartedRef.current = true
        map.dragPan.disable()
        setCursor('crosshair')
        return
      }

      if (mode === 'delete_lasso') {
        if (e.originalEvent.button !== 0) return
        const start: Position = [e.lngLat.lng, e.lngLat.lat]
        lassoStartRef.current = start
        onAddPoint(() => [start, start])
        lassoStartedRef.current = true
        map.dragPan.disable()
        setCursor('crosshair')
        return
      }

      if (mode === 'move') {
        setCursor('grab')
        return
      }

      if (mode === 'select' && e.originalEvent?.shiftKey) {
        boxStartRef.current = { x: e.point.x, y: e.point.y }
        setCursor('crosshair')
        return
      }

      if (mode === 'select') {
        const featureHits = map.queryRenderedFeatures(e.point, { layers: featureLayers })
        const firstFeature = featureHits.find((feature) => feature.id || feature.properties?.id)
        const firstId = String(firstFeature?.id ?? firstFeature?.properties?.id ?? '')
        if (firstId) {
          const currentSelection = selectedFeatureIdsRef.current ?? []
          const featureIds = currentSelection.includes(firstId) ? currentSelection : [firstId]
          onSetSelectionRef.current(featureIds)
          movingFeaturesRef.current = {
            featureIds,
            lastLng: e.lngLat.lng,
            lastLat: e.lngLat.lat,
            moved: false,
          }
          map.dragPan.disable()
          setCursor('grabbing')
          return
        }
      }

    }

    const handleMouseMove = (e: MapMouseEvent) => {
      if (boxShapeStartRef.current && ['rectangle', 'square', 'triangle', 'ellipse', 'text'].includes(modeRef.current)) {
        const rawEnd: Position = [e.lngLat.lng, e.lngLat.lat]
        const mode = modeRef.current
        const shiftPressed = Boolean(e.originalEvent?.shiftKey)
        const end: Position =
          (mode === 'rectangle' || mode === 'ellipse' || mode === 'text') && shiftPressed
            ? constrainSquareByPixels(boxShapeStartRef.current, rawEnd)
            : rawEnd
        onAddPoint(() => [boxShapeStartRef.current!, end])
        return
      }

      if (lassoStartedRef.current && modeRef.current === 'delete_lasso') {
        const point: Position = [e.lngLat.lng, e.lngLat.lat]
        onAddPoint(() => [lassoStartRef.current ?? point, point])
        return
      }

      if (freehandStartedRef.current && modeRef.current === 'pen') {
        const point: Position = [e.lngLat.lng, e.lngLat.lat]
        const currentProject = projectRef.current
        if (!currentProject || !pointInBoundary(point, currentProject, map)) {
          return
        }
        onAddPoint((cur) => {
          if (cur.length === 0) return [point]
          const last = cur[cur.length - 1]
          const d = Math.hypot(point[0] - last[0], point[1] - last[1])
          if (d < 0.00001) return cur
          freehandPointsRef.current = [...cur, point]
          return [...cur, point]
        })
        return
      }

      if (movingFeaturesRef.current && onMoveFeaturesRef.current) {
        const deltaLng = e.lngLat.lng - movingFeaturesRef.current.lastLng
        const deltaLat = e.lngLat.lat - movingFeaturesRef.current.lastLat
        if (Math.abs(deltaLng) > 0 || Math.abs(deltaLat) > 0) {
          onMoveFeaturesRef.current(movingFeaturesRef.current.featureIds, deltaLng, deltaLat)
          movingFeaturesRef.current.lastLng = e.lngLat.lng
          movingFeaturesRef.current.lastLat = e.lngLat.lat
          movingFeaturesRef.current.moved = true
        }
        return
      }

    }

    const handleMouseUp = (e: MapMouseEvent) => {
      if (movingFeaturesRef.current) {
        const movedFeatureIds = movingFeaturesRef.current.featureIds
        const didMove = movingFeaturesRef.current.moved
        movingFeaturesRef.current = null
        setCursor('')
        map.dragPan.disable()
        if (didMove) {
          suppressClickRef.current = true
          onMoveEndRef.current?.(movedFeatureIds)
        }
      }

      if (boxShapeStartRef.current && ['rectangle', 'square', 'triangle', 'ellipse', 'text'].includes(modeRef.current)) {
        const start = boxShapeStartRef.current
        boxShapeStartRef.current = null
        setCursor('')
        map.dragPan.disable()
        suppressClickRef.current = true
        const rawEnd: Position = [e.lngLat.lng, e.lngLat.lat]
        const mode = modeRef.current
        const shiftPressed = Boolean(e.originalEvent?.shiftKey)
        const end: Position =
          (mode === 'rectangle' || mode === 'ellipse' || mode === 'text') && shiftPressed
            ? constrainSquareByPixels(start, rawEnd)
            : rawEnd
        const d = Math.hypot(end[0] - start[0], end[1] - start[1])
        if (d > 0.000001) {
          onAddPoint(() => [start, end])
          if (mode === 'text') {
            onQuickCreateTextBoxRef.current?.(start, end)
            onAddPoint(() => [])
          } else if (mode === 'rectangle' || mode === 'square' || mode === 'triangle' || mode === 'ellipse') {
            onCompleteBoxShapeRef.current?.(mode, start, end)
            onAddPoint(() => [])
          }
        } else {
          onAddPoint(() => [])
        }
      }

      if (freehandStartedRef.current && modeRef.current === 'pen') {
        freehandStartedRef.current = false
        setCursor('')
        map.dragPan.disable()
        suppressClickRef.current = true
        if (freehandPointsRef.current.length >= 2) {
          onCompletePenPathRef.current?.(freehandPointsRef.current)
          onAddPoint(() => [])
        }
        freehandPointsRef.current = []
      }

      if (lassoStartedRef.current && modeRef.current === 'delete_lasso') {
        lassoStartedRef.current = false
        setCursor('')
        map.dragPan.disable()
        suppressClickRef.current = true
        const start = lassoStartRef.current ?? [e.lngLat.lng, e.lngLat.lat]
        const end: Position = [e.lngLat.lng, e.lngLat.lat]
        lassoStartRef.current = null
        onAddPoint(() => [start, end])
        onCompleteLassoRef.current?.(start, end)
      }

      if (boxStartRef.current) {
        const minX = Math.min(boxStartRef.current.x, e.point.x)
        const minY = Math.min(boxStartRef.current.y, e.point.y)
        const maxX = Math.max(boxStartRef.current.x, e.point.x)
        const maxY = Math.max(boxStartRef.current.y, e.point.y)
        const hits = map.queryRenderedFeatures(
          [
            [minX, minY],
            [maxX, maxY],
          ],
          { layers: featureLayers },
        )
        const uniqueIds = Array.from(
          new Set(hits.map((f) => String(f.id ?? f.properties?.id ?? '')).filter(Boolean)),
        )
        onSetSelectionRef.current(uniqueIds)
        boxStartRef.current = null
        setCursor('')
      }
    }

    const handleContextMenu = (e: MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: featureLayers })
      const first = hits.find((f) => f.id || f.properties?.id)
      const firstId = first?.id ?? first?.properties?.id
      if (firstId && onDeleteFeaturesRef.current) {
        e.preventDefault()
        onDeleteFeaturesRef.current([String(firstId)])
        return
      }

    }

    const handleDblClick = (e: MapMouseEvent) => {
      const mode = modeRef.current
      if (!toolsEnabledRef.current || ['select', 'move', 'text', 'delete_lasso'].includes(mode)) return
      e.preventDefault()
      onSaveDraftRef.current()
    }

    map.on('click', handleMapClick)
    map.on('mousedown', handleMouseDown)
    map.on('mousemove', handleMouseMove)
    map.on('mouseup', handleMouseUp)
    map.on('contextmenu', handleContextMenu)
    map.on('dblclick', handleDblClick)

    map.doubleClickZoom.disable()

    return () => {
      map.off('click', handleMapClick)
      map.off('mousedown', handleMouseDown)
      map.off('mousemove', handleMouseMove)
      map.off('mouseup', handleMouseUp)
      map.off('contextmenu', handleContextMenu)
      map.off('dblclick', handleDblClick)
      map.doubleClickZoom.enable()
    }
  }, [map, handleMapClick, onAddPoint, modeRef, selectedFeatureIdsRef, constrainSquareByPixels])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!toolsEnabledRef.current) return

      if (e.key === 'Enter' && !['select', 'move', 'text'].includes(modeRef.current)) {
        e.preventDefault()
        onSaveDraftRef.current()
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        onAddPoint(() => [])
        onSetSelection([])
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selected = selectedFeatureIdsRef.current ?? []
        if (selected.length > 0 && onDeleteFeatures) {
          e.preventDefault()
          onDeleteFeatures(selected)
          return
        }
        if (!['select', 'move', 'text'].includes(modeRef.current)) {
          e.preventDefault()
          onAddPoint((cur) => cur.slice(0, -1))
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!['select', 'move', 'text'].includes(modeRef.current)) {
          e.preventDefault()
          onAddPoint((cur) => cur.slice(0, -1))
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onAddPoint, modeRef, onDeleteFeatures, onSetSelection, selectedFeatureIdsRef])
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
  text_label: 'text',
  pen_path: 'pen',
}

export function draftToFeatures(
  mode: DrawMode,
  points: Position[],
  featureType: string,
  hoverCoordinate: Position | null,
  map: Map | null = null,
): FeatureCollection | null {
  if (points.length === 0) return null

  const features: Feature[] = []
  features.push({
    type: 'Feature',
    geometry: { type: 'MultiPoint', coordinates: points },
    properties: { featureType, isDraftVertex: true },
  })

  const previewPoints = [...points]
  if (
    hoverCoordinate &&
    !['point', 'door', 'rectangle', 'square', 'triangle', 'ellipse', 'text', 'delete_lasso', 'pen'].includes(mode)
  ) {
    previewPoints.push(hoverCoordinate)
  }

  if (['point', 'door'].includes(mode)) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: previewPoints[0] },
      properties: { featureType },
    })
  } else if (['line', 'wall', 'indoor_route', 'pen'].includes(mode)) {
    if (previewPoints.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: previewPoints },
        properties: { featureType },
      })
    }
  } else if (['rectangle', 'square', 'triangle', 'ellipse', 'text'].includes(mode)) {
    if (previewPoints.length >= 2) {
      const [start, end] = [previewPoints[0], previewPoints[previewPoints.length - 1]]
      const lngDelta = end[0] - start[0]
      const latDelta = end[1] - start[1]
      if (mode === 'triangle') {
        const apex: Position = [start[0] + lngDelta / 2, start[1]]
        const left: Position = [start[0], end[1]]
        const right: Position = [end[0], end[1]]
        const ring: Position[] = [apex, right, left, apex]
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: { featureType },
        })
      } else if (mode === 'ellipse') {
        const segments = 40
        const ring: Position[] = []
        if (map) {
          const startPx = map.project([start[0], start[1]])
          const endPx = map.project([end[0], end[1]])
          const centerPxX = (startPx.x + endPx.x) / 2
          const centerPxY = (startPx.y + endPx.y) / 2
          const radiusPxX = Math.abs(endPx.x - startPx.x) / 2
          const radiusPxY = Math.abs(endPx.y - startPx.y) / 2
          for (let i = 0; i <= segments; i += 1) {
            const angle = (i / segments) * Math.PI * 2
            const pxX = centerPxX + Math.cos(angle) * radiusPxX
            const pxY = centerPxY + Math.sin(angle) * radiusPxY
            const lngLat = map.unproject([pxX, pxY])
            ring.push([lngLat.lng, lngLat.lat])
          }
        } else {
          const center: Position = [start[0] + lngDelta / 2, start[1] + latDelta / 2]
          const radiusLng = Math.abs(lngDelta) / 2
          const radiusLat = Math.abs(latDelta) / 2
          for (let i = 0; i <= segments; i += 1) {
            const angle = (i / segments) * Math.PI * 2
            ring.push([
              center[0] + Math.cos(angle) * radiusLng,
              center[1] + Math.sin(angle) * radiusLat,
            ])
          }
        }
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: { featureType },
        })
      } else if (mode === 'text') {
        const p1: Position = [start[0], start[1]]
        const p2: Position = [end[0], start[1]]
        const p3: Position = [end[0], end[1]]
        const p4: Position = [start[0], end[1]]
        const ring: Position[] = [p1, p2, p3, p4, p1]
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: { featureType },
        })
      } else {
        const normalizedEnd: Position =
          mode === 'square'
            ? [
                start[0] + Math.sign(lngDelta || 1) * Math.min(Math.abs(lngDelta), Math.abs(latDelta)),
                start[1] + Math.sign(latDelta || 1) * Math.min(Math.abs(lngDelta), Math.abs(latDelta)),
              ]
            : end
        const p1: Position = [start[0], start[1]]
        const p2: Position = [normalizedEnd[0], start[1]]
        const p3: Position = [normalizedEnd[0], normalizedEnd[1]]
        const p4: Position = [start[0], normalizedEnd[1]]
        const ring: Position[] = [p1, p2, p3, p4, p1]
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: { featureType },
        })
      }
    }
  } else if (mode === 'delete_lasso') {
    if (previewPoints.length >= 2) {
      const [start, end] = [previewPoints[0], previewPoints[previewPoints.length - 1]]
      const p1: Position = [start[0], start[1]]
      const p2: Position = [end[0], start[1]]
      const p3: Position = [end[0], end[1]]
      const p4: Position = [start[0], end[1]]
      const ring: Position[] = [p1, p2, p3, p4, p1]
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
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

export function featureTypeForMode(mode: DrawMode) {
  if (mode === 'delete_lasso') return 'custom_area'
  switch (mode) {
    case 'room':
      return 'room'
    case 'wall':
      return 'wall'
    case 'door':
      return 'door'
    case 'corridor':
      return 'corridor'
    case 'indoor_route':
      return 'indoor_route'
    case 'line':
      return 'custom_line'
    case 'polygon':
    case 'rectangle':
    case 'ellipse':
    case 'square':
    case 'triangle':
      return 'custom_area'
    case 'point':
      return 'custom_point'
    case 'text':
      return 'text_label'
    case 'pen':
      return 'pen_path'
    default:
      return 'custom_area'
  }
}

function distanceMeters(left: Position, right: Position) {
  const radius = 6_371_000
  const lat1 = (left[1] * Math.PI) / 180
  const lat2 = (right[1] * Math.PI) / 180
  const deltaLat = ((right[1] - left[1]) * Math.PI) / 180
  const deltaLng = ((right[0] - left[0]) * Math.PI) / 180
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
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
  const feature = draftCollection.features.find(
    (f) => !f.properties?.isDraftVertex && (f.geometry.type === 'Polygon' || f.geometry.type === 'LineString'),
  ) || draftCollection.features[0]
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

export function translateFeatureGeometry(feature: Feature, deltaLng: number, deltaLat: number): Feature {
  return {
    ...feature,
    geometry: translateGeometry(feature.geometry, deltaLng, deltaLat),
  }
}
