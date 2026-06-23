import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, Geometry, MultiPolygon, Position } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { ArrowLeft, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { DrawingProject, ProjectCanvasConfig, SpatialFeature } from './types'
import {
  createChildProject,
  fetchDrawingProject,
} from './services/projects'
import {
  deleteDrawingFeature,
  fetchProjectVisibleFeatures,
  saveDrawingFeature,
} from './services/features'
import { createProjectFloor } from './services/floors'
import { MapProvider, useMapContext } from './components/MapProvider'
import { EditorToolbar } from './components/EditorToolbar'
import { EditorToolbox } from './components/EditorToolbox'
import { EditorStructurePanel } from './components/EditorStructurePanel'
import { EditorSidebar } from './components/EditorSidebar'
import { FloorSelector } from './components/FloorSelector'
import { BuildingEntryOverlay } from './components/BuildingEntryOverlay'
import { SpatialCanvasOverlay } from './components/SpatialCanvasOverlay'
import { EditorBackdropPicker } from './components/EditorBackdropPicker'
import { useMapRenderer } from './hooks/useMapRenderer'
import { useSnapEngine, type SnapPreview } from './hooks/useSnapEngine'
import {
  useDrawingEngine,
  type BoxShapeVariant,
  type DrawMode,
  featureTypeForMode,
  draftToFeatures,
  featureInsideBoundary,
  rotateFeatureGeometry,
  translateFeatureGeometry,
} from './hooks/useDrawingEngine'
import { useEditorNotices } from './hooks/useEditorNotices'
import { useFloorManagement } from './hooks/useFloorManagement'
import { useImportScanJson } from './hooks/useImportScanJson'
import { usePublishProject } from './hooks/usePublishProject'
import { useInspectorFormState } from './hooks/useInspectorFormState'
import { geometryInsideBoundaryStrict } from './geometry/validation'
import { writeStoredMainMapCamera } from '../map/utils/mainMapCamera'
import {
  readStoredEditorBackdropMode,
  writeStoredEditorBackdropMode,
  type EditorBackdropMode,
} from './editorBackdropMode'

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

interface RotateSessionState {
  featureIds: string[]
  baseFeatureById: Record<string, Feature>
  accumulatedAngleDeg: number
  lastValidAngleDeg: number
  lastValidGeometryByFeatureId: Record<string, Geometry>
  boundaryGeometry: MultiPolygon
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
const DEFAULT_OBJECT_ID = 'object-default'

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
  const {
    map,
    mapReady,
    mapLoaded,
    mapZoom,
    containerRef,
  } = useMapContext()
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
  const isMounted = useCallback(() => isMountedRef.current, [])

  // --- Core state ---
  const [project, setProject] = useState<DrawingProject | null>(null)
  const [serverFeatures, setServerFeatures] = useState<Feature[]>([])
  const [pendingCreatedFeatures, setPendingCreatedFeatures] = useState<Feature[]>([])
  const [pendingUpdatedFeatures, setPendingUpdatedFeatures] = useState<Record<string, Feature>>({})
  const [pendingDeletedFeatureIds, setPendingDeletedFeatureIds] = useState<string[]>([])
  const [userMode, setUserMode] = useState<DrawMode>('select')
  const [featureTypeOverride, setFeatureTypeOverride] = useState<string | null>(null)
  const [draftPoints, setDraftPoints] = useState<Position[]>([])
  const [hoverCoordinate, setHoverCoordinate] = useState<Position | null>(null)
  const { message, setMessage } = useEditorNotices('Loading project...')
  const [isSaving, setIsSaving] = useState(false)
  const [boundaryRendered, setBoundaryRendered] = useState(false)
  const [snapPreview, setSnapPreview] = useState<SnapPreview | null>(null)
  const [showFloorSelector, setShowFloorSelector] = useState(false)
  const [backdropMode, setBackdropMode] = useState<EditorBackdropMode>(
    readStoredEditorBackdropMode,
  )
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false)
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(true)
  const [mobileStructureOpen, setMobileStructureOpen] = useState(false)
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false)
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState('')
  const [importPreviewFeatures, setImportPreviewFeatures] = useState<Feature[]>([])
  const [isSavingInspector, setIsSavingInspector] = useState(false)
  const [textBoxDraft, setTextBoxDraft] = useState<{ start: Position; end: Position; text: string } | null>(null)
  const [boxShapeVariant, setBoxShapeVariant] = useState<BoxShapeVariant | null>(null)
  const [rotatePreviewByFeatureId, setRotatePreviewByFeatureId] = useState<Record<string, Geometry>>({})
  const {
    preview: importPreview,
    error: importError,
    loading: importLoading,
    previewImport,
    commitImport,
    clearPreview: clearImportPreview,
  } = useImportScanJson()

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

  const activeFeatureType = featureTypeOverride ?? featureTypeForMode(mode)
  const currentDraftCollection = draftToFeatures(mode, draftPoints, activeFeatureType, hoverCoordinate, map, boxShapeVariant)
  const toolsEnabled = mapReady

  const featureIdForState = useCallback((feature: Feature) => String(feature.id ?? feature.properties?.id ?? ''), [])
  const featureFloorIdForState = useCallback((feature: Feature) => {
    const spatialFeature = feature as SpatialFeature
    return spatialFeature.floorId
      ?? (feature.properties as Record<string, unknown> | undefined)?.floorId
      ?? null
  }, [])

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

  const {
    floors,
    selectedFloorId,
    setSelectedFloorId,
    createFloor: handleCreateFloor,
    updateFloor: handleUpdateFloor,
    deleteFloor: handleDeleteFloor,
    isCreatingFloor,
    isUpdatingFloor,
  } = useFloorManagement({
    project,
    setProject,
    isMounted,
    onMessage: setMessage,
  })

  const hasFloors = floors.length > 0
  const floorRequired = project?.editorMode === 'building' || project?.editorMode === 'indoor'
  const canShowFloorSelector = Boolean(floorRequired || hasFloors)
  const canDrawOnFloor = !floorRequired || Boolean(selectedFloorId)

  const visibleFeatures = useMemo(() => {
    const deleted = new Set(pendingDeletedFeatureIds)
    const updated = pendingUpdatedFeatures
    const merged = serverFeatures
      .filter((feature) => {
        const id = featureIdForState(feature)
        return !deleted.has(id)
      })
      .map((feature) => updated[featureIdForState(feature)] ?? feature)
    const combined = [...merged, ...pendingCreatedFeatures]
    if (hasFloors) {
      if (!selectedFloorId) {
        return []
      }
      return combined.filter((feature) => featureFloorIdForState(feature) === selectedFloorId)
    }
    if (!selectedFloorId) {
      return combined
    }
    return combined.filter((feature) => featureFloorIdForState(feature) === selectedFloorId)
  }, [
    featureFloorIdForState,
    featureIdForState,
    hasFloors,
    pendingCreatedFeatures,
    pendingDeletedFeatureIds,
    pendingUpdatedFeatures,
    selectedFloorId,
    serverFeatures,
  ])

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
  const handleSetMode = useCallback((newMode: DrawMode, featureType: string | null = null) => {
    if (!canDrawOnFloor && !['select', 'move'].includes(newMode)) {
      setMessage('Select a floor before drawing')
      return
    }
    setBoxShapeVariant(null)
    // The toolbox is the only entry to a drawing mode, so it always passes the
    // intended feature type here (null for generic tools, 'no_fly_zone' for the
    // No-Fly Zone tool) — keeping the override in sync without a reset effect.
    setFeatureTypeOverride(featureType)
    setUserMode(newMode)
  }, [canDrawOnFloor, setMessage])

  const handleZoomIn = useCallback(() => {
    if (!map) return
    map.zoomIn({ duration: 120 })
  }, [map])

  const handleZoomOut = useCallback(() => {
    if (!map) return
    const nextZoom = Math.max(10, map.getZoom() - 1)
    map.easeTo({ zoom: nextZoom, duration: 120 })
  }, [map])

  const handleBoundaryRendered = useCallback(() => {
    setBoundaryRendered(true)
  }, [])

  const handleMessage = useCallback((msg: string) => {
    setMessage(msg)
  }, [setMessage])

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
    const featureRecord = feature as SpatialFeature
    const minZoomValue = Number(
      (feature.properties as Record<string, unknown> | undefined)?.minZoom
        ?? project.boundaryMinZoom,
    )
    const maxZoomValue = Number(
      (feature.properties as Record<string, unknown> | undefined)?.maxZoom
        ?? 24,
    )
    const currentFloorId = featureRecord.floorId
      ?? (feature.properties as Record<string, unknown> | undefined)?.floorId
      ?? selectedFloorId
      ?? null
    return {
      ...feature,
      projectId: project.id,
      objectId: featureRecord.objectId ?? DEFAULT_OBJECT_ID,
      floorId: currentFloorId,
      properties: {
        ...(feature.properties ?? {}),
        featureType,
        tag: String((feature.properties as Record<string, unknown> | undefined)?.tag ?? ''),
        noteText: String((feature.properties as Record<string, unknown> | undefined)?.noteText ?? ''),
        minZoom: Number.isFinite(minZoomValue) ? minZoomValue : project.boundaryMinZoom,
        maxZoom: Number.isFinite(maxZoomValue) ? maxZoomValue : 24,
        floorId: currentFloorId,
      },
    } as SpatialFeature
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
          const featureCopy: SpatialFeature = {
            ...(feature as SpatialFeature),
            properties: { ...((feature.properties ?? {}) as Record<string, unknown>) },
          }
          const response = await saveDrawingFeature(project.id, featureCopy)
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
    setMessage,
  ])

  const handleSaveDraft = useCallback(async () => {
    if (mode === 'delete_lasso') {
      return
    }
    const didPersist = await persistDraftChanges()
    if (didPersist && !hasPendingChanges) {
      setMessage('Nothing to save')
    }
  }, [hasPendingChanges, mode, persistDraftChanges, setMessage])

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
    [featureIdForState, serverFeatures, setMessage],
  )

  const selectedFeatures = useMemo(() => {
    if (selectedFeatureIds.length === 0) return []
    const selectedSet = new Set(selectedFeatureIds)
    return visibleFeatures.filter((feature) => selectedSet.has(String(feature.id ?? feature.properties?.id ?? '')))
  }, [selectedFeatureIds, visibleFeatures])

  const {
    draft: inspectorDraft,
    setName: setInspectorName,
    setTag: setInspectorTag,
    setNoteText: setInspectorNoteText,
    setFeatureType: setInspectorFeatureType,
  } = useInspectorFormState(selectedFeatures)

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
  }, [applyLocalFeatureUpdate, featureIdForState, map, project, setMessage, visibleFeatures])

  const handlePersistMovedFeatures = useCallback(async (featureIds: string[]) => {
    if (featureIds.length === 0) return
    setMessage('Move staged in draft')
  }, [setMessage])

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
  }, [applyRotateGestureDelta, endRotateSession, project, setMessage, startRotateSession])

  const selectedBuildingFeature = useMemo(() => {
    if (!project || selectedFeatures.length !== 1) return null
    const target = selectedFeatures[0]
    return project.editorMode === 'campus' && target.geometry.type === 'Polygon' ? target : null
  }, [project, selectedFeatures])

  const handleSaveInspector = useCallback(async () => {
    if (selectedFeatures.length === 0) return
    setIsSavingInspector(true)
    setMessage('Saving inspector changes...')
    try {
      applyLocalFeatureUpdate(
        selectedFeatures.map((feature) => featureIdForState(feature)),
        (feature) => ({
          ...feature,
          floorId: (feature as SpatialFeature).floorId ?? selectedFloorId ?? null,
          properties: {
            ...(feature.properties ?? {}),
            ...(selectedFeatures.length === 1 ? { name: inspectorDraft.name } : {}),
            ...(inspectorDraft.featureType ? { featureType: inspectorDraft.featureType } : {}),
            tag: inspectorDraft.tag,
            noteText: inspectorDraft.noteText,
            floorId: (feature as SpatialFeature).floorId
              ?? (feature.properties as Record<string, unknown> | undefined)?.floorId
              ?? selectedFloorId
              ?? null,
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
  }, [applyLocalFeatureUpdate, featureIdForState, inspectorDraft.featureType, inspectorDraft.name, inspectorDraft.noteText, inspectorDraft.tag, selectedFeatures, selectedFloorId, setMessage])

  const handlePreviewImport = useCallback(async (polygons: {
    name?: string
    externalId?: string
    tag?: string
    note?: string
    coordinates: [number, number][]
  }[]) => {
    if (!project) {
      setMessage('Project is not loaded')
      return
    }
    const preview = await previewImport({
      projectId: project.id,
      objectId: DEFAULT_OBJECT_ID,
      floorId: selectedFloorId,
      polygons,
    })
    setImportPreviewFeatures(Array.isArray(preview.previewFeatures) ? preview.previewFeatures as Feature[] : [])
    setMessage('Import preview ready')
  }, [previewImport, project, selectedFloorId, setMessage])

  const handleCommitImport = useCallback(async (polygons: {
    name?: string
    externalId?: string
    tag?: string
    note?: string
    coordinates: [number, number][]
  }[]) => {
    if (!project) {
      setMessage('Project is not loaded')
      return
    }
    const result = await commitImport({
      projectId: project.id,
      objectId: DEFAULT_OBJECT_ID,
      floorId: selectedFloorId,
      polygons,
    })
    if (result?.floorId) {
      setSelectedFloorId(result.floorId)
    }
    const upsert = result?.changes?.features?.upsert
    if (Array.isArray(upsert) && upsert.length > 0) {
      setServerFeatures((current) => {
        const byId = new Map<string, Feature>()
        current.forEach((feature) => byId.set(featureIdForState(feature), feature))
        upsert.forEach((item) => {
          if (item && typeof item === 'object') {
            const feature = item as Feature
            byId.set(featureIdForState(feature), feature)
          }
        })
        return Array.from(byId.values())
      })
    }
    setImportPreviewFeatures([])
    clearImportPreview()
    setMessage(`Import committed (${result.validRooms}/${result.detectedRooms} valid)`)
  }, [clearImportPreview, commitImport, featureIdForState, project, selectedFloorId, setMessage, setSelectedFloorId])

  const handleUnpreviewImport = useCallback(() => {
    setImportPreviewFeatures([])
    clearImportPreview()
    setMessage('Preview hidden')
  }, [clearImportPreview, setMessage])

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
        projectId: project.id,
        objectId: DEFAULT_OBJECT_ID,
        floorId: selectedFloorId ?? null,
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
      } as SpatialFeature
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
  }, [canDrawOnFloor, makeDraftFeatureId, map, project, selectedFloorId, setMessage, stageCreatedFeature, textBoxDraft, toolsEnabled])

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
  }, [canDrawOnFloor, handleStartTextBox, project, setMessage, toolsEnabled])

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
  }, [draftPoints, project, setMessage, visibleFeatures])

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
  }, [currentSavableDraftFeature, handleLassoSelection, setMessage, stageCreatedFeature])

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
    backdropMode,
    visibleFeatures,
    selectedFeatureIds,
    draftCollection,
    snapPreview,
    isMounted,
    onBoundaryRendered: handleBoundaryRendered,
    onMessage: handleMessage,
  })

  useEffect(() => {
    writeStoredEditorBackdropMode(backdropMode)
  }, [backdropMode])

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
  }, [activeProjectId, setMessage, setSelectedFloorId])

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
            includeHiddenByZoom: true,
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
  }, [featureIdForState, mapZoom, pendingCreatedFeatures, pendingDeletedFeatureIds, pendingUpdatedFeatures, project, map, mapReady, selectedFloorId, setMessage])

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

  const handlePublished = useCallback((nextProject: DrawingProject, nextFeatures: Feature[]) => {
    setProject(nextProject)
    setServerFeatures(nextFeatures)
    setPendingCreatedFeatures([])
    setPendingUpdatedFeatures({})
    setPendingDeletedFeatureIds([])
  }, [])

  const {
    publishing,
    publishProject: handlePublish,
  } = usePublishProject({
    project,
    hasPendingChanges,
    persistDraftChanges,
    isMounted,
    onMessage: setMessage,
    onPublished: handlePublished,
  })

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
  }, [project, selectedBuildingFeature, setMessage])

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

  const handleBackToMainMap = useCallback(() => {
    if (map && project) {
      const bounds: [[number, number], [number, number]] = [
        [project.bbox[0], project.bbox[1]],
        [project.bbox[2], project.bbox[3]],
      ]
      const cameraForBounds = map.cameraForBounds(bounds, {
        padding: { top: 80, right: 80, bottom: 80, left: 80 },
        maxZoom: 18.5,
      })
      if (cameraForBounds?.center) {
        const nextCenter = Array.isArray(cameraForBounds.center)
          ? cameraForBounds.center
          : ('lng' in cameraForBounds.center
            ? [cameraForBounds.center.lng, cameraForBounds.center.lat]
            : [cameraForBounds.center.lon, cameraForBounds.center.lat])
        const safeZoom = Number.isFinite(cameraForBounds.zoom)
          ? Math.max(project.boundaryMinZoom ?? 12, Math.min(18.5, Number(cameraForBounds.zoom)))
          : Math.max(project.boundaryMinZoom ?? 12, Math.min(18.5, map.getZoom()))
        writeStoredMainMapCamera({
          center: [nextCenter[0], nextCenter[1]],
          zoom: safeZoom,
          bearing: 0,
          pitch: 0,
        })
        onBack()
        return
      }
    }
    if (map) {
      const center = map.getCenter()
      writeStoredMainMapCamera({
        center: [center.lng, center.lat],
        zoom: Math.min(18.5, map.getZoom()),
        bearing: 0,
        pitch: 0,
      })
    }
    onBack()
  }, [map, onBack, project])

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-slate-100 text-slate-950">
      <main className="drone-map relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-slate-200">
        <div
          ref={containerRef}
          className="absolute inset-0 h-full w-full"
          aria-label="Spatial editor map"
        />
        <div className="absolute left-4 top-4 z-30 flex items-center gap-2 lg:hidden">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50"
            onClick={handleBackToMainMap}
            aria-label="Back to main map"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>Main map</span>
          </button>
        </div>
        <div className="absolute right-4 top-4 z-30 flex items-center gap-2 lg:hidden">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-lg"
            onClick={() => setMobileStructureOpen(true)}
          >
            <PanelLeftOpen className="size-3.5" />
            Structure
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-lg"
            onClick={() => setMobileInspectorOpen(true)}
          >
            <PanelRightOpen className="size-3.5" />
            Inspector
          </button>
        </div>
        <SpatialCanvasOverlay
          map={map}
          draftMode={mode}
          visibleFeatures={visibleFeatures}
          previewFeatures={importPreviewFeatures}
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
          activeFeatureType={activeFeatureType}
          toolsEnabled={toolsEnabled}
          isSaving={isSaving || publishing}
          floorRequired={Boolean(floorRequired)}
          hasFloorSelection={Boolean(selectedFloorId)}
          onSetMode={handleSetMode}
          onClearDraft={() => setDraftPoints([])}
        />
        <EditorToolbar
          toolsEnabled={toolsEnabled}
          isSaving={isSaving || publishing}
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
          onBack={handleBackToMainMap}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          zoomLabel={`${Math.round(mapZoom * 10) / 10}x`}
        />
        {canShowFloorSelector ? (
          <button
            type="button"
            className="absolute right-4 top-4 z-30 rounded-lg border border-slate-300 bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-lg backdrop-blur transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 lg:hidden"
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
        <div className="absolute bottom-5 right-4 z-30 flex flex-col items-end gap-2 lg:hidden">
          <EditorBackdropPicker
            mode={backdropMode}
            onChange={setBackdropMode}
          />
        </div>
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
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
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
        <aside className="absolute inset-y-0 left-0 z-30 hidden w-[324px] overflow-visible lg:block">
          <div
            className={`absolute inset-y-0 left-0 flex w-[324px] transform-gpu items-center justify-start will-change-transform transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              leftSidebarCollapsed ? '-translate-x-[300px]' : 'translate-x-0'
            }`}
          >
            <div className="h-full w-[300px] overflow-hidden rounded-r-2xl border-r border-slate-200 bg-white shadow-lg">
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
                importPreview={importPreview}
                importError={importError}
                importLoading={importLoading}
                onPreviewImport={handlePreviewImport}
                onCommitImport={handleCommitImport}
                onUnpreviewImport={handleUnpreviewImport}
              />
            </div>
            <button
              type="button"
              className="ml-[-1px] flex h-14 w-6 items-center justify-center rounded-r-full border border-slate-200 border-l-0 bg-white text-slate-500 shadow-sm transition-colors duration-200 hover:border-sky-300 hover:text-sky-700"
              onClick={() => setLeftSidebarCollapsed((current) => !current)}
              aria-label={leftSidebarCollapsed ? 'Open project panel' : 'Collapse project panel'}
            >
              {leftSidebarCollapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
            </button>
          </div>
        </aside>
        <aside className="absolute inset-y-0 right-0 z-30 hidden w-[344px] overflow-visible lg:block">
          <div
            className={`absolute inset-y-0 right-0 flex w-[344px] transform-gpu items-center justify-end will-change-transform transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              rightSidebarCollapsed ? 'translate-x-[320px]' : 'translate-x-0'
            }`}
          >
            <button
              type="button"
              className="mr-[-1px] flex h-14 w-6 items-center justify-center rounded-l-full border border-slate-200 border-r-0 bg-white text-slate-500 shadow-sm transition-colors duration-200 hover:border-sky-300 hover:text-sky-700"
              onClick={() => setRightSidebarCollapsed((current) => !current)}
              aria-label={rightSidebarCollapsed ? 'Open inspector panel' : 'Collapse inspector panel'}
            >
              {rightSidebarCollapsed ? <PanelRightOpen className="size-3.5" /> : <PanelRightClose className="size-3.5" />}
            </button>
            <div className="h-full w-[320px] overflow-hidden rounded-l-2xl border-l border-slate-200 bg-white shadow-lg">
              <EditorSidebar
                project={project}
                projectConfig={projectConfig}
                floors={floors}
                selectedFloorId={selectedFloorId}
                mapZoom={mapZoom}
                mapReady={mapReady}
                boundaryRendered={boundaryRendered}
                backdropMode={backdropMode}
                visibleFeatures={visibleFeatures}
                draftFeature={draftCollection}
                hoverCoordinate={hoverCoordinate}
                snapPreview={snapPreview}
                message={message}
                selectedFeatures={selectedFeatures}
                inspectorDraft={inspectorDraft}
                onInspectorNameChange={setInspectorName}
                onInspectorTagChange={setInspectorTag}
                onInspectorNoteChange={setInspectorNoteText}
                onInspectorFeatureTypeChange={setInspectorFeatureType}
                onBackdropModeChange={setBackdropMode}
                onSaveInspector={handleSaveInspector}
                isSavingInspector={isSavingInspector}
              />
            </div>
          </div>
        </aside>
      </main>

      {mobileStructureOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/35 lg:hidden" onClick={() => setMobileStructureOpen(false)}>
          <div className="absolute left-0 top-0 h-full w-[90vw] max-w-[360px]" onClick={(event) => event.stopPropagation()}>
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
              importPreview={importPreview}
              importError={importError}
              importLoading={importLoading}
              onPreviewImport={handlePreviewImport}
              onCommitImport={handleCommitImport}
              onUnpreviewImport={handleUnpreviewImport}
            />
          </div>
        </div>
      ) : null}

      {mobileInspectorOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/35 lg:hidden" onClick={() => setMobileInspectorOpen(false)}>
          <div className="absolute right-0 top-0 h-full w-[90vw] max-w-[360px]" onClick={(event) => event.stopPropagation()}>
            <EditorSidebar
              project={project}
              projectConfig={projectConfig}
              floors={floors}
              selectedFloorId={selectedFloorId}
              mapZoom={mapZoom}
              mapReady={mapReady}
              boundaryRendered={boundaryRendered}
              backdropMode={backdropMode}
              visibleFeatures={visibleFeatures}
              draftFeature={draftCollection}
              hoverCoordinate={hoverCoordinate}
              snapPreview={snapPreview}
              message={message}
              selectedFeatures={selectedFeatures}
              inspectorDraft={inspectorDraft}
              onInspectorNameChange={setInspectorName}
              onInspectorTagChange={setInspectorTag}
              onInspectorNoteChange={setInspectorNoteText}
              onInspectorFeatureTypeChange={setInspectorFeatureType}
              onBackdropModeChange={setBackdropMode}
              onSaveInspector={handleSaveInspector}
              isSavingInspector={isSavingInspector}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
