import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, Position } from 'geojson'
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
import { useMapRenderer } from '../hooks/useMapRenderer'
import { useSnapEngine, type SnapPreview } from '../hooks/useSnapEngine'
import {
  useDrawingEngine,
  type DrawMode,
  featureTypeForMode,
  draftToFeatures,
} from '../hooks/useDrawingEngine'

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

function SpatialEditorInner({ projectId, onBack }: SpatialEditorProps) {
  const { map, mapReady, mapLoaded, mapZoom, containerRef } = useMapContext()
  const isMountedRef = useRef(false)
  const fittedProjectIdRef = useRef<string | null>(null)
  const modeRef = useRef<DrawMode>('select')
  const snapPreviewRef = useRef<SnapPreview | null>(null)
  const draftPointsRef = useRef<Position[]>([])
  const selectedFeatureIdsRef = useRef<string[]>([])

  // --- Core state ---
  const [project, setProject] = useState<DrawingProject | null>(null)
  const [visibleFeatures, setVisibleFeatures] = useState<Feature[]>([])
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

  // --- Child project navigation ---
  const [projectStack, setProjectStack] = useState<Array<{ id: string; name: string }>>([])
  const [activeProjectId, setActiveProjectId] = useState(projectId)
  const [selectedBuildingFeature, setSelectedBuildingFeature] = useState<Feature | null>(null)

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
  const draftCollection = draftToFeatures(mode, draftPoints, activeFeatureType, hoverCoordinate)
  const toolsEnabled = mapReady && boundaryRendered

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
    if (!canDrawOnFloor && !['select', 'move', 'edit_points'].includes(userMode)) {
      setUserMode('select')
    }
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
    if (!canDrawOnFloor && !['select', 'move', 'edit_points'].includes(newMode)) {
      setMessage('Select a floor before drawing')
      return
    }
    setUserMode(newMode)
  }, [canDrawOnFloor])

  const handleZoomIn = useCallback(() => {
    if (!map) return
    map.zoomIn({ duration: 120 })
  }, [map])

  const handleZoomOut = useCallback(() => {
    if (!map) return
    map.zoomOut({ duration: 120 })
  }, [map])

  const isMounted = useCallback(() => isMountedRef.current, [])

  const handleBoundaryRendered = useCallback(() => {
    setBoundaryRendered(true)
  }, [])

  const handleMessage = useCallback((msg: string) => {
    setMessage(msg)
  }, [])

  const handleSnapPreview = useCallback((snap: SnapPreview | null) => {
    setSnapPreview(snap)
  }, [])

  const handleHoverCoordinate = useCallback((coord: Position) => {
    setHoverCoordinate(coord)
  }, [])

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
  const handleSaveDraft = useCallback(async () => {
    if (mode === 'delete_lasso') {
      return
    }
    const persistedDraft = draftToFeatures(mode, draftPoints, activeFeatureType, null)
    const finalFeature = persistedDraft?.features.find(
      (f) => !f.properties?.isDraftVertex && (f.geometry.type === 'Polygon' || f.geometry.type === 'LineString' || f.geometry.type === 'Point')
    )
    if (!project || !finalFeature || !toolsEnabled || !canDrawOnFloor) {
      if (!canDrawOnFloor) {
        setMessage('Select a floor before saving')
      }
      return
    }
    setIsSaving(true)
    setMessage('Saving draft...')
    try {
      const response = await saveDrawingFeature(project.id, {
        ...finalFeature,
        properties: {
          ...(finalFeature.properties ?? {}),
          featureType: activeFeatureType,
          tag: '',
          noteText: '',
          minZoom: project.boundaryMinZoom,
          maxZoom: 24,
          floorId: selectedFloorId ?? null,
        },
      })
      if (!isMountedRef.current) {
        return
      }
      setVisibleFeatures((current) => [...current, response.feature])
      setMessage('Draft feature saved')
      setDraftPoints([])
      setUserMode('select')
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Save failed')
      }
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false)
      }
    }
  }, [
    project,
    draftPoints,
    toolsEnabled,
    activeFeatureType,
    selectedFloorId,
    canDrawOnFloor,
    mode,
  ])

  const handleDeleteFeatures = useCallback(
    async (featureIds: string[]) => {
      if (!project || featureIds.length === 0) {
        return
      }
      setMessage('Deleting features...')
      await Promise.all(
        featureIds.map(async (featureId) => {
          try {
            await deleteDrawingFeature(project.id, featureId)
          } catch (error) {
            if (isMountedRef.current) {
              setMessage(error instanceof Error ? error.message : 'Delete failed')
            }
          }
        }),
      )
      if (!isMountedRef.current) {
        return
      }
      setVisibleFeatures((current) =>
        current.filter((feature) => {
          const id = feature.id ?? feature.properties?.id
          return !id || !featureIds.includes(String(id))
        }),
      )
      setSelectedFeatureIds((current) => current.filter((id) => !featureIds.includes(id)))
      setMessage('Delete complete')
    },
    [project],
  )

  const handleMoveVertex = useCallback((featureId: string, vertexIndex: number, lng: number, lat: number) => {
    setVisibleFeatures((current) =>
      current.map((feature) => {
        const id = String(feature.id ?? feature.properties?.id ?? '')
        if (id !== featureId) return feature
        const geometry = feature.geometry
        if (!geometry) return feature
        if (geometry.type === 'Point') {
          return { ...feature, geometry: { ...geometry, coordinates: [lng, lat] } }
        }
        if (geometry.type === 'LineString') {
          const next = [...geometry.coordinates]
          if (vertexIndex < 0 || vertexIndex >= next.length) return feature
          next[vertexIndex] = [lng, lat]
          return { ...feature, geometry: { ...geometry, coordinates: next } }
        }
        if (geometry.type === 'Polygon') {
          const ring = [...geometry.coordinates[0]]
          if (vertexIndex < 0 || vertexIndex >= ring.length - 1) return feature
          ring[vertexIndex] = [lng, lat]
          ring[ring.length - 1] = ring[0]
          return { ...feature, geometry: { ...geometry, coordinates: [ring] } }
        }
        return feature
      }),
    )
  }, [])

  const selectedFeatures = useMemo(() => {
    if (selectedFeatureIds.length === 0) return []
    const selectedSet = new Set(selectedFeatureIds)
    return visibleFeatures.filter((feature) => selectedSet.has(String(feature.id ?? feature.properties?.id ?? '')))
  }, [selectedFeatureIds, visibleFeatures])

  useEffect(() => {
    if (!project || selectedFeatures.length !== 1) {
      setSelectedBuildingFeature(null)
      return
    }
    const target = selectedFeatures[0]
    if (project.editorMode === 'campus' && target.geometry.type === 'Polygon') {
      setSelectedBuildingFeature(target)
      return
    }
    setSelectedBuildingFeature(null)
  }, [project, selectedFeatures])

  useEffect(() => {
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
  }, [selectedFeatures])

  const handleSaveInspector = useCallback(async () => {
    if (!project || selectedFeatures.length === 0) return
    setIsSavingInspector(true)
    setMessage('Saving inspector changes...')
    try {
      const updates = await Promise.all(
        selectedFeatures.map(async (feature) => {
          const next = {
            ...feature,
            properties: {
              ...(feature.properties ?? {}),
              ...(selectedFeatures.length === 1 ? { name: inspectorDraft.name } : {}),
              tag: inspectorDraft.tag,
              noteText: inspectorDraft.noteText,
              floorId: (feature.properties as Record<string, unknown> | undefined)?.floorId ?? selectedFloorId ?? null,
            },
          }
          const response = await saveDrawingFeature(project.id, next)
          return response.feature
        }),
      )
      if (!isMountedRef.current) return
      setVisibleFeatures((current) => {
        const byId = new Map(updates.map((feature) => [String(feature.id ?? feature.properties?.id ?? ''), feature]))
        return current.map((feature) => byId.get(String(feature.id ?? feature.properties?.id ?? '')) ?? feature)
      })
      setMessage('Inspector changes saved')
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Save metadata failed')
      }
    } finally {
      if (isMountedRef.current) {
        setIsSavingInspector(false)
      }
    }
  }, [inspectorDraft.name, inspectorDraft.noteText, inspectorDraft.tag, project, selectedFeatures, selectedFloorId])

  const handlePersistMovedFeatures = useCallback(async () => {
    if (!project || selectedFeatures.length === 0) return
    try {
      await Promise.all(selectedFeatures.map((feature) => saveDrawingFeature(project.id, feature)))
      if (isMountedRef.current) {
        setMessage('Feature move saved')
      }
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Move save failed')
      }
    }
  }, [project, selectedFeatures])

  const handleQuickCreateTextBox = useCallback(async (start: Position, end: Position) => {
    if (!project || !toolsEnabled || !canDrawOnFloor) {
      if (!canDrawOnFloor) setMessage('Select a floor before adding text')
      return
    }
    const value = window.prompt('Text content', 'New text')
    if (!value || !value.trim()) return
    const p1: Position = [start[0], start[1]]
    const p2: Position = [end[0], start[1]]
    const p3: Position = [end[0], end[1]]
    const p4: Position = [start[0], end[1]]
    try {
      const response = await saveDrawingFeature(project.id, {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[p1, p2, p3, p4, p1]] },
        properties: {
          featureType: 'text_label',
          text: value.trim(),
          name: value.trim(),
          tag: value.trim(),
          noteText: '',
          floorId: selectedFloorId ?? null,
          minZoom: project.boundaryMinZoom,
          maxZoom: 24,
        },
      } as Feature)
      if (!isMountedRef.current) return
      setVisibleFeatures((current) => [...current, response.feature])
      setMessage('Text added')
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Create text failed')
      }
    }
  }, [canDrawOnFloor, project, selectedFloorId, toolsEnabled])

  const handleLassoSelection = useCallback(() => {
    if (!project || draftPoints.length < 3) {
      setMessage('Draw a lasso area to select')
      return
    }
    const ring = [...draftPoints, draftPoints[0]]

    const pointInRing = (point: Position, ringPoints: Position[]) => {
      const [x, y] = point
      let inside = false
      let j = ringPoints.length - 1
      for (let i = 0; i < ringPoints.length; i += 1) {
        const [xi, yi] = ringPoints[i]
        const [xj, yj] = ringPoints[j]
        const intersects =
          yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi
        if (intersects) {
          inside = !inside
        }
        j = i
      }
      return inside
    }

    const pointInPolygon = (point: Position) => pointInRing(point, ring)
    const lassoCentroid: Position = ring.reduce<Position>(
      (acc, cur) => [acc[0] + cur[0] / ring.length, acc[1] + cur[1] / ring.length],
      [0, 0],
    )

    const intersectsLasso = (feature: Feature) => {
      const geometry = feature.geometry
      if (!geometry) return false
      if (geometry.type === 'Point') {
        return pointInPolygon(geometry.coordinates as Position)
      }
      if (geometry.type === 'LineString') {
        return (geometry.coordinates as Position[]).some((coord) => pointInPolygon(coord))
      }
      if (geometry.type === 'Polygon') {
        const outer = geometry.coordinates[0] as Position[] | undefined
        if (!outer || outer.length === 0) return false
        const hasFeatureVertexInsideLasso = geometry.coordinates.some((ringCoords) =>
          ringCoords.some((coord) => pointInPolygon(coord as Position)),
        )
        if (hasFeatureVertexInsideLasso) return true
        return pointInRing(lassoCentroid, outer)
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

  useDrawingEngine({
    map,
    project,
    toolsEnabled,
    isMounted,
    modeRef,
    snapPreviewRef,
    draftPointsRef,
    selectedFeatureIdsRef,
    onAddPoint: setDraftPoints,
    onSaveDraft: () => {
      if (modeRef.current === 'delete_lasso') {
        handleLassoSelection()
        return
      }
      handleSaveDraft()
    },
    onMessage: handleMessage,
    onSetSelection: setSelectedFeatureIds,
    onDeleteFeatures: handleDeleteFeatures,
    onMoveVertex: handleMoveVertex,
    onMoveVertexEnd: handlePersistMovedFeatures,
    onQuickCreateTextBox: handleQuickCreateTextBox,
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
    activeMode: mode,
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
        setProject(null)
        setVisibleFeatures([])
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
        setProject(nextProject)
        setVisibleFeatures([])
        // Auto-select first floor if project has floors
        if (nextProject.floors.length > 0) {
          setSelectedFloorId(nextProject.floors[0].id)
        } else {
          setSelectedFloorId(null)
        }
        setShowFloorSelector(false)
        setMessage('Project data loaded')
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
      if ((event.target as HTMLElement | null)?.tagName === 'INPUT' || (event.target as HTMLElement | null)?.tagName === 'TEXTAREA') {
        return
      }
      if (key === 'v') {
        event.preventDefault()
        handleSetMode('select')
      } else if (key === 'm') {
        event.preventDefault()
        handleSetMode('move')
      } else if (key === 'e') {
        event.preventDefault()
        handleSetMode('edit_points')
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
      }
    }
    window.addEventListener('keydown', handleModeShortcuts)
    return () => {
      window.removeEventListener('keydown', handleModeShortcuts)
    }
  }, [handleSetMode, handleZoomIn, handleZoomOut])

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
        setVisibleFeatures(nextFeatures)
        const visibleIds = new Set(
          nextFeatures
            .map((feature) => String(feature.id ?? feature.properties?.id ?? ''))
            .filter(Boolean),
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
  }, [mapZoom, project, map, mapReady, selectedFloorId])

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
    setIsSaving(true)
    setMessage('Publishing project...')
    try {
      const response = await publishDrawingProject(project.id)
      if (!isMountedRef.current) {
        return
      }
      setProject(response.project)
      setVisibleFeatures(response.project.features)
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
    setSelectedBuildingFeature(null)
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
        setSelectedBuildingFeature(null)
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
    setSelectedBuildingFeature(null)
  }, [])

  // Breadcrumb trail
  const breadcrumb = useMemo(() => {
    if (projectStack.length === 0) return null
    return [...projectStack.map((p) => p.name), project?.name ?? ''].filter(Boolean)
  }, [project?.name, projectStack])

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-slate-950 text-slate-100">
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

      <main className="drone-map relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-slate-900">
        <div
          ref={containerRef}
          className="absolute inset-0 h-full w-full"
          aria-label="Spatial editor map"
        />
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
          draftFeature={draftCollection}
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
            className="absolute right-4 top-4 z-30 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow-lg"
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
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1 rounded-lg border border-white/30 bg-white/92 px-3 py-1.5 text-sm shadow-lg backdrop-blur">
            <button
              type="button"
              className="text-sky-600 hover:text-sky-800 hover:underline"
              onClick={handleReturnToParent}
            >
              ← {projectStack[projectStack.length - 1]?.name}
            </button>
            <span className="text-slate-400">/</span>
            <span className="font-medium text-slate-950">{project?.name}</span>
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
