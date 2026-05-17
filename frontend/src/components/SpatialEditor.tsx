import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, Position } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
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
  type DrawMode,
  featureTypeForMode,
  draftToFeatures,
  translateFeatureGeometry,
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
      onKeyDown={(event) => {
        event.stopPropagation()
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
  const selectedFeatureIdsRef = useRef<string[]>([])
  const visibleFeaturesRef = useRef<Feature[]>([])

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
  const [textBoxDraft, setTextBoxDraft] = useState<{ start: Position; end: Position; text: string } | null>(null)

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
  const draftCollection = draftToFeatures(mode, draftPoints, activeFeatureType, hoverCoordinate, map)
  const toolsEnabled = mapReady

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
    const persistedDraft = draftToFeatures(mode, draftPoints, activeFeatureType, null, map)
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
    map,
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

  const selectedFeatures = useMemo(() => {
    if (selectedFeatureIds.length === 0) return []
    const selectedSet = new Set(selectedFeatureIds)
    return visibleFeatures.filter((feature) => selectedSet.has(String(feature.id ?? feature.properties?.id ?? '')))
  }, [selectedFeatureIds, visibleFeatures])

  const handleMoveFeatures = useCallback((featureIds: string[], deltaLng: number, deltaLat: number) => {
    if (featureIds.length === 0) return
    setVisibleFeatures((current) => {
      const next = current.map((feature) => {
        const id = String(feature.id ?? feature.properties?.id ?? '')
        if (!featureIds.includes(id)) return feature
        return translateFeatureGeometry(feature, deltaLng, deltaLat)
      })
      visibleFeaturesRef.current = next
      return next
    })
  }, [])

  const handlePersistMovedFeatures = useCallback(async (featureIds: string[]) => {
    if (!project || featureIds.length === 0) return
    const featureSet = new Set(featureIds)
    const movedFeatures = visibleFeaturesRef.current.filter((feature) =>
      featureSet.has(String(feature.id ?? feature.properties?.id ?? '')),
    )
    if (movedFeatures.length === 0) return
    try {
      await Promise.all(movedFeatures.map((feature) => saveDrawingFeature(project.id, feature)))
      if (isMountedRef.current) {
        setMessage('Feature move saved')
      }
    } catch (error) {
      if (isMountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Move save failed')
      }
    }
  }, [project])

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
      const response = await saveDrawingFeature(project.id, {
        type: 'Feature',
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
      } as Feature)
      if (!isMountedRef.current) return
      setVisibleFeatures((current) => [...current, response.feature])
      setMessage('Text added')
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
  }, [canDrawOnFloor, project, selectedFloorId, textBoxDraft, toolsEnabled])

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

  const handleCommitBoxShape = useCallback(
    async (shapeMode: 'rectangle' | 'square' | 'triangle' | 'ellipse', start: Position, end: Position) => {
      if (!project || !toolsEnabled || !canDrawOnFloor) {
        if (!canDrawOnFloor) setMessage('Select a floor before saving')
        return
      }
      const featureType = featureTypeForMode(shapeMode)
      const collection = draftToFeatures(shapeMode, [start, end], featureType, null, map)
      const finalFeature = collection?.features.find(
        (feature) =>
          !feature.properties?.isDraftVertex &&
          (feature.geometry.type === 'Polygon' || feature.geometry.type === 'LineString' || feature.geometry.type === 'Point'),
      )
      if (!finalFeature) return
      setIsSaving(true)
      setMessage('Saving draft...')
      try {
        const response = await saveDrawingFeature(project.id, {
          ...finalFeature,
          properties: {
            ...(finalFeature.properties ?? {}),
            featureType,
            tag: '',
            noteText: '',
            minZoom: project.boundaryMinZoom,
            maxZoom: 24,
            floorId: selectedFloorId ?? null,
          },
        })
        if (!isMountedRef.current) return
        setVisibleFeatures((current) => [...current, response.feature])
        setMessage('Draft feature saved')
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
    },
    [canDrawOnFloor, project, selectedFloorId, toolsEnabled, map],
  )

  const handleCommitPenPath = useCallback(
    async (points: Position[]) => {
      if (!project || !toolsEnabled || !canDrawOnFloor || points.length < 2) {
        if (!canDrawOnFloor) setMessage('Select a floor before saving')
        return
      }
      const featureType = featureTypeForMode('pen')
      const collection = draftToFeatures('pen', points, featureType, null, map)
      const finalFeature = collection?.features.find(
        (feature) =>
          !feature.properties?.isDraftVertex &&
          (feature.geometry.type === 'Polygon' || feature.geometry.type === 'LineString' || feature.geometry.type === 'Point'),
      )
      if (!finalFeature) return
      setIsSaving(true)
      setMessage('Saving draft...')
      try {
        const response = await saveDrawingFeature(project.id, {
          ...finalFeature,
          properties: {
            ...(finalFeature.properties ?? {}),
            featureType,
            tag: '',
            noteText: '',
            minZoom: project.boundaryMinZoom,
            maxZoom: 24,
            floorId: selectedFloorId ?? null,
          },
        })
        if (!isMountedRef.current) return
        setVisibleFeatures((current) => [...current, response.feature])
        setMessage('Draft feature saved')
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
    },
    [canDrawOnFloor, project, selectedFloorId, toolsEnabled, map],
  )

  const handleLassoSelection = useCallback(() => {
    if (!project || draftPoints.length < 2) {
      setMessage('Draw a selection rectangle')
      return
    }
    const start = draftPoints[0]
    const end = draftPoints[draftPoints.length - 1]
    const minLng = Math.min(start[0], end[0])
    const maxLng = Math.max(start[0], end[0])
    const minLat = Math.min(start[1], end[1])
    const maxLat = Math.max(start[1], end[1])

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

  useDrawingEngine({
    map,
    project,
    toolsEnabled,
    isMounted,
    modeRef,
    snapPreviewRef,
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
    onMoveFeatures: handleMoveFeatures,
    onMoveEnd: handlePersistMovedFeatures,
    onQuickCreateTextBox: handleQuickCreateTextBox,
    onCommitBoxShape: handleCommitBoxShape,
    onCommitPenPath: handleCommitPenPath,
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
        setVisibleFeatures([])
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
      if ((event.target as HTMLElement | null)?.tagName === 'INPUT' || (event.target as HTMLElement | null)?.tagName === 'TEXTAREA') {
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
        <SpatialCanvasOverlay
          map={map}
          visibleFeatures={visibleFeatures}
          selectedFeatureIds={selectedFeatureIds}
          draftCollection={draftCollection}
          snapPreview={snapPreview}
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
