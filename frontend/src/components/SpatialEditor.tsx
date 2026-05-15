import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, Position } from 'geojson'
import type { DrawingProject, ProjectCanvasConfig, SpatialLayer } from '../types/drone'
import {
  fetchDrawingProject,
  fetchDrawingProjectLayers,
  fetchProjectVisibleFeatures,
  publishDrawingProject,
  saveDrawingFeature,
  deleteDrawingFeature,
  createProjectFloor,
  createChildProject,
} from '../services/spatial'
import { MapProvider, useMapContext } from './MapProvider'
import { EditorToolbar } from './EditorToolbar'
import { EditorToolbox } from './EditorToolbox'
import { EditorSidebar } from './EditorSidebar'
import { FloorSelector } from './FloorSelector'
import { BuildingEntryOverlay } from './BuildingEntryOverlay'
import { useMapRenderer } from '../hooks/useMapRenderer'
import { useSnapEngine, type SnapPreview } from '../hooks/useSnapEngine'
import {
  useDrawingEngine,
  type DrawMode,
  activeLayerForProject,
  layerSupportsMode,
  featureTypeForLayer,
  draftToFeatures,
} from '../hooks/useDrawingEngine'

const DEFAULT_PROJECT_CONFIG: ProjectCanvasConfig = {
  canvasMode: 'dimOutside',
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
  const modeRef = useRef<DrawMode>('select')
  const snapPreviewRef = useRef<SnapPreview | null>(null)
  const draftPointsRef = useRef<Position[]>([])

  // --- Core state ---
  const [project, setProject] = useState<DrawingProject | null>(null)
  const [layers, setLayers] = useState<SpatialLayer[]>([])
  const [visibleFeatures, setVisibleFeatures] = useState<Feature[]>([])
  const [userActiveLayerId, setUserActiveLayerId] = useState<string | null>(null)
  const [userMode, setUserMode] = useState<DrawMode>('select')
  const [draftPoints, setDraftPoints] = useState<Position[]>([])
  const [hoverCoordinate, setHoverCoordinate] = useState<Position | null>(null)
  const [message, setMessage] = useState('Loading project...')
  const [isSaving, setIsSaving] = useState(false)
  const [boundaryRendered, setBoundaryRendered] = useState(false)
  const [snapPreview, setSnapPreview] = useState<SnapPreview | null>(null)
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null)
  const [isToolboxCollapsed, setIsToolboxCollapsed] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

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

  const activeLayerId = useMemo(() => {
    if (userActiveLayerId && layers.some((layer) => layer.id === userActiveLayerId)) {
      return userActiveLayerId
    }
    return activeLayerForProject(layers)?.id ?? null
  }, [userActiveLayerId, layers])

  const activeLayer = useMemo(
    () => layers.find((layer) => layer.id === activeLayerId) ?? activeLayerForProject(layers),
    [activeLayerId, layers],
  )

  const mode = useMemo<DrawMode>(() => {
    if (layerSupportsMode(activeLayer, userMode)) {
      return userMode
    }
    return (
      (['polygon', 'line', 'point'] as DrawMode[]).find((candidate) =>
        layerSupportsMode(activeLayer, candidate),
      ) ?? 'select'
    )
  }, [activeLayer, userMode])

  const activeFeatureType = mode === 'delete' || mode === 'delete_lasso'
    ? 'custom_area'
    : featureTypeForLayer(activeLayer, mode)
  const draftCollection = draftToFeatures(mode, draftPoints, activeFeatureType, hoverCoordinate)
  const toolsEnabled = mapReady && boundaryRendered

  // Derive floor info
  const floors = useMemo(() => {
    if (!project) return []
    return [...project.floors].sort((a, b) => a.sortOrder - b.sortOrder)
  }, [project])

  const hasFloors = floors.length > 0
  const floorRequired = project?.editorMode === 'building' || project?.editorMode === 'indoor'
  const showFloorSelector = Boolean(floorRequired || hasFloors)
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
    if (!canDrawOnFloor && userMode !== 'select') {
      setUserMode('select')
    }
  }, [canDrawOnFloor, userMode])

  // --- Stable callbacks ---
  
  const handleSetMode = useCallback((newMode: DrawMode) => {
    if (!canDrawOnFloor && newMode !== 'select') {
      setMessage('Select a floor before drawing')
      return
    }
    if (newMode !== 'select' && newMode !== 'delete' && newMode !== 'delete_lasso' && activeLayer && !layerSupportsMode(activeLayer, newMode)) {
      const compatibleLayer = layers.find(l => layerSupportsMode(l, newMode))
      if (compatibleLayer) {
        setUserActiveLayerId(compatibleLayer.id)
      }
    }
    setUserMode(newMode)
  }, [activeLayer, canDrawOnFloor, layers])

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
    const finalFeature = draftCollection?.features.find(
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
          layerId: activeLayer?.id ?? null,
          layerName: activeLayer?.name ?? null,
          minZoom: activeLayer?.minZoom ?? project.boundaryMinZoom,
          maxZoom: activeLayer?.maxZoom ?? 24,
          floorId: selectedFloorId ?? null,
        },
      })
      if (!isMountedRef.current) {
        return
      }
      setVisibleFeatures((current) => [...current, response.feature])
      setDraftPoints([])
      setMessage('Draft feature saved')
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
    draftCollection,
    toolsEnabled,
    activeFeatureType,
    activeLayer,
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
      setMessage('Delete complete')
    },
    [project],
  )

  const handleDeleteLasso = useCallback(async () => {
    if (!project || draftPoints.length < 3) {
      setMessage('Draw a lasso area to delete')
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
        return geometry.coordinates.some((ringCoords) => ringCoords.some((coord) => pointInPolygon(coord as Position)))
      }
      return false
    }

    const featureIds = visibleFeatures
      .filter(intersectsLasso)
      .map((feature) => feature.id ?? feature.properties?.id)
      .filter((id): id is string | number => Boolean(id))
      .map((id) => String(id))

    await handleDeleteFeatures(featureIds)
    setDraftPoints([])
  }, [draftPoints, handleDeleteFeatures, project, visibleFeatures])

  useDrawingEngine({
    map,
    project,
    toolsEnabled,
    isMounted,
    modeRef,
    snapPreviewRef,
    draftPointsRef,
    onAddPoint: setDraftPoints,
    onSaveDraft: () => {
      if (modeRef.current === 'delete_lasso') {
        handleDeleteLasso()
        return
      }
      handleSaveDraft()
    },
    onMessage: handleMessage,
    onDeleteFeatures: handleDeleteFeatures,
  })

  useMapRenderer({
    map,
    mapReady,
    mapLoaded,
    mapZoom,
    project,
    projectConfig,
    visibleFeatures,
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
        setLayers([])
        setVisibleFeatures([])
        setDraftPoints([])
        setUserActiveLayerId(null)
        setUserMode('select')
        setBoundaryRendered(false)
        setMessage('Loading project...')
      }
      try {
        const [nextProject, nextLayers] = await Promise.all([
          fetchDrawingProject(activeProjectId, abortController.signal),
          fetchDrawingProjectLayers(activeProjectId, abortController.signal),
        ])
        if (!isMountedRef.current || abortController.signal.aborted) {
          return
        }
        setProject(nextProject)
        setLayers(nextLayers)
        setVisibleFeatures([])
        // Auto-select first floor if project has floors
        if (nextProject.floors.length > 0) {
          setSelectedFloorId(nextProject.floors[0].id)
        } else {
          setSelectedFloorId(null)
        }
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
    const mediaQuery = window.matchMedia('(max-width: 1024px)')
    const handleCollapse = () => {
      if (mediaQuery.matches) {
        setIsToolboxCollapsed(true)
        setIsSidebarCollapsed(true)
      }
    }
    handleCollapse()
    mediaQuery.addEventListener('change', handleCollapse)
    return () => mediaQuery.removeEventListener('change', handleCollapse)
  }, [])

  // --- Visible feature loading ---
  useEffect(() => {
    if (!map || !project || !mapReady) {
      return
    }
    const currentActiveLayerId = activeLayer?.id ?? null
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
            layerId: currentActiveLayerId,
            floorId: selectedFloorId,
          },
          abortController.signal,
        )
        if (!isMountedRef.current || abortController.signal.aborted) {
          return
        }
        setVisibleFeatures(nextFeatures)
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
  }, [activeLayer?.id, mapZoom, project, map, mapReady, selectedFloorId])

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
      setLayers(response.project.layers)
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
    }
  }, [project])

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
    <div className="flex h-screen min-h-screen bg-slate-100 text-slate-950">
      <main className="drone-map relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-slate-900">
        <div
          ref={containerRef}
          className="absolute inset-0 h-full w-full"
          aria-label="Spatial editor map"
        />
        <EditorToolbox
          mode={mode}
          layers={layers}
          toolsEnabled={toolsEnabled}
          isSaving={isSaving}
          floorRequired={Boolean(floorRequired)}
          hasFloorSelection={Boolean(selectedFloorId)}
          isCollapsed={isToolboxCollapsed}
          onToggleCollapsed={() => setIsToolboxCollapsed((value) => !value)}
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
        />
        {showFloorSelector ? (
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
        layers={layers}
        activeLayer={activeLayer}
        mapZoom={mapZoom}
        mapReady={mapReady}
        boundaryRendered={boundaryRendered}
        visibleFeatures={visibleFeatures}
        draftFeature={draftCollection}
        hoverCoordinate={hoverCoordinate}
        snapPreview={snapPreview}
        message={message}
        onSelectLayer={setUserActiveLayerId}
        onClearDraft={() => setDraftPoints([])}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapsed={() => setIsSidebarCollapsed((value) => !value)}
      />
    </div>
  )
}
