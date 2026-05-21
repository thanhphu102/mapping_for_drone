import { useCallback, useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { Map, MapMouseEvent } from 'maplibre-gl'
import type { DrawingProject } from '../types'
import type { SnapPreview } from './useSnapEngine'

const featureLayers = ['project-features-fill', 'project-features-line', 'project-features-point']
const DEBUG_RECTANGLE_DRAWING = false

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tagName = target.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true
  }
  return Boolean(target.closest('[contenteditable="true"]'))
}

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

export type BoxShapeVariant = 'rectangle' | 'square' | 'triangle' | 'ellipse' | 'circle' | 'text'

type ActiveDrawGestureKind =
  | 'box_shape'
  | 'pen'
  | 'delete_lasso'
  | 'move_feature'
  | 'box_select'

type CancelDrawingReason = 'right-click' | 'escape' | 'tool-change'

interface PointerState {
  lng: number
  lat: number
  x: number
  y: number
  shiftKey: boolean
}

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

function pointInProjectedRing(point: { x: number; y: number }, ring: Array<{ x: number; y: number }>) {
  let inside = false
  let j = ring.length - 1
  for (let i = 0; i < ring.length; i += 1) {
    const intersects =
      ring[i].y > point.y !== ring[j].y > point.y &&
      point.x < ((ring[j].x - ring[i].x) * (point.y - ring[i].y)) / ((ring[j].y - ring[i].y) || 1e-12) + ring[i].x
    if (intersects) inside = !inside
    j = i
  }
  return inside
}

function pointToProjectedSegmentDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 1e-9) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  const clamped = Math.max(0, Math.min(1, t))
  const nearestX = start.x + clamped * dx
  const nearestY = start.y + clamped * dy
  return Math.hypot(point.x - nearestX, point.y - nearestY)
}

export function pointInBoundary(point: Position, project: DrawingProject, map: Map | null) {
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

function geometryPositions(geometry: Geometry): Position[] {
  if (geometry.type === 'Point') {
    return [geometry.coordinates as Position]
  }
  if (geometry.type === 'LineString') {
    return geometry.coordinates as Position[]
  }
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.flat() as Position[]
  }
  if (geometry.type === 'MultiPoint') {
    return geometry.coordinates as Position[]
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.flat() as Position[]
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flat(2) as Position[]
  }
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.flatMap((child) => geometryPositions(child))
  }
  return []
}

export function featureInsideBoundary(feature: Feature, project: DrawingProject, map: Map | null) {
  const geometry = feature.geometry as Geometry | null
  if (!geometry) {
    return false
  }
  const positions = geometryPositions(geometry)
  if (positions.length === 0) {
    return false
  }
  return positions.every((position) => pointInBoundary(position, project, map))
}

function translatePosition([lng, lat]: Position, deltaLng: number, deltaLat: number): Position {
  return [lng + deltaLng, lat + deltaLat]
}

function buildCircleRing(start: Position, end: Position, map: Map | null): Position[] {
  const segments = 40
  const ring: Position[] = []
  if (map) {
    const startPx = map.project([start[0], start[1]])
    const endPx = map.project([end[0], end[1]])
    const centerPxX = (startPx.x + endPx.x) / 2
    const centerPxY = (startPx.y + endPx.y) / 2
    const radiusPx = Math.max(1, Math.hypot(endPx.x - startPx.x, endPx.y - startPx.y) / 2)
    for (let i = 0; i <= segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2
      const pxX = centerPxX + Math.cos(angle) * radiusPx
      const pxY = centerPxY + Math.sin(angle) * radiusPx
      const lngLat = map.unproject([pxX, pxY])
      ring.push([lngLat.lng, lngLat.lat])
    }
    return ring
  }

  const center: Position = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  const radius = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1])) / 2
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    ring.push([
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ])
  }
  return ring
}

function buildSquareRing(start: Position, end: Position, map: Map | null): Position[] {
  if (!map) {
    const lngDelta = end[0] - start[0]
    const latDelta = end[1] - start[1]
    const horizontalDominant = Math.abs(lngDelta) >= Math.abs(latDelta)
    const side = horizontalDominant ? Math.abs(lngDelta) : Math.abs(latDelta)
    if (horizontalDominant) {
      const verticalSign = Math.sign(latDelta || 1)
      const p1: Position = [start[0], start[1]]
      const p2: Position = [start[0] + Math.sign(lngDelta || 1) * side, start[1]]
      const p3: Position = [p2[0], p2[1] + verticalSign * side]
      const p4: Position = [p1[0], p1[1] + verticalSign * side]
      return [p1, p2, p3, p4, p1]
    }
    const horizontalSign = Math.sign(lngDelta || 1)
    const p1: Position = [start[0], start[1]]
    const p2: Position = [start[0], start[1] + Math.sign(latDelta || 1) * side]
    const p3: Position = [p2[0] + horizontalSign * side, p2[1]]
    const p4: Position = [p1[0] + horizontalSign * side, p1[1]]
    return [p1, p2, p3, p4, p1]
  }

  const startPx = map.project([start[0], start[1]])
  const endPx = map.project([end[0], end[1]])
  const dx = endPx.x - startPx.x
  const dy = endPx.y - startPx.y
  const side = Math.max(1, Math.min(Math.abs(dx), Math.abs(dy)))
  const endSquarePx = {
    x: startPx.x + Math.sign(dx || 1) * side,
    y: startPx.y + Math.sign(dy || 1) * side,
  }
  const p1 = { x: startPx.x, y: startPx.y }
  const p2 = { x: endSquarePx.x, y: startPx.y }
  const p3 = { x: endSquarePx.x, y: endSquarePx.y }
  const p4 = { x: startPx.x, y: endSquarePx.y }

  return [p1, p2, p3, p4, p1].map((point) => {
    const lngLat = map.unproject([point.x, point.y])
    return [lngLat.lng, lngLat.lat] as Position
  })
}

function buildRectangleRing(start: Position, end: Position, map: Map | null): Position[] {
  if (!map) {
    return [
      [start[0], start[1]],
      [end[0], start[1]],
      [end[0], end[1]],
      [start[0], end[1]],
      [start[0], start[1]],
    ]
  }
  const startPx = map.project([start[0], start[1]])
  const endPx = map.project([end[0], end[1]])
  const p1 = { x: startPx.x, y: startPx.y }
  const p2 = { x: endPx.x, y: startPx.y }
  const p3 = { x: endPx.x, y: endPx.y }
  const p4 = { x: startPx.x, y: endPx.y }
  return [p1, p2, p3, p4, p1].map((point) => {
    const lngLat = map.unproject([point.x, point.y])
    return [lngLat.lng, lngLat.lat] as Position
  })
}

function boxEndFromPointer(
  map: Map | null,
  start: Position,
  pointer: { x: number; y: number },
  variant: BoxShapeVariant | null,
): Position {
  if (!map) {
    return start
  }
  const startPx = map.project([start[0], start[1]])
  if (variant === 'square') {
    const dx = pointer.x - startPx.x
    const dy = pointer.y - startPx.y
    const size = Math.max(1, Math.min(Math.abs(dx), Math.abs(dy)))
    const endPx = {
      x: startPx.x + Math.sign(dx || 1) * size,
      y: startPx.y + Math.sign(dy || 1) * size,
    }
    if (DEBUG_RECTANGLE_DRAWING) {
      console.info('[rect-debug] square', { startPx, pointer, endPx })
    }
    const lngLat = map.unproject([endPx.x, endPx.y])
    return [lngLat.lng, lngLat.lat]
  }
  if (DEBUG_RECTANGLE_DRAWING && variant === 'rectangle') {
    console.info('[rect-debug] rectangle', { startPx, pointer })
  }
  const lngLat = map.unproject([pointer.x, pointer.y])
  return [lngLat.lng, lngLat.lat]
}

function geometryCentroid(geometry: Geometry): Position | null {
  const positions = geometryPositions(geometry)
  if (positions.length === 0) {
    return null
  }
  const total = positions.reduce(
    (sum, [lng, lat]) => {
      sum.lng += lng
      sum.lat += lat
      return sum
    },
    { lng: 0, lat: 0 },
  )
  return [total.lng / positions.length, total.lat / positions.length]
}

function rotatePosition(position: Position, center: Position, angleRad: number): Position {
  const dx = position[0] - center[0]
  const dy = position[1] - center[1]
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  return [
    center[0] + dx * cos - dy * sin,
    center[1] + dx * sin + dy * cos,
  ]
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
  visibleFeaturesRef: React.RefObject<Feature[]>
  onAddPoint: (updater: (current: Position[]) => Position[]) => void
  onSaveDraft: () => void
  onMessage: (msg: string) => void
  onSetSelection: (featureIds: string[]) => void
  onDeleteFeatures?: (featureIds: string[]) => void
  onMoveFeatures?: (featureIds: string[], deltaLng: number, deltaLat: number) => void
  onMoveEnd?: (featureIds: string[]) => void
  onRotateGestureStart?: (featureIds: string[]) => void
  onRotateGestureDelta?: (featureIds: string[], angleDeg: number) => { blocked: boolean }
  onRotateGestureEnd?: (featureIds: string[]) => void
  onSetBoxShapeVariant?: (variant: BoxShapeVariant | null) => void
  onQuickCreateTextBox?: (start: Position, end: Position) => void
  onCompleteBoxShape?: (mode: 'rectangle' | 'square' | 'triangle' | 'ellipse' | 'circle', start: Position, end: Position) => void
  onCompletePenPath?: (points: Position[]) => void
  onCompleteLasso?: (start: Position, end: Position) => void
  draftPointsRef?: React.RefObject<Position[]>
  onClearDraftPoints?: () => void
  onCancelExternalDrafts?: (reason: CancelDrawingReason) => boolean
  onClearSnapPreview?: () => void
}

export function useDrawingEngine({
  map,
  project,
  toolsEnabled,
  isMounted,
  modeRef,
  snapPreviewRef,
  selectedFeatureIdsRef,
  visibleFeaturesRef,
  onAddPoint,
  onSaveDraft,
  onMessage,
  onSetSelection,
  onDeleteFeatures,
  onMoveFeatures,
  onMoveEnd,
  onRotateGestureStart,
  onRotateGestureDelta,
  onRotateGestureEnd,
  onSetBoxShapeVariant,
  onQuickCreateTextBox,
  onCompleteBoxShape,
  onCompletePenPath,
  onCompleteLasso,
  draftPointsRef,
  onClearDraftPoints,
  onCancelExternalDrafts,
  onClearSnapPreview,
}: UseDrawingEngineOptions) {
  const projectRef = useRef(project)
  const toolsEnabledRef = useRef(toolsEnabled)
  const onSaveDraftRef = useRef(onSaveDraft)
  const onSetSelectionRef = useRef(onSetSelection)
  const onDeleteFeaturesRef = useRef(onDeleteFeatures)
  const onMoveFeaturesRef = useRef(onMoveFeatures)
  const onMoveEndRef = useRef(onMoveEnd)
  const onRotateGestureStartRef = useRef(onRotateGestureStart)
  const onRotateGestureDeltaRef = useRef(onRotateGestureDelta)
  const onRotateGestureEndRef = useRef(onRotateGestureEnd)
  const onSetBoxShapeVariantRef = useRef(onSetBoxShapeVariant)
  const onQuickCreateTextBoxRef = useRef(onQuickCreateTextBox)
  const onCompleteBoxShapeRef = useRef(onCompleteBoxShape)
  const onCompletePenPathRef = useRef(onCompletePenPath)
  const onCompleteLassoRef = useRef(onCompleteLasso)
  const draftPointsRefRef = useRef(draftPointsRef)
  const onClearDraftPointsRef = useRef(onClearDraftPoints)
  const onCancelExternalDraftsRef = useRef(onCancelExternalDrafts)
  const onClearSnapPreviewRef = useRef(onClearSnapPreview)
  const boxStartRef = useRef<{ x: number; y: number } | null>(null)
  const movingFeaturesRef = useRef<{ featureIds: string[]; lastLng: number; lastLat: number; moved: boolean } | null>(null)
  const rotatingFeaturesRef = useRef<{ featureIds: string[]; centerX: number; centerY: number; lastAngle: number; rotated: boolean } | null>(null)
  const boxShapeStartRef = useRef<Position | null>(null)
  const circleAxisRef = useRef<'horizontal' | 'vertical' | null>(null)
  const freehandStartedRef = useRef(false)
  const freehandPointsRef = useRef<Position[]>([])
  const lassoStartedRef = useRef(false)
  const lassoStartRef = useRef<Position | null>(null)
  const cancelActiveDrawingRef = useRef<((reason: CancelDrawingReason) => boolean) | null>(null)

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
    onRotateGestureStartRef.current = onRotateGestureStart
  }, [onRotateGestureStart])

  useEffect(() => {
    onRotateGestureDeltaRef.current = onRotateGestureDelta
  }, [onRotateGestureDelta])

  useEffect(() => {
    onRotateGestureEndRef.current = onRotateGestureEnd
  }, [onRotateGestureEnd])

  useEffect(() => {
    onSetBoxShapeVariantRef.current = onSetBoxShapeVariant
  }, [onSetBoxShapeVariant])

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

  useEffect(() => {
    draftPointsRefRef.current = draftPointsRef
  }, [draftPointsRef])

  useEffect(() => {
    onClearDraftPointsRef.current = onClearDraftPoints
  }, [onClearDraftPoints])

  useEffect(() => {
    onCancelExternalDraftsRef.current = onCancelExternalDrafts
  }, [onCancelExternalDrafts])

  useEffect(() => {
    onClearSnapPreviewRef.current = onClearSnapPreview
  }, [onClearSnapPreview])

  const suppressClickRef = useRef(false)
  const getSelectedFeatureById = useCallback((featureId: string) => {
    return visibleFeaturesRef.current.find((feature) => String(feature.id ?? feature.properties?.id ?? '') === featureId) ?? null
  }, [visibleFeaturesRef])

  const hitTestFeatureAtPoint = useCallback((point: { x: number; y: number }) => {
    if (!map) return null
    for (let index = visibleFeaturesRef.current.length - 1; index >= 0; index -= 1) {
      const feature = visibleFeaturesRef.current[index]
      const geometry = feature.geometry
      if (!geometry) continue
      if (geometry.type === 'Point') {
        const projected = map.project([geometry.coordinates[0], geometry.coordinates[1]])
        if (Math.hypot(point.x - projected.x, point.y - projected.y) <= 12) {
          return feature
        }
        continue
      }
      if (geometry.type === 'LineString') {
        const projected = geometry.coordinates.map((position) => map.project([position[0], position[1]]))
        let hit = false
        for (let lineIndex = 1; lineIndex < projected.length; lineIndex += 1) {
          if (pointToProjectedSegmentDistance(point, projected[lineIndex - 1], projected[lineIndex]) <= 12) {
            hit = true
            break
          }
        }
        if (hit) return feature
        continue
      }
      if (geometry.type === 'Polygon') {
        const rings = geometry.coordinates.map((ring) => ring.map((position) => map.project([position[0], position[1]])))
        const [outer, ...holes] = rings
        if (pointInProjectedRing(point, outer) && !holes.some((hole) => pointInProjectedRing(point, hole))) {
          return feature
        }
      }
    }
    return null
  }, [map, visibleFeaturesRef])

  const getRotateHandle = useCallback((feature: Feature) => {
    if (!map) return null
    const center = geometryCentroid(feature.geometry)
    const positions = geometryPositions(feature.geometry)
    if (!center || positions.length === 0) return null
    const projectedCenter = map.project([center[0], center[1]])
    const radius = positions.reduce((maxRadius, position) => {
      const point = map.project([position[0], position[1]])
      return Math.max(maxRadius, Math.hypot(point.x - projectedCenter.x, point.y - projectedCenter.y))
    }, 0)
    const handleOffset = Math.max(28, radius * 0.18)
    return {
      x: projectedCenter.x,
      y: projectedCenter.y + radius + handleOffset,
      centerX: projectedCenter.x,
      centerY: projectedCenter.y,
    }
  }, [map])

  const normalizeCircleDrag = useCallback((start: Position, rawEnd: Position): Position => {
    if (!map) return rawEnd
    const startPx = map.project([start[0], start[1]])
    const endPx = map.project([rawEnd[0], rawEnd[1]])
    const dx = endPx.x - startPx.x
    const dy = endPx.y - startPx.y
    const movementThreshold = 4

    let axis = circleAxisRef.current
    if (!axis && (Math.abs(dx) >= movementThreshold || Math.abs(dy) >= movementThreshold)) {
      axis = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical'
      circleAxisRef.current = axis
    }
    if (!axis) {
      axis = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical'
    }

    const normalizedPx =
      axis === 'horizontal'
        ? { x: startPx.x + Math.sign(dx || 1) * Math.abs(dx), y: startPx.y }
        : { x: startPx.x, y: startPx.y + Math.sign(dy || 1) * Math.abs(dy) }

    const unprojected = map.unproject([normalizedPx.x, normalizedPx.y])
    return [unprojected.lng, unprojected.lat]
  }, [map])

  const resolveBoxShapeVariant = useCallback((mode: DrawMode, shiftPressed: boolean): BoxShapeVariant | null => {
    if (mode === 'rectangle') return shiftPressed ? 'square' : 'rectangle'
    if (mode === 'ellipse') return shiftPressed ? 'circle' : 'ellipse'
    if (mode === 'triangle' || mode === 'text' || mode === 'square') return mode
    return null
  }, [])

  const handleMapClick = useCallback(
    (event: MapMouseEvent) => {
      if (!toolsEnabledRef.current || !map) return
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }

      const currentMode = modeRef.current
      const firstFeature = hitTestFeatureAtPoint(event.point)
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
    [hitTestFeatureAtPoint, isMounted, modeRef, onAddPoint, onMessage, snapPreviewRef, map, selectedFeatureIdsRef],
  )

  useEffect(() => {
    if (!map) return

    let activeGesture: ActiveDrawGestureKind | null = null
    let windowListenersAttached = false
    const setCursor = (value: string) => {
      map.getCanvas().style.cursor = value
    }

    const syncDragPanByMode = () => {
      if (modeRef.current === 'move') {
        map.dragPan.enable()
      } else {
        map.dragPan.disable()
      }
    }

    const hasActiveGesture = () =>
      activeGesture !== null ||
      boxShapeStartRef.current !== null ||
      freehandStartedRef.current ||
      lassoStartedRef.current ||
      movingFeaturesRef.current !== null ||
      rotatingFeaturesRef.current !== null ||
      boxStartRef.current !== null

    const pointerFromMapEvent = (event: MapMouseEvent): PointerState => ({
      lng: event.lngLat.lng,
      lat: event.lngLat.lat,
      x: event.point.x,
      y: event.point.y,
      shiftKey: Boolean(event.originalEvent?.shiftKey),
    })

    const pointerFromWindowEvent = (event: MouseEvent): PointerState => {
      const rect = map.getCanvas().getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const lngLat = map.unproject([x, y])
      return {
        lng: lngLat.lng,
        lat: lngLat.lat,
        x,
        y,
        shiftKey: Boolean(event.shiftKey),
      }
    }

    const detachWindowListeners = () => {
      if (!windowListenersAttached) return
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
      windowListenersAttached = false
    }

    const syncWindowListeners = () => {
      if (hasActiveGesture() && !windowListenersAttached) {
        window.addEventListener('mousemove', handleWindowMouseMove)
        window.addEventListener('mouseup', handleWindowMouseUp)
        windowListenersAttached = true
        return
      }
      if (!hasActiveGesture()) {
        detachWindowListeners()
      }
    }

    const hasActivePointDraft = () => {
      const draftPoints = draftPointsRefRef.current?.current ?? []
      if (draftPoints.length === 0) return false
      return ['polygon', 'line', 'wall', 'indoor_route', 'point', 'door', 'room', 'corridor'].includes(modeRef.current)
    }

    const cancelActiveDrawing = (reason: CancelDrawingReason): boolean => {
      const externalCancelled = onCancelExternalDraftsRef.current?.(reason) ?? false
      const hadDrawingGesture =
        activeGesture === 'box_shape' ||
        activeGesture === 'pen' ||
        activeGesture === 'delete_lasso'
      const hasDraft =
        hadDrawingGesture ||
        boxShapeStartRef.current !== null ||
        freehandStartedRef.current ||
        lassoStartedRef.current ||
        hasActivePointDraft() ||
        externalCancelled

      if (!hasDraft) {
        return false
      }

      boxShapeStartRef.current = null
      circleAxisRef.current = null
      freehandStartedRef.current = false
      freehandPointsRef.current = []
      lassoStartedRef.current = false
      lassoStartRef.current = null

      if (activeGesture === 'box_shape' || activeGesture === 'pen' || activeGesture === 'delete_lasso') {
        activeGesture = null
      }

      onSetBoxShapeVariantRef.current?.(null)
      if (onClearDraftPointsRef.current) {
        onClearDraftPointsRef.current()
      } else {
        onAddPoint(() => [])
      }
      onClearSnapPreviewRef.current?.()
      setCursor(modeRef.current === 'move' ? 'grab' : '')
      syncDragPanByMode()
      syncWindowListeners()
      return true
    }
    cancelActiveDrawingRef.current = cancelActiveDrawing

    const finalizeRotationFromPointer = () => {
      if (!rotatingFeaturesRef.current) {
        return
      }
      const featureIds = [...rotatingFeaturesRef.current.featureIds]
      const didRotate = rotatingFeaturesRef.current.rotated
      rotatingFeaturesRef.current = null
      onRotateGestureEndRef.current?.(featureIds)
      activeGesture = null
      setCursor('default')
      if (didRotate) {
        suppressClickRef.current = true
      }
    }

    const finalizeMoveFromPointer = () => {
      if (!movingFeaturesRef.current) {
        return
      }
      const movedFeatureIds = movingFeaturesRef.current.featureIds
      const didMove = movingFeaturesRef.current.moved
      movingFeaturesRef.current = null
      activeGesture = null
      setCursor('')
      if (didMove) {
        suppressClickRef.current = true
        onMoveEndRef.current?.(movedFeatureIds)
      }
    }

    const finalizeShapeFromPointer = (pointer: PointerState) => {
      if (!(boxShapeStartRef.current && ['rectangle', 'square', 'triangle', 'ellipse', 'text'].includes(modeRef.current))) {
        return
      }
      const start = boxShapeStartRef.current
      boxShapeStartRef.current = null
      activeGesture = null
      setCursor('')
      suppressClickRef.current = true
      const rawEnd: Position = [pointer.lng, pointer.lat]
      const mode = modeRef.current
      const variant = resolveBoxShapeVariant(mode, pointer.shiftKey)
      const end: Position =
        variant === 'square' || variant === 'rectangle'
          ? boxEndFromPointer(map, start, { x: pointer.x, y: pointer.y }, variant)
          : variant === 'circle'
            ? normalizeCircleDrag(start, rawEnd)
            : rawEnd
      circleAxisRef.current = null
      onSetBoxShapeVariantRef.current?.(null)
      const d = Math.hypot(end[0] - start[0], end[1] - start[1])
      if (d > 0.000001) {
        onAddPoint(() => [start, end])
        if (mode === 'text') {
          onQuickCreateTextBoxRef.current?.(start, end)
          onAddPoint(() => [])
        } else if (variant === 'rectangle' || variant === 'square' || variant === 'triangle' || variant === 'ellipse' || variant === 'circle') {
          onCompleteBoxShapeRef.current?.(variant, start, end)
          onAddPoint(() => [])
        }
      } else {
        onAddPoint(() => [])
      }
    }

    const finalizePenFromPointer = () => {
      if (!(freehandStartedRef.current && modeRef.current === 'pen')) {
        return
      }
      freehandStartedRef.current = false
      activeGesture = null
      setCursor('')
      suppressClickRef.current = true
      if (freehandPointsRef.current.length >= 2) {
        onCompletePenPathRef.current?.(freehandPointsRef.current)
        onAddPoint(() => [])
      }
      freehandPointsRef.current = []
    }

    const finalizeLassoFromPointer = (pointer: PointerState) => {
      if (!(lassoStartedRef.current && modeRef.current === 'delete_lasso')) {
        return
      }
      lassoStartedRef.current = false
      activeGesture = null
      setCursor('')
      suppressClickRef.current = true
      const start = lassoStartRef.current ?? [pointer.lng, pointer.lat]
      const end: Position = [pointer.lng, pointer.lat]
      lassoStartRef.current = null
      onAddPoint(() => [start, end])
      onCompleteLassoRef.current?.(start, end)
    }

    const finalizeBoxSelectFromPointer = (pointer: PointerState) => {
      if (!boxStartRef.current) {
        return
      }
      const minX = Math.min(boxStartRef.current.x, pointer.x)
      const minY = Math.min(boxStartRef.current.y, pointer.y)
      const maxX = Math.max(boxStartRef.current.x, pointer.x)
      const maxY = Math.max(boxStartRef.current.y, pointer.y)
      const hits = map.queryRenderedFeatures(
        [
          [minX, minY],
          [maxX, maxY],
        ],
        { layers: featureLayers },
      )
      const uniqueIds = Array.from(
        new Set(hits.map((feature) => String(feature.id ?? feature.properties?.id ?? '')).filter(Boolean)),
      )
      onSetSelectionRef.current(uniqueIds)
      boxStartRef.current = null
      activeGesture = null
      setCursor('')
    }

    const handlePointerMove = (pointer: PointerState) => {
      if (rotatingFeaturesRef.current && onRotateGestureDeltaRef.current) {
        const nextAngle = Math.atan2(
          pointer.y - rotatingFeaturesRef.current.centerY,
          pointer.x - rotatingFeaturesRef.current.centerX,
        )
        const deltaDeg = ((nextAngle - rotatingFeaturesRef.current.lastAngle) * 180) / Math.PI
        if (Math.abs(deltaDeg) >= 0.5) {
          const result = onRotateGestureDeltaRef.current(
            rotatingFeaturesRef.current.featureIds,
            -deltaDeg,
          )
          rotatingFeaturesRef.current.lastAngle = nextAngle
          rotatingFeaturesRef.current.rotated = rotatingFeaturesRef.current.rotated || !result.blocked
          setCursor(result.blocked ? 'not-allowed' : 'grabbing')
        }
        return
      }

      if (boxShapeStartRef.current && ['rectangle', 'square', 'triangle', 'ellipse', 'text'].includes(modeRef.current)) {
        const rawEnd: Position = [pointer.lng, pointer.lat]
        const mode = modeRef.current
        const variant = resolveBoxShapeVariant(mode, pointer.shiftKey)
        onSetBoxShapeVariantRef.current?.(variant)
        const end: Position =
          variant === 'square' || variant === 'rectangle'
            ? boxEndFromPointer(map, boxShapeStartRef.current, { x: pointer.x, y: pointer.y }, variant)
            : variant === 'circle'
              ? normalizeCircleDrag(boxShapeStartRef.current, rawEnd)
              : rawEnd
        if ((variant === 'rectangle' || variant === 'square') && projectRef.current) {
          const preview = draftToFeatures(
            mode,
            [boxShapeStartRef.current, end],
            featureTypeForMode(mode),
            null,
            map,
            variant,
          )
          const previewFeature = preview?.features.find((feature) => !feature.properties?.isDraftVertex) as Feature | undefined
          if (previewFeature && !featureInsideBoundary(previewFeature, projectRef.current, map)) {
            return
          }
        }
        onAddPoint(() => [boxShapeStartRef.current!, end])
        return
      }

      if (lassoStartedRef.current && modeRef.current === 'delete_lasso') {
        const point: Position = [pointer.lng, pointer.lat]
        onAddPoint(() => [lassoStartRef.current ?? point, point])
        return
      }

      if (freehandStartedRef.current && modeRef.current === 'pen') {
        const point: Position = [pointer.lng, pointer.lat]
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
        const deltaLng = pointer.lng - movingFeaturesRef.current.lastLng
        const deltaLat = pointer.lat - movingFeaturesRef.current.lastLat
        if (Math.abs(deltaLng) > 0 || Math.abs(deltaLat) > 0) {
          onMoveFeaturesRef.current(movingFeaturesRef.current.featureIds, deltaLng, deltaLat)
          movingFeaturesRef.current.lastLng = pointer.lng
          movingFeaturesRef.current.lastLat = pointer.lat
          movingFeaturesRef.current.moved = true
        }
      }
    }

    const handlePointerUp = (pointer: PointerState) => {
      finalizeRotationFromPointer()
      finalizeMoveFromPointer()
      finalizeShapeFromPointer(pointer)
      finalizePenFromPointer()
      finalizeLassoFromPointer(pointer)
      finalizeBoxSelectFromPointer(pointer)
      syncDragPanByMode()
      if (modeRef.current === 'move') {
        setCursor('grab')
      }
      syncWindowListeners()
    }

    function handleWindowMouseMove(event: MouseEvent) {
      if (!hasActiveGesture()) return
      handlePointerMove(pointerFromWindowEvent(event))
    }

    function handleWindowMouseUp(event: MouseEvent) {
      if (!hasActiveGesture()) return
      handlePointerUp(pointerFromWindowEvent(event))
    }

    const handleMouseDown = (e: MapMouseEvent) => {
      if (!toolsEnabledRef.current) return
      const mode = modeRef.current

      if (mode === 'rectangle' || mode === 'square' || mode === 'triangle' || mode === 'ellipse' || mode === 'text') {
        if (e.originalEvent.button !== 0) return
        e.preventDefault()
        e.originalEvent.preventDefault()
        const start: Position = [e.lngLat.lng, e.lngLat.lat]
        boxShapeStartRef.current = start
        if (mode === 'ellipse') {
          circleAxisRef.current = null
        }
        onSetBoxShapeVariantRef.current?.(resolveBoxShapeVariant(mode, Boolean(e.originalEvent?.shiftKey)))
        activeGesture = 'box_shape'
        onAddPoint(() => [start, start])
        map.dragPan.disable()
        setCursor('crosshair')
        syncWindowListeners()
        return
      }

      if (mode === 'pen') {
        if (e.originalEvent.button !== 0) return
        e.preventDefault()
        e.originalEvent.preventDefault()
        const start: Position = [e.lngLat.lng, e.lngLat.lat]
        const currentProject = projectRef.current
        if (!currentProject || !pointInBoundary(start, currentProject, map)) {
          if (isMounted()) onMessage('Point rejected: it is outside the locked base boundary')
          return
        }
        freehandPointsRef.current = [start]
        onAddPoint(() => [start])
        freehandStartedRef.current = true
        activeGesture = 'pen'
        map.dragPan.disable()
        setCursor('crosshair')
        syncWindowListeners()
        return
      }

      if (mode === 'delete_lasso') {
        if (e.originalEvent.button !== 0) return
        e.preventDefault()
        e.originalEvent.preventDefault()
        const start: Position = [e.lngLat.lng, e.lngLat.lat]
        lassoStartRef.current = start
        onAddPoint(() => [start, start])
        lassoStartedRef.current = true
        activeGesture = 'delete_lasso'
        map.dragPan.disable()
        setCursor('crosshair')
        syncWindowListeners()
        return
      }

      if (mode === 'move') {
        setCursor('grabbing')
        return
      }

      if (mode === 'select' && e.originalEvent?.shiftKey) {
        e.preventDefault()
        boxStartRef.current = { x: e.point.x, y: e.point.y }
        activeGesture = 'box_select'
        setCursor('crosshair')
        syncWindowListeners()
        return
      }

      if (mode === 'select') {
        const currentSelection = selectedFeatureIdsRef.current ?? []
        if (currentSelection.length === 1) {
          const selectedFeature = getSelectedFeatureById(currentSelection[0])
          const handle = selectedFeature ? getRotateHandle(selectedFeature) : null
          if (handle) {
            const distance = Math.hypot(e.point.x - handle.x, e.point.y - handle.y)
            if (distance <= 18) {
              rotatingFeaturesRef.current = {
                featureIds: [currentSelection[0]],
                centerX: handle.centerX,
                centerY: handle.centerY,
                lastAngle: Math.atan2(e.point.y - handle.centerY, e.point.x - handle.centerX),
                rotated: false,
              }
              onRotateGestureStartRef.current?.([currentSelection[0]])
              map.dragPan.disable()
              setCursor('grabbing')
              syncWindowListeners()
              return
            }
          }
        }
        const firstFeature = hitTestFeatureAtPoint(e.point)
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
          activeGesture = 'move_feature'
          map.dragPan.disable()
          setCursor('grabbing')
          syncWindowListeners()
          return
        }
      }

    }

    const handleMouseMove = (e: MapMouseEvent) => {
      handlePointerMove(pointerFromMapEvent(e))
    }

    const handleMouseUp = (e: MapMouseEvent) => {
      handlePointerUp(pointerFromMapEvent(e))
    }

    const handleContextMenu = (e: MapMouseEvent) => {
      if (cancelActiveDrawing('right-click')) {
        e.preventDefault()
        return
      }
      const first = hitTestFeatureAtPoint(e.point)
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
      cancelActiveDrawingRef.current = null
      detachWindowListeners()
      map.off('click', handleMapClick)
      map.off('mousedown', handleMouseDown)
      map.off('mousemove', handleMouseMove)
      map.off('mouseup', handleMouseUp)
      map.off('contextmenu', handleContextMenu)
      map.off('dblclick', handleDblClick)
      map.doubleClickZoom.enable()
    }
  }, [map, handleMapClick, hitTestFeatureAtPoint, onAddPoint, modeRef, selectedFeatureIdsRef, getRotateHandle, getSelectedFeatureById, normalizeCircleDrag, resolveBoxShapeVariant, isMounted, onMessage])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!toolsEnabledRef.current) return
      if (e.isComposing || e.key === 'Process' || isEditableEventTarget(e.target)) return

      if (e.key === 'Enter' && !['select', 'move', 'text'].includes(modeRef.current)) {
        e.preventDefault()
        onSaveDraftRef.current()
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        if (cancelActiveDrawingRef.current?.('escape')) {
          return
        }
        onSetBoxShapeVariantRef.current?.(null)
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
  boxShapeVariant: BoxShapeVariant | null = null,
): FeatureCollection | null {
  if (points.length === 0) return null

  const features: Feature[] = []
  const effectiveBoxVariant =
    boxShapeVariant ??
    (mode === 'square'
      ? 'square'
      : mode === 'rectangle'
        ? 'rectangle'
        : mode === 'ellipse'
          ? 'ellipse'
          : mode === 'triangle'
            ? 'triangle'
            : mode === 'text'
              ? 'text'
              : null)

  if (!['square', 'circle'].includes(String(effectiveBoxVariant))) {
    features.push({
      type: 'Feature',
      geometry: { type: 'MultiPoint', coordinates: points },
      properties: { featureType, isDraftVertex: true },
    })
  }

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
  } else if (['rectangle', 'square', 'triangle', 'ellipse', 'text'].includes(mode) || effectiveBoxVariant === 'circle') {
    if (previewPoints.length >= 2) {
      const [start, end] = [previewPoints[0], previewPoints[previewPoints.length - 1]]
      const lngDelta = end[0] - start[0]
      const latDelta = end[1] - start[1]
      if (effectiveBoxVariant === 'triangle') {
        const apex: Position = [start[0] + lngDelta / 2, start[1]]
        const left: Position = [start[0], end[1]]
        const right: Position = [end[0], end[1]]
        const ring: Position[] = [apex, right, left, apex]
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: { featureType },
        })
      } else if (effectiveBoxVariant === 'ellipse') {
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
      } else if (effectiveBoxVariant === 'circle') {
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [buildCircleRing(start, end, map)] },
          properties: { featureType },
        })
      } else if (effectiveBoxVariant === 'text') {
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
        const ring: Position[] =
          effectiveBoxVariant === 'square'
            ? buildSquareRing(start, end, map)
            : buildRectangleRing(start, end, map)
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

function rotateGeometry(geometry: Geometry, angleRad: number, center: Position): Geometry {
  if (geometry.type === 'Point') {
    return { ...geometry, coordinates: rotatePosition(geometry.coordinates as Position, center, angleRad) }
  }
  if (geometry.type === 'LineString') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((position) => rotatePosition(position, center, angleRad)),
    }
  }
  if (geometry.type === 'MultiLineString') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((line) =>
        line.map((position) => rotatePosition(position, center, angleRad)),
      ),
    }
  }
  if (geometry.type === 'Polygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((ring) =>
        ring.map((position) => rotatePosition(position, center, angleRad)),
      ),
    }
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) => ring.map((position) => rotatePosition(position, center, angleRad))),
      ),
    }
  }
  if (geometry.type === 'MultiPoint') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((position) => rotatePosition(position, center, angleRad)),
    }
  }
  if (geometry.type === 'GeometryCollection') {
    return {
      ...geometry,
      geometries: geometry.geometries.map((child) => rotateGeometry(child, angleRad, center)),
    }
  }
  return geometry
}

export function rotateFeatureGeometry(feature: Feature, angleDeg: number): Feature {
  const center = geometryCentroid(feature.geometry)
  if (!center) {
    return feature
  }
  const angleRad = (angleDeg * Math.PI) / 180
  return {
    ...feature,
    geometry: rotateGeometry(feature.geometry, angleRad, center),
  }
}
