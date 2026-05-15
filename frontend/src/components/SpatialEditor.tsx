import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, Position } from 'geojson'
import type { DrawingProject, ProjectCanvasConfig, SpatialLayer } from '../types/drone'
import {
  fetchDrawingProject,
  fetchDrawingProjectLayers,
  fetchProjectVisibleFeatures,
  publishDrawingProject,
  saveDrawingFeature,
  createChildProject,
} from '../services/spatial'
import { MapProvider, useMapContext } from './MapProvider'
import { EditorToolbar } from './EditorToolbar'
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
  draftToFeature,
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
      (['polygon', 'line', 'point', 'room', 'corridor', 'wall', 'indoor_route', 'door'] as DrawMode[]).find(
        (candidate) => layerSupportsMode(activeLayer, candidate),
      ) ?? 'select'
    )
  }, [activeLayer, userMode])

  const activeFeatureType = featureTypeForLayer(activeLayer, mode)
  const draftFeature = draftToFeature(mode, draftPoints, activeFeatureType)
  const toolsEnabled = mapReady && boundaryRendered

  // Derive floor info
  const floors = useMemo(() => {
    if (!project) return []
    return [...project.floors].sort((a, b) => a.sortOrder - b.sortOrder)
  }, [project])

  const hasFloors = floors.length > 0
  const showFloorSelector = hasFloors && (project?.editorMode === 'building' || project?.editorMode === 'indoor' || hasFloors)

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

  // --- Stable callbacks ---
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

  // Figma-like: when user picks a tool, auto-switch to a compatible layer
  const handleSetMode = useCallback(
    (nextMode: DrawMode) => {
      setUserMode(nextMode)
      // If current layer already supports this mode, nothing to do
      if (nextMode === 'select' || nextMode === 'delete' || layerSupportsMode(activeLayer, nextMode)) {
        return
      }
      // Find first unlocked layer that supports this mode
      const compatibleLayer = layers.find((layer) => !layer.locked && layerSupportsMode(layer, nextMode))
      if (compatibleLayer) {
        setUserActiveLayerId(compatibleLayer.id)
        setMessage(`Switched to "${compatibleLayer.name}" layer`)
      }
    },
    [activeLayer, layers],
  )

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

  useDrawingEngine({
    map,
    project,
    toolsEnabled,
    isMounted,
    modeRef,
    snapPreviewRef,
    onAddPoint: setDraftPoints,
    onMessage: handleMessage,
  })

  useMapRenderer({
    map,
    mapReady,
    mapLoaded,
    mapZoom,
    project,
    projectConfig,
    visibleFeatures,
    draftFeature,
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

  // --- Save / Publish ---
  const handleSaveDraft = async () => {
    if (!project || !draftFeature || !toolsEnabled) {
      return
    }
    setIsSaving(true)
    setMessage('Saving draft...')
    try {
      const response = await saveDrawingFeature(project.id, {
        ...draftFeature,
        properties: {
          ...(draftFeature.properties ?? {}),
          featureType: activeFeatureType,
          layerId: activeLayer?.id ?? null,
          layerName: activeLayer?.name ?? null,
          minZoom: activeLayer?.minZoom ?? project.boundaryMinZoom,
          maxZoom: activeLayer?.maxZoom ?? 24,
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
  }

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
        <EditorToolbar
          mode={mode}
          activeLayer={activeLayer}
          layers={layers}
          toolsEnabled={toolsEnabled}
          isSaving={isSaving}
          draftFeature={draftFeature}
          project={project}
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
        draftFeature={draftFeature}
        hoverCoordinate={hoverCoordinate}
        snapPreview={snapPreview}
        message={message}
        onSelectLayer={setUserActiveLayerId}
        onClearDraft={() => setDraftPoints([])}
      />
    </div>
  )
}
