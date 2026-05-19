import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, Geometry, MultiPolygon, Position } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { ArrowLeft } from 'lucide-react'
import type { DrawingProject, ProjectCanvasConfig } from '../types/drone'
import {
  fetchDrawingProject,
  fetchProjectVisibleFeatures,
  publishDrawingProject,
  saveDrawingFeature,
  deleteDrawingFeature,
  createProjectFloor,
  updateProjectFloor,
  deleteProjectFloor,
  createChildProject,
} from '../services/spatial'
import { MapProvider, useMapContext } from './MapProvider'
import { EditorToolbar } from './EditorToolbar'
import { EditorToolbox } from './EditorToolbox'
import { EditorStructurePanel } from './EditorStructurePanel'
import { EditorSidebar } from './EditorSidebar'
import { FloorSelector } from './FloorSelector'
import { BuildingEntryOverlay } from './BuildingEntryOverlay'
import { SpatialCanvasOverlay } from './SpatialCanvasOverlay'
import { useMapRenderer } from '../hooks/useMapRenderer'
import { useSnapEngine, type SnapPreview } from '../hooks/useSnapEngine'
import {
  useDrawingEngine,
  type BoxShapeVariant,
  type DrawMode,
  featureTypeForMode,
  draftToFeatures,
  featureInsideBoundary,
  rotateFeatureGeometry,
  translateFeatureGeometry,
} from '../hooks/useDrawingEngine'

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

const GEOMETRY_EPSILON = 1e-9

interface Segment {
  start: Position
  end: Position
}

interface RotateSessionState {
  featureIds: string[]
  baseFeatureById: Record<string, Feature>
  accumulatedAngleDeg: number
  lastValidAngleDeg: number
  lastValidGeometryByFeatureId: Record<string, Geometry>
  boundaryGeometry: MultiPolygon
}

function almostEqual(a: number, b: number, epsilon = GEOMETRY_EPSILON) {
  return Math.abs(a - b) <= epsilon
}

function pointEquals(a: Position, b: Position, epsilon = GEOMETRY_EPSILON) {
  return almostEqual(a[0], b[0], epsilon) && almostEqual(a[1], b[1], epsilon)
}

function orientation(a: Position, b: Position, c: Position) {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  if (almostEqual(value, 0)) return 0
  return value > 0 ? 1 : -1
}

function pointOnSegment2D(point: Position, a: Position, b: Position, epsilon = GEOMETRY_EPSILON) {
  if (orientation(a, b, point) !== 0) {
    return false
  }
  return (
    point[0] >= Math.min(a[0], b[0]) - epsilon &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    point[1] >= Math.min(a[1], b[1]) - epsilon &&
    point[1] <= Math.max(a[1], b[1]) + epsilon
  )
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

function pointOnRing(point: Position, ring: Position[]) {
  for (let index = 1; index < ring.length; index += 1) {
    if (pointOnSegment2D(point, ring[index - 1], ring[index])) {
      return true
    }
  }
  return false
}

function isPointInsideBaseBoundary(point: Position, boundary: MultiPolygon) {
  return boundary.coordinates.some((polygon) => {
    const [outer, ...holes] = polygon
    const insideOuter = pointInRing(point, outer) || pointOnRing(point, outer)
    if (!insideOuter) {
      return false
    }
    return !holes.some((hole) => pointInRing(point, hole) || pointOnRing(point, hole))
  })
}

function isBoundaryTouchOnlyIntersection(a1: Position, a2: Position, b1: Position, b2: Position) {
  const touchAtEndpoints =
    pointEquals(a1, b1) || pointEquals(a1, b2) || pointEquals(a2, b1) || pointEquals(a2, b2)
  if (touchAtEndpoints) {
    return true
  }
  if (pointOnSegment2D(a1, b1, b2) || pointOnSegment2D(a2, b1, b2)) {
    return true
  }
  if (pointOnSegment2D(b1, a1, a2) || pointOnSegment2D(b2, a1, a2)) {
    return true
  }
  return false
}

function segmentsProperlyIntersect(a1: Position, a2: Position, b1: Position, b2: Position) {
  const o1 = orientation(a1, a2, b1)
  const o2 = orientation(a1, a2, b2)
  const o3 = orientation(b1, b2, a1)
  const o4 = orientation(b1, b2, a2)

  const generalIntersection = o1 !== o2 && o3 !== o4
  if (generalIntersection) {
    return !isBoundaryTouchOnlyIntersection(a1, a2, b1, b2)
  }

  if (o1 === 0 && pointOnSegment2D(b1, a1, a2)) return !isBoundaryTouchOnlyIntersection(a1, a2, b1, b2)
  if (o2 === 0 && pointOnSegment2D(b2, a1, a2)) return !isBoundaryTouchOnlyIntersection(a1, a2, b1, b2)
  if (o3 === 0 && pointOnSegment2D(a1, b1, b2)) return !isBoundaryTouchOnlyIntersection(a1, a2, b1, b2)
  if (o4 === 0 && pointOnSegment2D(a2, b1, b2)) return !isBoundaryTouchOnlyIntersection(a1, a2, b1, b2)
  return false
}

function geometrySegments(geometry: Geometry): Segment[] {
  if (geometry.type === 'LineString') {
    const coords = geometry.coordinates as Position[]
    const segments: Segment[] = []
    for (let index = 1; index < coords.length; index += 1) {
      segments.push({ start: coords[index - 1], end: coords[index] })
    }
    return segments
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.flatMap((line) => geometrySegments({ type: 'LineString', coordinates: line }))
  }
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.flatMap((ring) => geometrySegments({ type: 'LineString', coordinates: ring }))
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) =>
      polygon.flatMap((ring) => geometrySegments({ type: 'LineString', coordinates: ring })),
    )
  }
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.flatMap((child) => geometrySegments(child))
  }
  return []
}

function geometryPoints(geometry: Geometry): Position[] {
  if (geometry.type === 'Point') return [geometry.coordinates as Position]
  if (geometry.type === 'MultiPoint') return geometry.coordinates as Position[]
  if (geometry.type === 'LineString') return geometry.coordinates as Position[]
  if (geometry.type === 'MultiLineString') return geometry.coordinates.flat() as Position[]
  if (geometry.type === 'Polygon') return geometry.coordinates.flat() as Position[]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2) as Position[]
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap((child) => geometryPoints(child))
  return []
}

function boundaryRingSegments(boundary: MultiPolygon): Segment[] {
  const segments: Segment[] = []
  boundary.coordinates.forEach((polygon) => {
    polygon.forEach((ring) => {
      for (let index = 1; index < ring.length; index += 1) {
        segments.push({ start: ring[index - 1], end: ring[index] })
      }
    })
  })
  return segments
}

function segmentMidpoint(segment: Segment): Position {
  return [
    (segment.start[0] + segment.end[0]) / 2,
    (segment.start[1] + segment.end[1]) / 2,
  ]
}

function geometryInsideBoundaryStrict(geometry: Geometry, boundary: MultiPolygon) {
  const points = geometryPoints(geometry)
  if (points.length === 0) {
    return false
  }
  if (!points.every((point) => isPointInsideBaseBoundary(point, boundary))) {
    return false
  }

  const candidateSegments = geometrySegments(geometry)
  const boundarySegments = boundaryRingSegments(boundary)
  for (const segment of candidateSegments) {
    if (!isPointInsideBaseBoundary(segmentMidpoint(segment), boundary)) {
      return false
    }
    for (const boundarySegment of boundarySegments) {
      if (
        segmentsProperlyIntersect(
          segment.start,
          segment.end,
          boundarySegment.start,
          boundarySegment.end,
        )
      ) {
        return false
      }
    }
  }
  return true
}

const DEFAULT_PROJECT_CONFIG: ProjectCanvasConfig = {
  canvasMode: 'normal',
  defaultZoom: 14,
  detailZoom: 18,
  precisionZoom: 20,
  minFeaturePixelSize: 4,
  snapping: {
    enabled: false,
    vertex: true,
    edge: true,
    midpoint: true,
    grid: false,
    distancePx: 12,
  },
  measurement: {
    distanceUnit: 'm',
    areaUnit: 'm2',
    precision: 2,
  },
}

interface SpatialEditorProps {
  projectId: string
  onBack: () => void
}

export function SpatialEditor(props: SpatialEditorProps) {
  return (
    <MapProvider>
      <SpatialEditorInner {...props} />
    </MapProvider>
  )
}

interface InlineTextBoxEditorProps {
  map: MapLibreMap | null
  draft: { start: Position; end: Position; text: string }
  onChange: (text: string) => void
  onCommit: () => void
  onCancel: () => void
}

function InlineTextBoxEditor({
  map,
  draft,
  onChange,
  onCommit,
  onCancel,
}: InlineTextBoxEditorProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const cancelRef = useRef(false)
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!map) return
    let frame = 0
    const updateBox = () => {
      const start = map.project([draft.start[0], draft.start[1]])
      const end = map.project([draft.end[0], draft.end[1]])
      const left = Math.min(start.x, end.x)
      const top = Math.min(start.y, end.y)
      const width = Math.max(96, Math.abs(end.x - start.x))
      const height = Math.max(44, Math.abs(end.y - start.y))
      setBox({ left, top, width, height })
    }
    const schedule = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updateBox)
    }
    map.on('move', schedule)
    map.on('zoom', schedule)
    map.on('resize', schedule)
    schedule()
    return () => {
      window.cancelAnimationFrame(frame)
      map.off('move', schedule)
      map.off('zoom', schedule)
      map.off('resize', schedule)
    }
  }, [draft.end, draft.start, map])

  if (!box) return null

  return (
    <textarea
      ref={inputRef}
      value={draft.text}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => {
        if (!cancelRef.current) onCommit()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        cancelRef.current = true
        onCancel()
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing || event.key === 'Process') {
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          cancelRef.current = true
          onCancel()
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          onCommit()
        }
      }}
      className="absolute z-30 resize-none rounded-sm border border-sky-400 bg-white/95 p-1.5 text-sm text-slate-950 shadow-lg outline-none ring-2 ring-sky-300/40"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      }}
    />
  )
}

function SpatialEditorInner({ projectId, onBack }: SpatialEditorProps) {
  const { map, mapReady, mapLoaded, mapZoom, containerRef } = useMapContext()
  const isMountedRef = useRef(false)
  const fittedProjectIdRef = useRef<string | null>(null)
  const modeRef = useRef<DrawMode>('select')
  const snapPreviewRef = useRef<SnapPreview | null>(null)
  const draftPointsRef = useRef<Position[]>([])
  const selectedFeatureIdsRef = useRef<string[]>([])
  const visibleFeaturesRef = useRef<Feature[]>([])
  const tempFeatureCounterRef = useRef(0)
  const rotateSessionRef = useRef<RotateSessionState | null>(null)
  const rotatePreviewRef = useRef<Record<string, Geometry>>({})
  const rotatePreviewFrameRef = useRef<number | null>(null)

  // --- Core state ---
  const [project, setProject] = useState<DrawingProject | null>(null)
  const [serverFeatures, setServerFeatures] = useState<Feature[]>([])
  const [pendingCreatedFeatures, setPendingCreatedFeatures] = useState<Feature[]>([])
  const [pendingUpdatedFeatures, setPendingUpdatedFeatures] = useState<Record<string, Feature>>({})
  const [pendingDeletedFeatureIds, setPendingDeletedFeatureIds] = useState<string[]>([])
  const [userMode, setUserMode] = useState<DrawMode>('select')
  const [draftPoints, setDraftPoints] = useState<Position[]>([])
  const [hoverCoordinate, setHoverCoordinate] = useState<Position | null>(null)
  const [message, setMessage] = useState('Loading project...')
  const [isSaving, setIsSaving] = useState(false)
  const [boundaryRendered, setBoundaryRendered] = useState(false)
  const [snapPreview, setSnapPreview] = useState<SnapPreview | null>(null)
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null)
  const [showFloorSelector, setShowFloorSelector] = useState(false)
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState('')
  const [inspectorDraft, setInspectorDraft] = useState({ name: '', tag: '', noteText: '' })
  const [isSavingInspector, setIsSavingInspector] = useState(false)
  const [isCreatingFloor, setIsCreatingFloor] = useState(false)
  const [isUpdatingFloor, setIsUpdatingFloor] = useState(false)
  const [textBoxDraft, setTextBoxDraft] = useState<{ start: Position; end: Position; text: string } | null>(null)
  const [boxShapeVariant, setBoxShapeVariant] = useState<BoxShapeVariant | null>(null)
  const [rotatePreviewByFeatureId, setRotatePreviewByFeatureId] = useState<Record<string, Geometry>>({})

  // --- Child project navigation ---
  const [projectStack, setProjectStack] = useState<Array<{ id: string; name: string }>>([])
  const [activeProjectId, setActiveProjectId] = useState(projectId)

  // --- Refs for feature fetch ---
  const visibleFeaturesRequestRef = useRef<AbortController | null>(null)
  const featureFetchTimerRef = useRef<number | null>(null)

  // --- Derived state ---
  const projectConfig = useMemo<ProjectCanvasConfig>(() => {
    const config = project?.config
    if (!config) {
      return DEFAULT_PROJECT_CONFIG
    }
    return {
      ...DEFAULT_PROJECT_CONFIG,
      ...config,
      snapping: { ...DEFAULT_PROJECT_CONFIG.snapping, ...config.snapping },
      measurement: { ...DEFAULT_PROJECT_CONFIG.measurement, ...config.measurement },
    }
  }, [project])

  const mode = useMemo<DrawMode>(() => userMode, [userMode])

  const activeFeatureType = featureTypeForMode(mode)
  const currentDraftCollection = draftToFeatures(mode, draftPoints, activeFeatureType, hoverCoordinate, map, boxShapeVariant)
  const toolsEnabled = mapReady

  const featureIdForState = useCallback((feature: Feature) => String(feature.id ?? feature.properties?.id ?? ''), [])

  const visibleFeatures = useMemo(() => {
    const deleted = new Set(pendingDeletedFeatureIds)
    const updated = pendingUpdatedFeatures
    const merged = serverFeatures
      .filter((feature) => {
        const id = featureIdForState(feature)
        return !deleted.has(id)
      })
      .map((feature) => updated[featureIdForState(feature)] ?? feature)
    return [...merged, ...pendingCreatedFeatures]
  }, [featureIdForState, pendingCreatedFeatures, pendingDeletedFeatureIds, pendingUpdatedFeatures, serverFeatures])

  const draftCollection = currentDraftCollection
  const localDraftFeatureIds = useMemo(
    () => [
      ...pendingCreatedFeatures.map((feature) => featureIdForState(feature)),
      ...Object.keys(pendingUpdatedFeatures),
    ],
    [featureIdForState, pendingCreatedFeatures, pendingUpdatedFeatures],
  )

  const makeDraftFeatureId = useCallback(() => {
    tempFeatureCounterRef.current += 1
    return `draft-local-${tempFeatureCounterRef.current}`
  }, [])

  // Derive floor info
  const floors = useMemo(() => {
    if (!project) return []
    return [...project.floors].sort((a, b) => a.sortOrder - b.sortOrder)
  }, [project])

  const hasFloors = floors.length > 0
  const floorRequired = project?.editorMode === 'building' || project?.editorMode === 'indoor'
  const canShowFloorSelector = Boolean(floorRequired || hasFloors)
  const canDrawOnFloor = !floorRequired || Boolean(selectedFloorId)

  // --- Sync refs ---
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    return () => {
      if (rotatePreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(rotatePreviewFrameRef.current)
        rotatePreviewFrameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    snapPreviewRef.current = snapPreview
  }, [snapPreview])

  useEffect(() => {
    draftPointsRef.current = draftPoints
  }, [draftPoints])

  useEffect(() => {
    selectedFeatureIdsRef.current = selectedFeatureIds
  }, [selectedFeatureIds])

  useEffect(() => {
    visibleFeaturesRef.current = visibleFeatures
  }, [visibleFeatures])

  useEffect(() => {
    if (!canDrawOnFloor && !['select', 'move'].includes(userMode)) {
      const timer = window.setTimeout(() => setUserMode('select'), 0)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [canDrawOnFloor, userMode])

  useEffect(() => {
    if (!map) return
    if (mode === 'move') {
      map.dragPan.enable()
      map.getCanvas().style.cursor = 'grab'
    } else {
      map.dragPan.disable()
      map.getCanvas().style.cursor = ''
    }
  }, [map, mode])

  // --- Stable callbacks ---
  const handleSetMode = useCallback((newMode: DrawMode) => {
    if (!canDrawOnFloor && !['select', 'move'].includes(newMode)) {
      setMessage('Select a floor before drawing')
      return
    }
    setBoxShapeVariant(null)
    setUserMode(newMode)
  }, [canDrawOnFloor])

  const handleZoomIn = useCallback(() => {
    if (!map) return
    map.zoomIn({ duration: 120 })
  }, [map])

  const handleZoomOut = useCallback(() => {
    if (!map) return
    const nextZoom = Math.max(10, map.getZoom() - 1)
    map.easeTo({ zoom: nextZoom, duration: 120 })
  }, [map])

  const isMounted = useCallback(() => isMountedRef.current, [])

  const handleBoundaryRendered = useCallback(() => {
    setBoundaryRendered(true)
  }, [])

  const handleMessage = useCallback((msg: string) => {
    setMessage(msg)
  }, [])

  const flushRotatePreview = useCallback(() => {
    rotatePreviewFrameRef.current = null
    setRotatePreviewByFeatureId({ ...rotatePreviewRef.current })
  }, [])

  const scheduleRotatePreviewFlush = useCallback(() => {
    if (rotatePreviewFrameRef.current !== null) {
      return
    }
    rotatePreviewFrameRef.current = window.requestAnimationFrame(flushRotatePreview)
  }, [flushRotatePreview])

  const handleSnapPreview = useCallback((snap: SnapPreview | null) => {
    setSnapPreview(snap)
  }, [])

  const handleHoverCoordinate = useCallback((coord: Position) => {
    setHoverCoordinate(coord)
  }, [])

  const buildFeatureForStorage = useCallback((feature: Feature, featureType: string) => {
    if (!project) return null
    return {
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        featureType,
        tag: String((feature.properties as Record<string, unknown> | undefined)?.tag ?? ''),
        noteText: String((feature.properties as Record<string, unknown> | undefined)?.noteText ?? ''),
        minZoom: (feature.properties as Record<string, unknown> | undefined)?.minZoom ?? project.boundaryMinZoom,
        maxZoom: (feature.properties as Record<string, unknown> | undefined)?.maxZoom ?? 24,
        floorId: (feature.properties as Record<string, unknown> | undefined)?.floorId ?? selectedFloorId ?? null,
      },
    } as Feature
  }, [project, selectedFloorId])

  const buildFinalFeatureFromPoints = useCallback((
    targetMode: DrawMode,
    points: Position[],
    targetFeatureType: string,
    shapeVariant: BoxShapeVariant | null = null,
  ) => {
    if (!project) return null
    const collection = draftToFeatures(targetMode, points, targetFeatureType, null, map, shapeVariant)
    const finalFeature = collection?.features.find(
      (feature) =>
        !feature.properties?.isDraftVertex &&
        (feature.geometry.type === 'Polygon' || feature.geometry.type === 'LineString' || feature.geometry.type === 'Point'),
    )
    if (!finalFeature) return null
    if (!featureInsideBoundary(finalFeature as Feature, project, map)) {
      return null
    }
    return buildFeatureForStorage(finalFeature as Feature, targetFeatureType)
  }, [buildFeatureForStorage, map, project])

  const stageCreatedFeature = useCallback((feature: Feature, options?: { select?: boolean }) => {
    const nextFeature: Feature = {
      ...feature,
      id: feature.id ?? makeDraftFeatureId(),
      properties: {
        ...(feature.properties ?? {}),
      },
    }
    setPendingCreatedFeatures((current) => [...current, nextFeature])
    if (options?.select) {
      setSelectedFeatureIds([String(nextFeature.id ?? nextFeature.properties?.id ?? '')])
    }
  }, [makeDraftFeatureId])

  const applyLocalFeatureUpdate = useCallback(
    (featureIds: string[], updateFeature: (feature: Feature) => Feature) => {
      const featureSet = new Set(featureIds)
      const currentVisible = visibleFeaturesRef.current
      const pendingCreatedIds = new Set(pendingCreatedFeatures.map((feature) => featureIdForState(feature)))
      setPendingCreatedFeatures((current) =>
        current.map((feature) => {
          const id = featureIdForState(feature)
          return featureSet.has(id) ? updateFeature(feature) : feature
        }),
      )
      setPendingUpdatedFeatures((current) => {
        const next = { ...current }
        for (const featureId of featureIds) {
          if (pendingCreatedIds.has(featureId)) {
            continue
          }
          const existingPending = current[featureId]
          const baseFeature =
            existingPending ??
            currentVisible.find((feature) => featureIdForState(feature) === featureId)
          if (!baseFeature) continue
          next[featureId] = updateFeature(baseFeature)
        }
        return next
      })
    },
    [featureIdForState, pendingCreatedFeatures],
  )

  const currentSavableDraftFeature = useMemo(
    () => buildFinalFeatureFromPoints(mode, draftPoints, activeFeatureType, boxShapeVariant),
    [activeFeatureType, boxShapeVariant, buildFinalFeatureFromPoints, draftPoints, mode],
  )
  const hasPendingChanges = Boolean(
    pendingCreatedFeatures.length > 0 ||
    Object.keys(pendingUpdatedFeatures).length > 0 ||
    pendingDeletedFeatureIds.length > 0 ||
    currentSavableDraftFeature,
  )

  // --- Hooks ---
  useSnapEngine({
    map,
    project,
    projectConfig,
    visibleFeatures,
    toolsEnabled,
    isMounted,
    onSnapPreview: handleSnapPreview,
    onHoverCoordinate: handleHoverCoordinate,
  })

  // --- Save / Publish ---
  const persistDraftChanges = useCallback(async (statusMessage = 'Saving draft...') => {
    const createdFeatures = [...pendingCreatedFeatures, ...(currentSavableDraftFeature ? [currentSavableDraftFeature] : [])]
    const updatedFeatures = Object.values(pendingUpdatedFeatures)
    if (!project || !toolsEnabled || !canDrawOnFloor) {
      if (!canDrawOnFloor) {
        setMessage('Select a floor before saving')
      }
      return false
    }
    if (createdFeatures.length === 0 && updatedFeatures.length === 0 && pendingDeletedFeatureIds.length === 0) {
      return true
    }
    setIsSaving(true)
    setMessage(statusMessage)
    try {
      const savedCreated = await Promise.all(
        createdFeatures.map(async (feature) => {
          const featureCopy = {
            ...feature,
            properties: { ...(feature.properties ?? {}) },
          }
          if (String(featureCopy.id ?? '').startsWith('draft-local-')) {
            delete featureCopy.id
          }
          const response = await saveDrawingFeature(project.id, featureCopy)
          return { localId: featureIdForState(feature), feature: response.feature }
        }),
      )
      const savedUpdated = await Promise.all(
        updatedFeatures.map(async (feature) => {
          const response = await saveDrawingFeature(project.id, feature)
          return response.feature
        }),
      )
      await Promise.all(
        pendingDeletedFeatureIds.map((featureId) => deleteDrawingFeature(project.id, featureId)),
      )
      if (!isMountedRef.current) {
        return
      }
      setServerFeatures((current) => {
        const deleted = new Set(pendingDeletedFeatureIds)
        const updated = new Map(savedUpdated.map((feature) => [featureIdForState(feature), feature]))
        const next = current
          .filter((feature) => !deleted.has(featureIdForState(feature)))
          .map((feature) => updated.get(featureIdForState(feature)) ?? feature)
        savedCreated.forEach(({ feature }) => {
          next.push(feature)
        })
        return next
      })
      const createdIdMap = new Map(savedCreated.map(({ localId, feature }) => [localId, featureIdForState(feature)]))
      setSelectedFeatureIds((current) =>
        current
          .filter((id) => !pendingDeletedFeatureIds.includes(id))
          .map((id) => createdIdMap.get(id) ?? id),
      )
      setPendingCreatedFeatures([])
      setPendingUpdatedFeatures({})
      setPendingDeletedFeatureIds([])
      setMessage('Draft feature saved')
      setDraftPoints([])
      setBoxShapeVariant(null)
      return true
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Save failed')
      }
      return false
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false)
      }
    }
  }, [
    project,
    toolsEnabled,
    pendingCreatedFeatures,
    pendingDeletedFeatureIds,
    pendingUpdatedFeatures,
    canDrawOnFloor,
    currentSavableDraftFeature,
    featureIdForState,
  ])

  const handleSaveDraft = useCallback(async () => {
    if (mode === 'delete_lasso') {
      return
    }
    const didPersist = await persistDraftChanges()
    if (didPersist && !hasPendingChanges) {
      setMessage('Nothing to save')
    }
  }, [hasPendingChanges, mode, persistDraftChanges])

  const handleDeleteFeatures = useCallback(
    async (featureIds: string[]) => {
      if (featureIds.length === 0) {
        return
      }
      const featureSet = new Set(featureIds)
      setPendingCreatedFeatures((current) =>
        current.filter((feature) => !featureSet.has(featureIdForState(feature))),
      )
      setPendingUpdatedFeatures((current) => {
        const next = { ...current }
        featureIds.forEach((featureId) => {
          delete next[featureId]
        })
        return next
      })
      setPendingDeletedFeatureIds((current) => {
        const next = new Set(current)
        featureIds.forEach((featureId) => {
          const existsOnServer = serverFeatures.some((feature) => featureIdForState(feature) === featureId)
          if (existsOnServer) {
            next.add(featureId)
          }
        })
        return Array.from(next)
      })
      setSelectedFeatureIds((current) => current.filter((id) => !featureIds.includes(id)))
      setMessage('Deletion staged')
    },
    [featureIdForState, serverFeatures],
  )

  const selectedFeatures = useMemo(() => {
    if (selectedFeatureIds.length === 0) return []
    const selectedSet = new Set(selectedFeatureIds)
    return visibleFeatures.filter((feature) => selectedSet.has(String(feature.id ?? feature.properties?.id ?? '')))
  }, [selectedFeatureIds, visibleFeatures])

  const handleMoveFeatures = useCallback((featureIds: string[], deltaLng: number, deltaLat: number) => {
    if (featureIds.length === 0) return
    if (!project || !map) return
    const selectedSet = new Set(featureIds)
    const nextFeatures = visibleFeatures.filter((feature) => selectedSet.has(featureIdForState(feature)))
    const canMove = nextFeatures.every((feature) =>
      featureInsideBoundary(translateFeatureGeometry(feature, deltaLng, deltaLat), project, map),
    )
    if (!canMove) {
      setMessage('Move rejected: feature must stay inside the project base boundary')
      return
    }
    applyLocalFeatureUpdate(featureIds, (feature) => translateFeatureGeometry(feature, deltaLng, deltaLat))
  }, [applyLocalFeatureUpdate, featureIdForState, map, project, visibleFeatures])

  const handlePersistMovedFeatures = useCallback(async (featureIds: string[]) => {
    if (featureIds.length === 0) return
    setMessage('Move staged in draft')
  }, [])

  const startRotateSession = useCallback((featureIds: string[]) => {
    if (!project || featureIds.length === 0) {
      return
    }
    const selectedSet = new Set(featureIds)
    const selected = visibleFeaturesRef.current.filter((feature) => selectedSet.has(featureIdForState(feature)))
    if (selected.length === 0) {
      return
    }

    const baseFeatureById: Record<string, Feature> = {}
    const lastValidGeometryByFeatureId: Record<string, Geometry> = {}
    selected.forEach((feature) => {
      const featureId = featureIdForState(feature)
      baseFeatureById[featureId] = feature
      lastValidGeometryByFeatureId[featureId] = feature.geometry as Geometry
    })

    rotateSessionRef.current = {
      featureIds: [...featureIds],
      baseFeatureById,
      accumulatedAngleDeg: 0,
      lastValidAngleDeg: 0,
      lastValidGeometryByFeatureId,
      boundaryGeometry: project.baseGeometry,
    }
    rotatePreviewRef.current = {}
    scheduleRotatePreviewFlush()
  }, [featureIdForState, project, scheduleRotatePreviewFlush])

  const applyRotateGestureDelta = useCallback((featureIds: string[], deltaDeg: number) => {
    const session = rotateSessionRef.current
    if (!session || featureIds.length === 0) {
      return { blocked: false }
    }
    const sameSelection =
      featureIds.length === session.featureIds.length &&
      featureIds.every((id) => session.featureIds.includes(id))
    if (!sameSelection) {
      return { blocked: true }
    }

    const candidateAngle = session.accumulatedAngleDeg + deltaDeg
    const candidateGeometryByFeatureId: Record<string, Geometry> = {}
    for (const featureId of session.featureIds) {
      const baseFeature = session.baseFeatureById[featureId]
      if (!baseFeature) {
        return { blocked: true }
      }
      const rotated = rotateFeatureGeometry(baseFeature, candidateAngle)
      const candidateGeometry = rotated.geometry as Geometry
      if (!geometryInsideBoundaryStrict(candidateGeometry, session.boundaryGeometry)) {
        session.accumulatedAngleDeg = candidateAngle
        rotatePreviewRef.current = { ...session.lastValidGeometryByFeatureId }
        scheduleRotatePreviewFlush()
        return { blocked: true }
      }
      candidateGeometryByFeatureId[featureId] = candidateGeometry
    }

    session.accumulatedAngleDeg = candidateAngle
    session.lastValidAngleDeg = candidateAngle
    session.lastValidGeometryByFeatureId = candidateGeometryByFeatureId
    rotatePreviewRef.current = candidateGeometryByFeatureId
    scheduleRotatePreviewFlush()
    return { blocked: false }
  }, [scheduleRotatePreviewFlush])

  const endRotateSession = useCallback((featureIds: string[]) => {
    const session = rotateSessionRef.current
    if (!session) {
      return
    }
    const sameSelection =
      featureIds.length === session.featureIds.length &&
      featureIds.every((id) => session.featureIds.includes(id))
    if (!sameSelection) {
      return
    }

    applyLocalFeatureUpdate(session.featureIds, (feature) => {
      const featureId = featureIdForState(feature)
      const geometry = session.lastValidGeometryByFeatureId[featureId]
      if (!geometry) {
        return feature
      }
      return {
        ...feature,
        geometry,
      }
    })

    rotateSessionRef.current = null
    rotatePreviewRef.current = {}
    scheduleRotatePreviewFlush()
  }, [applyLocalFeatureUpdate, featureIdForState, scheduleRotatePreviewFlush])

  const handleRotateSelected = useCallback((angleDeg: number) => {
    const featureIds = [...selectedFeatureIdsRef.current]
    if (!project || featureIds.length === 0) return
    startRotateSession(featureIds)
    const result = applyRotateGestureDelta(featureIds, angleDeg)
    endRotateSession(featureIds)
    if (result.blocked) {
      setMessage('Rotation rejected: feature must stay inside the project base boundary')
      return
    }
    setMessage(`Rotation staged (${angleDeg > 0 ? '+' : ''}${angleDeg}deg)`)
  }, [applyRotateGestureDelta, endRotateSession, project, startRotateSession])

  const selectedBuildingFeature = useMemo(() => {
    if (!project || selectedFeatures.length !== 1) return null
    const target = selectedFeatures[0]
    return project.editorMode === 'campus' && target.geometry.type === 'Polygon' ? target : null
  }, [project, selectedFeatures])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedFeatures.length === 1) {
        const props = (selectedFeatures[0].properties ?? {}) as Record<string, unknown>
        setInspectorDraft({
          name: String(props.name ?? ''),
          tag: String(props.tag ?? ''),
          noteText: String(props.noteText ?? ''),
        })
        return
      }
      if (selectedFeatures.length > 1) {
        setInspectorDraft((current) => ({ ...current, name: '' }))
        return
      }
      setInspectorDraft({ name: '', tag: '', noteText: '' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [selectedFeatures])

  const handleSaveInspector = useCallback(async () => {
    if (selectedFeatures.length === 0) return
    setIsSavingInspector(true)
    setMessage('Saving inspector changes...')
    try {
      applyLocalFeatureUpdate(
        selectedFeatures.map((feature) => featureIdForState(feature)),
        (feature) => ({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            ...(selectedFeatures.length === 1 ? { name: inspectorDraft.name } : {}),
            tag: inspectorDraft.tag,
            noteText: inspectorDraft.noteText,
            floorId: (feature.properties as Record<string, unknown> | undefined)?.floorId ?? selectedFloorId ?? null,
          },
        }),
      )
      setMessage('Inspector changes staged')
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Save metadata failed')
      }
    } finally {
      if (isMountedRef.current) {
        setIsSavingInspector(false)
      }
    }
  }, [applyLocalFeatureUpdate, featureIdForState, inspectorDraft.name, inspectorDraft.noteText, inspectorDraft.tag, selectedFeatures, selectedFloorId])

  const handleStartTextBox = useCallback((start: Position, end: Position) => {
    setTextBoxDraft({ start, end, text: '' })
  }, [])

  const handleCommitTextBox = useCallback(async () => {
    if (!textBoxDraft || !project || !toolsEnabled || !canDrawOnFloor) {
      if (!canDrawOnFloor) setMessage('Select a floor before adding text')
      setTextBoxDraft(null)
      setUserMode('select')
      return
    }
    const value = textBoxDraft.text.trim()
    if (!value) {
      setTextBoxDraft(null)
      setUserMode('select')
      return
    }
    const { start, end } = textBoxDraft
    const p1: Position = [start[0], start[1]]
    const p2: Position = [end[0], start[1]]
    const p3: Position = [end[0], end[1]]
    const p4: Position = [start[0], end[1]]
    try {
      const nextTextFeature = {
        type: 'Feature',
        id: makeDraftFeatureId(),
        geometry: { type: 'Polygon', coordinates: [[p1, p2, p3, p4, p1]] },
        properties: {
          featureType: 'text_label',
          shapeKind: 'text_box',
          text: value,
          textStyle: {
            fontSize: 14,
            color: '#0f172a',
            align: 'left',
          },
          name: value,
          tag: value,
          noteText: '',
          floorId: selectedFloorId ?? null,
          minZoom: project.boundaryMinZoom,
          maxZoom: 24,
        },
      } as Feature
      if (!featureInsideBoundary(nextTextFeature, project, map)) {
        setMessage('Text box rejected: it must stay inside the project base boundary')
        return
      }
      stageCreatedFeature(nextTextFeature, { select: false })
      setMessage('Text staged in draft')
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Create text failed')
      }
    } finally {
      if (isMountedRef.current) {
        setTextBoxDraft(null)
        setUserMode('select')
      }
    }
  }, [canDrawOnFloor, makeDraftFeatureId, map, project, selectedFloorId, stageCreatedFeature, textBoxDraft, toolsEnabled])

  const handleCancelTextBox = useCallback(() => {
    setTextBoxDraft(null)
    setUserMode('select')
  }, [])

  const handleQuickCreateTextBox = useCallback((start: Position, end: Position) => {
    if (!project || !toolsEnabled || !canDrawOnFloor) {
      if (!canDrawOnFloor) setMessage('Select a floor before adding text')
      return
    }
    handleStartTextBox(start, end)
  }, [canDrawOnFloor, handleStartTextBox, project, toolsEnabled])

  const handleLassoSelection = useCallback((start?: Position, end?: Position) => {
    const lassoStart = start ?? draftPoints[0]
    const lassoEnd = end ?? draftPoints[draftPoints.length - 1]
    if (!project || !lassoStart || !lassoEnd) {
      setMessage('Draw a selection rectangle')
      return
    }
    const minLng = Math.min(lassoStart[0], lassoEnd[0])
    const maxLng = Math.max(lassoStart[0], lassoEnd[0])
    const minLat = Math.min(lassoStart[1], lassoEnd[1])
    const maxLat = Math.max(lassoStart[1], lassoEnd[1])

    const pointInRect = (point: Position) =>
      point[0] >= minLng &&
      point[0] <= maxLng &&
      point[1] >= minLat &&
      point[1] <= maxLat

    const intersectsLasso = (feature: Feature) => {
      const geometry = feature.geometry
      if (!geometry) return false
      if (geometry.type === 'Point') {
        return pointInRect(geometry.coordinates as Position)
      }
      if (geometry.type === 'LineString') {
        return (geometry.coordinates as Position[]).some((coord) => pointInRect(coord))
      }
      if (geometry.type === 'Polygon') {
        return geometry.coordinates.some((ringCoords) =>
          ringCoords.some((coord) => pointInRect(coord as Position)),
        )
      }
      return false
    }

    const featureIds = visibleFeatures
      .filter(intersectsLasso)
      .map((feature) => feature.id ?? feature.properties?.id)
      .filter((id): id is string | number => Boolean(id))
      .map((id) => String(id))
    setSelectedFeatureIds(featureIds)
    setMessage(featureIds.length > 0 ? `Selected ${featureIds.length} object(s)` : 'No objects selected')
    setDraftPoints([])
    setUserMode('select')
  }, [draftPoints, project, visibleFeatures])

  const handleFinalizeCurrentDraft = useCallback(() => {
    if (modeRef.current === 'delete_lasso') {
      handleLassoSelection()
      return
    }
    if (!currentSavableDraftFeature) {
      setMessage('Draft shape is invalid or extends outside the project base boundary')
      return
    }
    stageCreatedFeature(currentSavableDraftFeature, { select: false })
    setDraftPoints([])
    setBoxShapeVariant(null)
    setMessage('Shape added to draft')
  }, [currentSavableDraftFeature, handleLassoSelection, stageCreatedFeature])

  useDrawingEngine({
    map,
    project,
    toolsEnabled,
    isMounted,
    modeRef,
    snapPreviewRef,
    selectedFeatureIdsRef,
    visibleFeaturesRef,
    draftPointsRef,
    onAddPoint: setDraftPoints,
    onClearDraftPoints: () => setDraftPoints([]),
    onClearSnapPreview: () => setSnapPreview(null),
    onCancelExternalDrafts: () => {
      if (!textBoxDraft) return false
      handleCancelTextBox()
      return true
    },
    onSaveDraft: handleFinalizeCurrentDraft,
    onMessage: handleMessage,
    onSetSelection: setSelectedFeatureIds,
    onDeleteFeatures: handleDeleteFeatures,
    onMoveFeatures: handleMoveFeatures,
    onMoveEnd: handlePersistMovedFeatures,
    onSetBoxShapeVariant: setBoxShapeVariant,
    onRotateGestureStart: (featureIds) => {
      startRotateSession(featureIds)
    },
    onRotateGestureDelta: (featureIds, angleDeg) => {
      return applyRotateGestureDelta(featureIds, angleDeg)
    },
    onRotateGestureEnd: (featureIds) => {
      endRotateSession(featureIds)
    },
    onQuickCreateTextBox: handleQuickCreateTextBox,
    onCompleteBoxShape: (shapeMode, start, end) => {
      const baseMode = shapeMode === 'circle' ? 'ellipse' : shapeMode
      const nextFeature = buildFinalFeatureFromPoints(
        baseMode,
        [start, end],
        featureTypeForMode(baseMode),
        shapeMode,
      )
      if (!nextFeature) {
        setDraftPoints([])
        setBoxShapeVariant(null)
        setMessage('Shape rejected: it must stay inside the project base boundary')
        return
      }
      stageCreatedFeature(nextFeature, { select: false })
      setBoxShapeVariant(null)
      setMessage('Shape added to draft')
    },
    onCompletePenPath: (points) => {
      const nextFeature = buildFinalFeatureFromPoints('pen', points, featureTypeForMode('pen'))
      if (!nextFeature) {
        setDraftPoints([])
        setMessage('Stroke rejected: it must stay inside the project base boundary')
        return
      }
      stageCreatedFeature(nextFeature, { select: false })
      setMessage('Stroke added to draft')
    },
    onCompleteLasso: (start, end) => {
      handleLassoSelection(start, end)
    },
  })

  useMapRenderer({
    map,
    mapReady,
    mapLoaded,
    mapZoom,
    project,
    projectConfig,
    visibleFeatures,
    selectedFeatureIds,
    draftCollection,
    snapPreview,
    isMounted,
    onBoundaryRendered: handleBoundaryRendered,
    onMessage: handleMessage,
  })

  // --- Project data loading ---
  // Load data when activeProjectId changes
  useEffect(() => {
    const abortController = new AbortController()

    const loadProjectData = async () => {
      if (isMountedRef.current) {
        rotateSessionRef.current = null
        rotatePreviewRef.current = {}
        setRotatePreviewByFeatureId({})
        setProject(null)
        setServerFeatures([])
        setPendingCreatedFeatures([])
        setPendingUpdatedFeatures({})
        setPendingDeletedFeatureIds([])
        setDraftPoints([])
        setUserMode('select')
        setSelectedFeatureIds([])
        setBoundaryRendered(false)
        setMessage('Loading project...')
      }
      try {
        const nextProject = await fetchDrawingProject(activeProjectId, abortController.signal)
        if (!isMountedRef.current || abortController.signal.aborted) {
          return
        }
        let loadedProject = nextProject
        const shouldCreateDefaultFloor =
          (nextProject.editorMode === 'building' || nextProject.editorMode === 'indoor') &&
          nextProject.floors.length === 0
        if (shouldCreateDefaultFloor) {
          setMessage('Creating default floor...')
          try {
            const floorResponse = await createProjectFloor(nextProject.id, {
              label: 'F1',
              code: 'F1',
              level: 1,
              sortOrder: 0,
            })
            if (!isMountedRef.current || abortController.signal.aborted) return
            loadedProject = { ...nextProject, floors: floorResponse.floors }
            setSelectedFloorId(floorResponse.floor.id)
            setMessage('Default floor created')
          } catch (floorError) {
            if (isMountedRef.current && !abortController.signal.aborted) {
              setMessage(floorError instanceof Error ? floorError.message : 'Default floor creation failed')
            }
          }
        } else if (nextProject.floors.length > 0) {
          setSelectedFloorId(nextProject.floors[0].id)
        } else {
          setSelectedFloorId(null)
        }
        setProject(loadedProject)
        setServerFeatures([])
        setPendingCreatedFeatures([])
        setPendingUpdatedFeatures({})
        setPendingDeletedFeatureIds([])
        setShowFloorSelector(false)
        if (!shouldCreateDefaultFloor) {
          setMessage('Project data loaded')
        }
      } catch (error) {
        if (!isMountedRef.current || abortController.signal.aborted) {
          return
        }
        setMessage(error instanceof Error ? error.message : 'Project failed to load')
      }
    }

    loadProjectData()
    return () => {
      abortController.abort()
    }
  }, [activeProjectId])

  useEffect(() => {
    const handleModeShortcuts = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (event.isComposing || event.key === 'Process' || isEditableEventTarget(event.target)) {
        return
      }
      if (key === 'v') {
        event.preventDefault()
        handleSetMode('select')
      } else if (key === 'm') {
        event.preventDefault()
        handleSetMode('move')
      } else if (key === 't') {
        event.preventDefault()
        handleSetMode('text')
      } else if (key === 'n') {
        event.preventDefault()
        handleSetMode('pen')
      } else if (key === 'l' && event.shiftKey) {
        event.preventDefault()
        handleSetMode('delete_lasso')
      } else if (key === 'l') {
        event.preventDefault()
        handleSetMode('line')
      } else if (key === 'r' && event.shiftKey) {
        event.preventDefault()
        handleSetMode('triangle')
      } else if (key === 'r') {
        event.preventDefault()
        handleSetMode('polygon')
      } else if (key === 'b') {
        event.preventDefault()
        handleSetMode('rectangle')
      } else if (key === 'o') {
        event.preventDefault()
        handleSetMode('ellipse')
      } else if (key === '+' || key === '=') {
        event.preventDefault()
        handleZoomIn()
      } else if (key === '-' || key === '_') {
        event.preventDefault()
        handleZoomOut()
      } else if (key === 'q' && selectedFeatureIdsRef.current.length > 0) {
        event.preventDefault()
        handleRotateSelected(-15)
      } else if (key === 'e' && selectedFeatureIdsRef.current.length > 0) {
        event.preventDefault()
        handleRotateSelected(15)
      }
    }
    window.addEventListener('keydown', handleModeShortcuts)
    return () => {
      window.removeEventListener('keydown', handleModeShortcuts)
    }
  }, [handleRotateSelected, handleSetMode, handleZoomIn, handleZoomOut])

  // --- Visible feature loading ---
  useEffect(() => {
    if (!map || !project || !mapReady) {
      return
    }
    if (featureFetchTimerRef.current) {
      window.clearTimeout(featureFetchTimerRef.current)
    }
    visibleFeaturesRequestRef.current?.abort()
    featureFetchTimerRef.current = window.setTimeout(async () => {
      const bounds = map.getBounds()
      const abortController = new AbortController()
      visibleFeaturesRequestRef.current = abortController
      try {
        const nextFeatures = await fetchProjectVisibleFeatures(
          {
            projectId: project.id,
            bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
            zoom: map.getZoom(),
            layerId: null,
            floorId: selectedFloorId,
          },
          abortController.signal,
        )
        if (!isMountedRef.current || abortController.signal.aborted) {
          return
        }
        setServerFeatures(nextFeatures)
        const visibleIds = new Set(
          [
            ...nextFeatures.map((feature) => featureIdForState(feature)),
            ...pendingCreatedFeatures.map((feature) => featureIdForState(feature)),
            ...Object.keys(pendingUpdatedFeatures),
          ]
            .filter((id) => !pendingDeletedFeatureIds.includes(id)),
        )
        setSelectedFeatureIds((current) => current.filter((id) => visibleIds.has(id)))
      } catch (error) {
        if (!isMountedRef.current || abortController.signal.aborted) {
          return
        }
        setMessage(error instanceof Error ? error.message : 'Visible feature loading failed')
      }
    }, 120)

    return () => {
      if (featureFetchTimerRef.current) {
        window.clearTimeout(featureFetchTimerRef.current)
        featureFetchTimerRef.current = null
      }
      visibleFeaturesRequestRef.current?.abort()
    }
  }, [featureIdForState, mapZoom, pendingCreatedFeatures, pendingDeletedFeatureIds, pendingUpdatedFeatures, project, map, mapReady, selectedFloorId])

  // Ensure we always auto-focus boundary when entering/opening a project.
  useEffect(() => {
    if (!map || !mapReady || !mapLoaded || !project) return
    if (fittedProjectIdRef.current === project.id) return

    const [minLng, minLat, maxLng, maxLat] = project.bbox
    const fit = () => {
      map.resize()
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: { top: 80, right: 100, bottom: 90, left: 100 }, duration: 0 },
      )
      fittedProjectIdRef.current = project.id
    }

    requestAnimationFrame(fit)
    const retryTimer = window.setTimeout(fit, 180)
    return () => window.clearTimeout(retryTimer)
  }, [map, mapLoaded, mapReady, project])

  const handlePublish = async () => {
    if (!project) {
      return
    }
    if (hasPendingChanges) {
      const didPersist = await persistDraftChanges('Saving draft before publish...')
      if (!didPersist) {
        return
      }
    }
    setIsSaving(true)
    setMessage('Publishing project...')
    try {
      const response = await publishDrawingProject(project.id)
      if (!isMountedRef.current) {
        return
      }
      setProject(response.project)
      setServerFeatures(response.project.features)
      setPendingCreatedFeatures([])
      setPendingUpdatedFeatures({})
      setPendingDeletedFeatureIds([])
      setMessage('Project published')
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Publish failed')
      }
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false)
      }
    }
  }

  const handleCreateFloor = useCallback(async () => {
    if (!project) return
    const nextLevel = project.floors.length > 0
      ? Math.max(...project.floors.map((floor) => floor.level)) + 1
      : 1
    const nextSort = project.floors.length > 0
      ? Math.max(...project.floors.map((floor) => floor.sortOrder)) + 1
      : 1
    setMessage('Creating floor...')
    setIsCreatingFloor(true)
    try {
      const response = await createProjectFloor(project.id, {
        label: `F${nextLevel}`,
        code: `F${nextLevel}`,
        level: nextLevel,
        sortOrder: nextSort,
      })
      if (!isMountedRef.current) return
      setProject((current) => (current ? { ...current, floors: response.floors } : current))
      setSelectedFloorId(response.floor.id)
      setMessage('Floor created')
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Create floor failed')
      }
    } finally {
      if (isMountedRef.current) {
        setIsCreatingFloor(false)
      }
    }
  }, [project])

  const handleUpdateFloor = useCallback(async (floor: { id: string; label: string; code: string; level: number; elevation?: number; visible: boolean; sortOrder: number }, updates: { label?: string; code?: string }) => {
    if (!project) return
    const nextLabel = (updates.label ?? floor.label).trim()
    const nextCode = (updates.code ?? floor.code).trim()
    if (!nextLabel || !nextCode) {
      setMessage('Floor label and code cannot be empty')
      return
    }
    setIsUpdatingFloor(true)
    setMessage('Updating floor...')
    try {
      const response = await updateProjectFloor(project.id, floor.id, {
        label: nextLabel,
        code: nextCode,
        level: floor.level,
        elevation: floor.elevation,
        visible: floor.visible,
        sortOrder: floor.sortOrder,
      })
      if (!isMountedRef.current) return
      setProject((current) => (current ? { ...current, floors: response.floors } : current))
      setMessage('Floor updated')
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Update floor failed')
      }
    } finally {
      if (isMountedRef.current) setIsUpdatingFloor(false)
    }
  }, [project])

  const handleDeleteFloor = useCallback(async (floor: { id: string }) => {
    if (!project) return
    setIsUpdatingFloor(true)
    setMessage('Deleting floor...')
    try {
      const response = await deleteProjectFloor(project.id, floor.id)
      if (!isMountedRef.current) return
      setProject((current) => (current ? { ...current, floors: response.floors } : current))
      if (selectedFloorId === floor.id) {
        const next = [...response.floors].sort((a, b) => a.sortOrder - b.sortOrder)[0]
        setSelectedFloorId(next?.id ?? null)
      }
      setMessage('Floor deleted')
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Delete floor failed')
      }
    } finally {
      if (isMountedRef.current) setIsUpdatingFloor(false)
    }
  }, [project, selectedFloorId])

  // --- Child project navigation handlers ---
  const handleOpenChildProject = useCallback(async (childProjectId: string) => {
    if (!project || !isMountedRef.current) return
    setProjectStack((stack) => [...stack, { id: project.id, name: project.name }])
    setActiveProjectId(childProjectId)
    setSelectedFeatureIds([])
  }, [project])

  const handleCreateChildProject = useCallback(async () => {
    if (!project || !selectedBuildingFeature || !isMountedRef.current) return
    const featureId = selectedBuildingFeature.id as string | undefined
    if (!featureId) {
      setMessage('Selected feature has no ID')
      return
    }
    try {
      setMessage('Creating indoor project...')
      const response = await createChildProject(project.id, featureId, {
        editorMode: 'indoor',
      })
      if (isMountedRef.current) {
        setProjectStack((stack) => [...stack, { id: project.id, name: project.name }])
        setActiveProjectId(response.childProjectId)
        setSelectedFeatureIds([])
      }
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Failed to create indoor project')
      }
    }
  }, [project, selectedBuildingFeature])

  const handleReturnToParent = useCallback(() => {
    setProjectStack((stack) => {
      if (stack.length === 0) return stack
      const parent = stack[stack.length - 1]
      setActiveProjectId(parent.id)
      return stack.slice(0, -1)
    })
    setSelectedFeatureIds([])
  }, [])

  // Breadcrumb trail
  const breadcrumb = useMemo(() => {
    if (projectStack.length === 0) return null
    return [...projectStack.map((p) => p.name), project?.name ?? ''].filter(Boolean)
  }, [project?.name, projectStack])

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-slate-100 text-slate-950">
      <EditorStructurePanel
        project={project}
        floors={floors}
        selectedFloorId={selectedFloorId}
        onSelectFloor={setSelectedFloorId}
        selectedFeatureIds={selectedFeatureIds}
        onSelectFeatureIds={setSelectedFeatureIds}
        visibleFeatures={visibleFeatures}
        tagFilter={tagFilter}
        onTagFilterChange={setTagFilter}
        onCreateFloor={handleCreateFloor}
        isCreatingFloor={isCreatingFloor}
        onUpdateFloor={handleUpdateFloor}
        onDeleteFloor={handleDeleteFloor}
        isUpdatingFloor={isUpdatingFloor}
      />

      <main className="drone-map relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-slate-200">
        <div
          ref={containerRef}
          className="absolute inset-0 h-full w-full"
          aria-label="Spatial editor map"
        />
        <button
          type="button"
          className="absolute left-4 top-4 z-30 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white/95 px-3 py-2 text-sm font-semibold text-slate-900 shadow-lg backdrop-blur transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-900"
          onClick={onBack}
          aria-label="Back to main map"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span>Main map</span>
        </button>
        <SpatialCanvasOverlay
          map={map}
          draftMode={mode}
          visibleFeatures={visibleFeatures}
          publishedFeatures={project?.publishedFeatures ?? []}
          localDraftFeatureIds={localDraftFeatureIds}
          selectedFeatureIds={selectedFeatureIds}
          draftCollection={draftCollection}
          snapPreview={snapPreview}
          rotatePreviewByFeatureId={rotatePreviewByFeatureId}
        />
        {textBoxDraft ? (
          <InlineTextBoxEditor
            map={map}
            draft={textBoxDraft}
            onChange={(text) => setTextBoxDraft((current) => (current ? { ...current, text } : current))}
            onCommit={handleCommitTextBox}
            onCancel={handleCancelTextBox}
          />
        ) : null}
        <EditorToolbox
          mode={mode}
          toolsEnabled={toolsEnabled}
          isSaving={isSaving}
          floorRequired={Boolean(floorRequired)}
          hasFloorSelection={Boolean(selectedFloorId)}
          onSetMode={handleSetMode}
          onClearDraft={() => setDraftPoints([])}
        />
        <EditorToolbar
          toolsEnabled={toolsEnabled}
          isSaving={isSaving}
          hasPendingChanges={
            pendingCreatedFeatures.length > 0 ||
            Object.keys(pendingUpdatedFeatures).length > 0 ||
            pendingDeletedFeatureIds.length > 0
          }
          hasSavableDraft={Boolean(currentSavableDraftFeature)}
          project={project}
          canDrawOnFloor={canDrawOnFloor}
          onSetMode={handleSetMode}
          onClearDraft={() => setDraftPoints([])}
          onSaveDraft={handleSaveDraft}
          onPublish={handlePublish}
          onBack={onBack}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          zoomLabel={`${Math.round(mapZoom * 10) / 10}x`}
        />
        {canShowFloorSelector ? (
          <button
            type="button"
            className="absolute right-4 top-4 z-30 rounded-lg border border-slate-300 bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-lg backdrop-blur transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800"
            onClick={() => setShowFloorSelector((value) => !value)}
          >
            Floors
          </button>
        ) : null}
        {canShowFloorSelector && showFloorSelector ? (
          <FloorSelector
            floors={floors}
            selectedFloorId={selectedFloorId}
            onSelectFloor={setSelectedFloorId}
            onCreateFloor={handleCreateFloor}
            isRequired={Boolean(floorRequired)}
          />
        ) : null}
        {selectedBuildingFeature ? (
          <BuildingEntryOverlay
            buildingName={String(selectedBuildingFeature.properties?.name ?? selectedBuildingFeature.properties?.featureType ?? 'Building')}
            hasChildProject={Boolean(selectedBuildingFeature.properties?.childProjectId)}
            onOpenIndoorMap={() => {
              const childId = selectedBuildingFeature.properties?.childProjectId
              if (childId) handleOpenChildProject(childId as string)
            }}
            onCreateIndoorMap={handleCreateChildProject}
          />
        ) : null}
        {breadcrumb && breadcrumb.length > 1 ? (
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-sm shadow-lg backdrop-blur">
            <button
              type="button"
              className="text-sky-600 hover:text-sky-800 hover:underline"
              onClick={handleReturnToParent}
            >
              ← {projectStack[projectStack.length - 1]?.name}
            </button>
            <span className="text-slate-400">/</span>
            <span className="font-medium text-slate-900">{project?.name}</span>
          </div>
        ) : null}
      </main>

        <EditorSidebar
          project={project}
          projectConfig={projectConfig}
        floors={floors}
        selectedFloorId={selectedFloorId}
        mapZoom={mapZoom}
        mapReady={mapReady}
        boundaryRendered={boundaryRendered}
        visibleFeatures={visibleFeatures}
        draftFeature={draftCollection}
        hoverCoordinate={hoverCoordinate}
        snapPreview={snapPreview}
        message={message}
        selectedFeatures={selectedFeatures}
          inspectorDraft={inspectorDraft}
          onInspectorDraftChange={setInspectorDraft}
          onSaveInspector={handleSaveInspector}
          isSavingInspector={isSavingInspector}
        />
    </div>
  )
}
