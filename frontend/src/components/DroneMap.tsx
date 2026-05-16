import { useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { GeoJSONSource } from 'maplibre-gl'
import type { Map } from 'maplibre-gl'
import { useDroneMap } from '../hooks/useDroneMap'
import { useDroneMarkers } from '../hooks/useDroneMarkers'
import { useProjectedTarget } from '../hooks/useProjectedTarget'
import { deleteDrawingProject, fetchMapOverlays } from '../services/spatial'
import type {
  CommandDispatchStatus,
  CommandTarget,
  DrawingProject,
  DroneRegistry,
  MapTargetDraft,
  OsmCandidate,
  OsmGeometryPoint,
  OsmRelationMemberGeometry,
} from '../types/drone'
import { TargetCommandPopover } from './TargetCommandPopover'

const highlightSourceId = 'osm-highlight-source'
const highlightFillLayerId = 'osm-highlight-fill-layer'
const highlightLineLayerId = 'osm-highlight-line-layer'
const overlayBoundarySourceId = 'published-overlay-boundary-source'
const overlayFeatureSourceId = 'published-overlay-feature-source'
const boundaryMinZoom = 13
const floorPanelMinZoom = 17
const maxNearbyBuildings = 12

function mapStyleReady(map: Map) {
  return Boolean((map as { style?: unknown }).style)
}

function getSourceSafe(map: Map, sourceId: string): GeoJSONSource | null {
  if (!mapStyleReady(map)) {
    return null
  }
  try {
    return (map.getSource(sourceId) as GeoJSONSource | undefined) ?? null
  } catch {
    return null
  }
}

function removeLayerSafe(map: Map, layerId: string) {
  if (!mapStyleReady(map)) {
    return
  }
  try {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId)
    }
  } catch {
    // MapLibre may clear style during route unmount; cleanup should stay quiet.
  }
}

function removeSourceSafe(map: Map, sourceId: string) {
  if (!mapStyleReady(map)) {
    return
  }
  try {
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId)
    }
  } catch {
    // MapLibre may clear style during route unmount; cleanup should stay quiet.
  }
}

interface DroneMapProps {
  dronesById: DroneRegistry
  dirtyIds: string[]
  selectedTarget: CommandTarget | null
  connectedCount: number
  commandStatus: CommandDispatchStatus
  highlightedCandidate: OsmCandidate | null
  selectedBoundaryGeometry: Geometry | null
  isFetchingCandidates: boolean
  isFetchingFull: boolean
  locationFetchMessage: { tone: 'success' | 'error' | 'info'; text: string } | null
  onTargetSelect: (target: MapTargetDraft) => void
  onFetchLocation: () => void
  onCancelTarget: () => void
  onConfirmTarget: () => void
}

function toPositions(points: OsmGeometryPoint[]): Position[] {
  return points.map((point) => [point.lon, point.lat])
}

function isClosedRing(points: Position[]): boolean {
  if (points.length < 4) {
    return false
  }

  const first = points[0]
  const last = points[points.length - 1]
  return first[0] === last[0] && first[1] === last[1]
}

function toWayFeature(points: OsmGeometryPoint[]): Feature<Geometry> | null {
  if (points.length < 2) {
    return null
  }

  const positions = toPositions(points)
  if (isClosedRing(positions)) {
    const polygonFeature: Feature<Geometry> = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [positions],
      },
      properties: {},
    }
    return polygonFeature
  }

  const lineFeature: Feature<Geometry> = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: positions,
    },
    properties: {},
  }
  return lineFeature
}

function relationMembersToFeatures(
  members: OsmRelationMemberGeometry[] | undefined,
): Feature<Geometry>[] {
  if (!members || members.length === 0) {
    return []
  }

  const lineStrings: Position[][] = []
  const polygons: Position[][][] = []

  for (const member of members) {
    if (member.type !== 'way' || !member.geometry || member.geometry.length < 2) {
      continue
    }

    const positions = toPositions(member.geometry)
    if (isClosedRing(positions)) {
      polygons.push([positions])
    } else {
      lineStrings.push(positions)
    }
  }

  const features: Feature<Geometry>[] = []
  if (polygons.length > 0) {
    if (polygons.length === 1) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: polygons[0],
        },
        properties: {},
      })
    } else {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: polygons,
        },
        properties: {},
      })
    }
  }

  if (lineStrings.length > 0) {
    if (lineStrings.length === 1) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: lineStrings[0],
        },
        properties: {},
      })
    } else {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: lineStrings,
        },
        properties: {},
      })
    }
  }

  return features
}

function candidateToFeatureCollection(
  candidate: OsmCandidate | null,
): FeatureCollection<Geometry> {
  if (!candidate) {
    return { type: 'FeatureCollection', features: [] }
  }

  if (candidate.type === 'way') {
    const wayFeature = toWayFeature(candidate.geometry.geometry ?? [])
    return {
      type: 'FeatureCollection',
      features: wayFeature ? [wayFeature] : [],
    }
  }

  const relationFeatures = relationMembersToFeatures(candidate.geometry.members)
  if (relationFeatures.length > 0) {
    return {
      type: 'FeatureCollection',
      features: relationFeatures,
    }
  }

  const fallbackFeature = toWayFeature(candidate.geometry.geometry ?? [])
  return {
    type: 'FeatureCollection',
    features: fallbackFeature ? [fallbackFeature] : [],
  }
}

function projectsToBoundaryCollection(
  projects: DrawingProject[],
): FeatureCollection<Geometry> {
  return {
    type: 'FeatureCollection',
    features: projects.map((project) => ({
      type: 'Feature',
      id: project.id,
      geometry: project.baseGeometry,
      properties: {
        projectId: project.id,
        name: project.name,
        editorMode: project.editorMode,
      },
    })),
  }
}

function projectsToFeatureCollection(
  projects: DrawingProject[],
  selectedProjectId: string | null,
  selectedFloorId: string | null,
): FeatureCollection<Geometry> {
  return {
    type: 'FeatureCollection',
    features: projects.flatMap((project) =>
      project.features
        .filter((feature) => {
          if (!selectedProjectId || project.id !== selectedProjectId) return true
          if (!selectedFloorId) return true
          const floorId = String((feature.properties as Record<string, unknown> | undefined)?.floorId ?? '')
          return floorId === selectedFloorId
        })
        .map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            projectId: project.id,
            projectName: project.name,
            editorMode: project.editorMode,
          },
        })),
    ) as Feature<Geometry>[],
  }
}

function bboxCenter(bbox: [number, number, number, number]): [number, number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
}

function approxDistanceSq(a: [number, number], b: [number, number]) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

export function DroneMap({
  dronesById,
  dirtyIds,
  selectedTarget,
  connectedCount,
  commandStatus,
  highlightedCandidate,
  selectedBoundaryGeometry,
  isFetchingCandidates,
  isFetchingFull,
  locationFetchMessage,
  onTargetSelect,
  onFetchLocation,
  onCancelTarget,
  onConfirmTarget,
}: DroneMapProps) {
  const { containerRef, map } = useDroneMap(onTargetSelect)
  const targetPoint = useProjectedTarget(map, selectedTarget)
  const [overlayProjects, setOverlayProjects] = useState<DrawingProject[]>([])
  const [selectedOverlayProjectId, setSelectedOverlayProjectId] = useState<string | null>(null)
  const [selectedOverlayFloorId, setSelectedOverlayFloorId] = useState<string | null>(null)
  const [overlayZoom, setOverlayZoom] = useState(2)
  const [overlayCenter, setOverlayCenter] = useState<[number, number]>([0, 0])
  const [isDeletingOverlayProject, setIsDeletingOverlayProject] = useState(false)
  const overlayProjectsRef = useRef<DrawingProject[]>([])
  const selectedOverlayProjectIdRef = useRef<string | null>(null)
  const selectedOverlayFloorIdRef = useRef<string | null>(null)
  const scheduleOverlayRefreshRef = useRef<(() => void) | null>(null)
  const selectedOverlayProject = useMemo(
    () => overlayProjects.find((project) => project.id === selectedOverlayProjectId) ?? null,
    [overlayProjects, selectedOverlayProjectId],
  )
  const overlayFloors = useMemo(
    () => [...(selectedOverlayProject?.floors ?? [])].sort((a, b) => b.level - a.level),
    [selectedOverlayProject],
  )
  const nearestFloorProjects = useMemo(() => {
    return overlayProjects
      .filter((project) => project.floors.length > 0)
      .sort((left, right) => {
        const leftDistance = approxDistanceSq(bboxCenter(left.bbox), overlayCenter)
        const rightDistance = approxDistanceSq(bboxCenter(right.bbox), overlayCenter)
        return leftDistance - rightDistance
      })
      .slice(0, maxNearbyBuildings)
  }, [overlayCenter, overlayProjects])

  useEffect(() => {
    overlayProjectsRef.current = overlayProjects
  }, [overlayProjects])
  useEffect(() => {
    selectedOverlayProjectIdRef.current = selectedOverlayProjectId
  }, [selectedOverlayProjectId])
  useEffect(() => {
    selectedOverlayFloorIdRef.current = selectedOverlayFloorId
  }, [selectedOverlayFloorId])

  useDroneMarkers({
    map,
    dronesById,
    dirtyIds,
  })

  useEffect(() => {
    if (!map) return
    const syncViewState = () => {
      setOverlayZoom(map.getZoom())
      const center = map.getCenter()
      setOverlayCenter([center.lng, center.lat])
    }
    syncViewState()
    map.on('move', syncViewState)
    map.on('zoom', syncViewState)
    return () => {
      map.off('move', syncViewState)
      map.off('zoom', syncViewState)
    }
  }, [map])

  useEffect(() => {
    if (overlayZoom < floorPanelMinZoom) return
    if (selectedOverlayProjectId) return
    if (nearestFloorProjects.length === 0) return
    const first = nearestFloorProjects[0]
    setSelectedOverlayProjectId(first.id)
    setSelectedOverlayFloorId(first.floors[0]?.id ?? null)
  }, [nearestFloorProjects, overlayZoom, selectedOverlayProjectId])

  useEffect(() => {
    if (!map) {
      return
    }

    const ensureHighlightLayers = () => {
      if (!mapStyleReady(map)) {
        return
      }
      if (!map.getSource(highlightSourceId)) {
        map.addSource(highlightSourceId, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        })
      }

      if (!map.getLayer(highlightFillLayerId)) {
        map.addLayer({
          id: highlightFillLayerId,
          type: 'fill',
          source: highlightSourceId,
          paint: {
            'fill-color': '#ff6a00',
            'fill-opacity': 0.12,
          },
        })
      }

      if (!map.getLayer(highlightLineLayerId)) {
        map.addLayer({
          id: highlightLineLayerId,
          type: 'line',
          source: highlightSourceId,
          paint: {
            'line-color': '#ff6a00',
            'line-width': 4,
          },
        })
      }
    }

    const onLoad = () => {
      ensureHighlightLayers()
    }

    if (map.isStyleLoaded()) {
      ensureHighlightLayers()
    } else {
      map.once('load', onLoad)
    }

    return () => {
      map.off('load', onLoad)
      removeLayerSafe(map, highlightLineLayerId)
      removeLayerSafe(map, highlightFillLayerId)
      removeSourceSafe(map, highlightSourceId)
    }
  }, [map])

  useEffect(() => {
    if (!map) {
      return
    }

    let disposed = false
    let refreshTimer: number | undefined

    const emptyCollection: FeatureCollection<Geometry> = {
      type: 'FeatureCollection',
      features: [],
    }

    const ensureOverlayLayers = () => {
      if (!mapStyleReady(map)) {
        return
      }
      if (!map.getSource(overlayBoundarySourceId)) {
        map.addSource(overlayBoundarySourceId, {
          type: 'geojson',
          data: emptyCollection,
        })
      }
      if (!map.getSource(overlayFeatureSourceId)) {
        map.addSource(overlayFeatureSourceId, {
          type: 'geojson',
          data: emptyCollection,
        })
      }
      if (!map.getLayer('published-overlay-boundary-fill')) {
        map.addLayer({
          id: 'published-overlay-boundary-fill',
          type: 'fill',
          source: overlayBoundarySourceId,
          paint: {
            'fill-color': '#94a3b8',
            'fill-opacity': 0.08,
          },
        })
      }
      if (!map.getLayer('published-overlay-boundary-line')) {
        map.addLayer({
          id: 'published-overlay-boundary-line',
          type: 'line',
          source: overlayBoundarySourceId,
          paint: {
            'line-color': '#64748b',
            'line-width': 2,
          },
        })
      }
      if (!map.getLayer('published-overlay-feature-fill')) {
        map.addLayer({
          id: 'published-overlay-feature-fill',
          type: 'fill',
          source: overlayFeatureSourceId,
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: {
            'fill-color': '#22c55e',
            'fill-opacity': 0.24,
          },
        })
      }
      if (!map.getLayer('published-overlay-feature-line')) {
        map.addLayer({
          id: 'published-overlay-feature-line',
          type: 'line',
          source: overlayFeatureSourceId,
          paint: {
            'line-color': '#15803d',
            'line-width': 3,
          },
        })
      }
      if (!map.getLayer('published-overlay-feature-point')) {
        map.addLayer({
          id: 'published-overlay-feature-point',
          type: 'circle',
          source: overlayFeatureSourceId,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-color': '#15803d',
            'circle-radius': 5,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        })
      }
    }

    const setOverlayData = (projects: DrawingProject[]) => {
      const zoom = map.getZoom()
      const boundarySource = getSourceSafe(map, overlayBoundarySourceId)
      const featureSource = getSourceSafe(map, overlayFeatureSourceId)
      const visibleBoundaryProjects = projects.filter(
        (project) => zoom >= project.boundaryMinZoom,
      )
      const visibleFeatureProjects = projects.filter((project) => zoom >= project.detailMinZoom)

      boundarySource?.setData(
        visibleBoundaryProjects.length > 0
          ? projectsToBoundaryCollection(visibleBoundaryProjects)
          : emptyCollection,
      )
      featureSource?.setData(
        visibleFeatureProjects.length > 0
          ? projectsToFeatureCollection(
            visibleFeatureProjects,
            selectedOverlayProjectIdRef.current,
            selectedOverlayFloorIdRef.current,
          )
          : emptyCollection,
      )
    }

    const refreshOverlays = async () => {
      if (disposed || !getSourceSafe(map, overlayBoundarySourceId)) {
        return
      }
      const zoom = map.getZoom()
      if (zoom < boundaryMinZoom) {
        setOverlayData([])
        return
      }
      const bounds = map.getBounds()
      try {
        const response = await fetchMapOverlays([
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ])
        if (!disposed) {
          setOverlayZoom(map.getZoom())
          const center = map.getCenter()
          setOverlayCenter([center.lng, center.lat])
          setOverlayProjects(response.projects)
          if (
            selectedOverlayProjectIdRef.current &&
            !response.projects.some((project) => project.id === selectedOverlayProjectIdRef.current)
          ) {
            setSelectedOverlayProjectId(null)
            setSelectedOverlayFloorId(null)
          }
          setOverlayData(response.projects)
        }
      } catch (error) {
        console.warn('Published overlay fetch failed:', error)
      }
    }

    const scheduleRefresh = () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      refreshTimer = window.setTimeout(refreshOverlays, 120)
    }
    scheduleOverlayRefreshRef.current = scheduleRefresh

    const onLoad = () => {
      ensureOverlayLayers()
      scheduleRefresh()
    }

    if (map.isStyleLoaded()) {
      onLoad()
    } else {
      map.once('load', onLoad)
    }
    map.on('moveend', scheduleRefresh)
    map.on('zoomend', scheduleRefresh)
    const handleBoundaryClick = (event: any) => {
      const feature = event.features?.[0]
      const projectId = feature?.properties?.projectId
      if (!projectId) return
      const nextProject = overlayProjectsRef.current.find((project) => project.id === projectId)
      setSelectedOverlayProjectId(projectId)
      if (nextProject && nextProject.floors.length > 0) {
        setSelectedOverlayFloorId(nextProject.floors[0].id)
      } else {
        setSelectedOverlayFloorId(null)
      }
    }
    map.on('click', 'published-overlay-boundary-fill', handleBoundaryClick)
    map.on('click', 'published-overlay-boundary-line', handleBoundaryClick)

    return () => {
      disposed = true
      scheduleOverlayRefreshRef.current = null
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      map.off('load', onLoad)
      map.off('moveend', scheduleRefresh)
      map.off('zoomend', scheduleRefresh)
      map.off('click', 'published-overlay-boundary-fill', handleBoundaryClick)
      map.off('click', 'published-overlay-boundary-line', handleBoundaryClick)
      for (const layerId of [
        'published-overlay-feature-point',
        'published-overlay-feature-line',
        'published-overlay-feature-fill',
        'published-overlay-boundary-line',
        'published-overlay-boundary-fill',
      ]) {
        removeLayerSafe(map, layerId)
      }
      for (const sourceId of [overlayFeatureSourceId, overlayBoundarySourceId]) {
        removeSourceSafe(map, sourceId)
      }
    }
  }, [map])

  const handleDeleteIndoorMap = async () => {
    if (!selectedOverlayProject) return
    const ok = window.confirm(`Delete indoor map "${selectedOverlayProject.name}"?`)
    if (!ok) return
    setIsDeletingOverlayProject(true)
    try {
      await deleteDrawingProject(selectedOverlayProject.id)
      setOverlayProjects((current) =>
        current.filter(
          (project) =>
            project.id !== selectedOverlayProject.id &&
            project.parentProjectId !== selectedOverlayProject.id,
        ),
      )
      setSelectedOverlayProjectId(null)
      setSelectedOverlayFloorId(null)
      scheduleOverlayRefreshRef.current?.()
    } catch (error) {
      console.warn('Delete indoor map failed:', error)
    } finally {
      setIsDeletingOverlayProject(false)
    }
  }

  useEffect(() => {
    if (!map) return
    const zoom = map.getZoom()
    const boundarySource = getSourceSafe(map, overlayBoundarySourceId)
    const featureSource = getSourceSafe(map, overlayFeatureSourceId)
    if (!boundarySource || !featureSource) return
    const emptyCollection: FeatureCollection<Geometry> = { type: 'FeatureCollection', features: [] }
    const visibleBoundaryProjects = overlayProjects.filter((project) => zoom >= project.boundaryMinZoom)
    const visibleFeatureProjects = overlayProjects.filter((project) => zoom >= project.detailMinZoom)
    boundarySource.setData(
      visibleBoundaryProjects.length > 0 ? projectsToBoundaryCollection(visibleBoundaryProjects) : emptyCollection,
    )
    featureSource.setData(
      visibleFeatureProjects.length > 0
        ? projectsToFeatureCollection(visibleFeatureProjects, selectedOverlayProjectId, selectedOverlayFloorId)
        : emptyCollection,
    )
  }, [map, overlayProjects, selectedOverlayFloorId, selectedOverlayProjectId])

  useEffect(() => {
    if (!map) {
      return
    }

    const source = getSourceSafe(map, highlightSourceId)
    if (!source) {
      return
    }
    if (selectedBoundaryGeometry) {
      source.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: selectedBoundaryGeometry,
            properties: {},
          },
        ],
      })
      return
    }

    source.setData(candidateToFeatureCollection(highlightedCandidate))
  }, [highlightedCandidate, selectedBoundaryGeometry, map])

  return (
    <div className="drone-map relative h-full min-h-[420px] overflow-hidden bg-slate-900 lg:min-h-0">
      <div ref={containerRef} className="absolute inset-0" aria-label="Drone map" />
      <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border border-white/20 bg-slate-950/80 px-3 py-2 text-sm text-white shadow-lg backdrop-blur">
        Click map to set target for connected drones
      </div>
      {overlayZoom >= floorPanelMinZoom && nearestFloorProjects.length > 0 ? (
        <div className="absolute left-4 top-16 z-20 w-72 rounded-lg border border-white/20 bg-slate-950/85 p-2 text-xs text-white shadow-lg backdrop-blur">
          <div className="mb-1 font-semibold text-sky-200">Indoor Floors</div>
          <div className="mb-2 text-[11px] text-slate-300">Nearest buildings first</div>
          <div className="max-h-36 space-y-1 overflow-y-auto border-b border-white/10 pb-2">
            {nearestFloorProjects.map((project) => {
              const active = project.id === selectedOverlayProjectId
              return (
                <button
                  key={project.id}
                  type="button"
                  className={`w-full rounded border px-2 py-1 text-left ${
                    active
                      ? 'border-sky-400/60 bg-sky-500/25 text-sky-100'
                      : 'border-white/15 bg-slate-900/80 text-slate-200 hover:text-white'
                  }`}
                  onClick={() => {
                    setSelectedOverlayProjectId(project.id)
                    setSelectedOverlayFloorId(project.floors[0]?.id ?? null)
                  }}
                >
                  {project.name}
                </button>
              )
            })}
          </div>
          <div className="mt-2 text-[11px] text-slate-300">
            {selectedOverlayProject ? selectedOverlayProject.name : 'Select a building'}
          </div>
          {selectedOverlayProject?.parentProjectId ? (
            <button
              type="button"
              className="mt-1 w-full rounded border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-left text-[11px] text-rose-100 hover:bg-rose-500/25 disabled:opacity-50"
              onClick={handleDeleteIndoorMap}
              disabled={isDeletingOverlayProject}
            >
              {isDeletingOverlayProject ? 'Deleting...' : 'Delete indoor map'}
            </button>
          ) : null}
          <div className="mt-1 max-h-44 space-y-1 overflow-y-auto">
            {selectedOverlayProject && overlayFloors.length > 0 ? (
              overlayFloors.map((floor) => (
                <button
                  key={floor.id}
                  type="button"
                  className={`w-full rounded border px-2 py-1 text-left ${
                    selectedOverlayFloorId === floor.id
                      ? 'border-sky-400/60 bg-sky-500/25 text-sky-100'
                      : 'border-white/15 bg-slate-900/80 text-slate-200 hover:text-white'
                  }`}
                  onClick={() => setSelectedOverlayFloorId(floor.id)}
                >
                  {floor.label} <span className="text-[10px] text-slate-400">{floor.code}</span>
                </button>
              ))
            ) : (
              <div className="rounded border border-white/10 px-2 py-1 text-slate-300">No floor selected</div>
            )}
          </div>
        </div>
      ) : null}
      {selectedTarget ? (
        <TargetCommandPopover
          target={selectedTarget}
          point={targetPoint}
          connectedCount={connectedCount}
          status={commandStatus}
          onFetchLocation={onFetchLocation}
          isFetchingCandidates={isFetchingCandidates}
          isFetchingFull={isFetchingFull}
          locationFetchMessage={locationFetchMessage}
          onCancel={onCancelTarget}
          onConfirm={onConfirmTarget}
        />
      ) : null}
    </div>
  )
}
