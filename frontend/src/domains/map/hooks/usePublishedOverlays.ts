import { useCallback, useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { FeatureCollection, Geometry } from 'geojson'
import type { Map, MapLayerMouseEvent } from 'maplibre-gl'
import {
  deleteDrawingProject,
  fetchMapOverlays,
} from '../../spatial-editor/services/projects'
import type { DrawingProject } from '../../spatial-editor/types'
import {
  PUBLISHED_OVERLAY_BOUNDARY_FILL_LAYER_ID,
  PUBLISHED_OVERLAY_BOUNDARY_LINE_LAYER_ID,
  PUBLISHED_OVERLAY_BOUNDARY_MIN_ZOOM,
  PUBLISHED_OVERLAY_BOUNDARY_SOURCE_ID,
  PUBLISHED_OVERLAY_FEATURE_FILL_LAYER_ID,
  PUBLISHED_OVERLAY_FEATURE_LINE_LAYER_ID,
  PUBLISHED_OVERLAY_FEATURE_POINT_LAYER_ID,
  PUBLISHED_OVERLAY_FEATURE_SOURCE_ID,
  projectsToBoundaryCollection,
  projectsToFeatureCollection,
} from '../layers/overlayLayers'
import {
  getSourceSafe,
  mapStyleReady,
  removeLayerSafe,
  removeSourceSafe,
} from './useMapSources'

interface UsePublishedOverlaysOptions {
  map: Map | null
  overlayProjects: DrawingProject[]
  setOverlayProjects: Dispatch<SetStateAction<DrawingProject[]>>
  selectedOverlayProjectId: string | null
  selectedOverlayFloorId: string | null
  selectedOverlayProject: DrawingProject | null
  setSelectedOverlayProjectId: Dispatch<SetStateAction<string | null>>
  setSelectedOverlayFloorId: Dispatch<SetStateAction<string | null>>
  setOverlayZoom: Dispatch<SetStateAction<number>>
  setOverlayCenter: Dispatch<SetStateAction<[number, number]>>
  setIsDeletingOverlayProject: Dispatch<SetStateAction<boolean>>
  overlayProjectsRef: MutableRefObject<DrawingProject[]>
  selectedOverlayProjectIdRef: MutableRefObject<string | null>
  selectedOverlayFloorIdRef: MutableRefObject<string | null>
  scheduleOverlayRefreshRef: MutableRefObject<(() => void) | null>
}

export function usePublishedOverlays({
  map,
  overlayProjects,
  setOverlayProjects,
  selectedOverlayProjectId,
  selectedOverlayFloorId,
  selectedOverlayProject,
  setSelectedOverlayProjectId,
  setSelectedOverlayFloorId,
  setOverlayZoom,
  setOverlayCenter,
  setIsDeletingOverlayProject,
  overlayProjectsRef,
  selectedOverlayProjectIdRef,
  selectedOverlayFloorIdRef,
  scheduleOverlayRefreshRef,
}: UsePublishedOverlaysOptions) {
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
  }, [map, setOverlayCenter, setOverlayZoom])

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
      if (!map.getSource(PUBLISHED_OVERLAY_BOUNDARY_SOURCE_ID)) {
        map.addSource(PUBLISHED_OVERLAY_BOUNDARY_SOURCE_ID, {
          type: 'geojson',
          data: emptyCollection,
        })
      }
      if (!map.getSource(PUBLISHED_OVERLAY_FEATURE_SOURCE_ID)) {
        map.addSource(PUBLISHED_OVERLAY_FEATURE_SOURCE_ID, {
          type: 'geojson',
          data: emptyCollection,
        })
      }
      if (!map.getLayer(PUBLISHED_OVERLAY_BOUNDARY_FILL_LAYER_ID)) {
        map.addLayer({
          id: PUBLISHED_OVERLAY_BOUNDARY_FILL_LAYER_ID,
          type: 'fill',
          source: PUBLISHED_OVERLAY_BOUNDARY_SOURCE_ID,
          paint: {
            'fill-color': '#94a3b8',
            'fill-opacity': 0.08,
          },
        })
      }
      if (!map.getLayer(PUBLISHED_OVERLAY_BOUNDARY_LINE_LAYER_ID)) {
        map.addLayer({
          id: PUBLISHED_OVERLAY_BOUNDARY_LINE_LAYER_ID,
          type: 'line',
          source: PUBLISHED_OVERLAY_BOUNDARY_SOURCE_ID,
          paint: {
            'line-color': '#64748b',
            'line-width': 2,
          },
        })
      }
      if (!map.getLayer(PUBLISHED_OVERLAY_FEATURE_FILL_LAYER_ID)) {
        map.addLayer({
          id: PUBLISHED_OVERLAY_FEATURE_FILL_LAYER_ID,
          type: 'fill',
          source: PUBLISHED_OVERLAY_FEATURE_SOURCE_ID,
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: {
            'fill-color': '#a855f7',
            'fill-opacity': 0.24,
          },
        })
      }
      if (!map.getLayer(PUBLISHED_OVERLAY_FEATURE_LINE_LAYER_ID)) {
        map.addLayer({
          id: PUBLISHED_OVERLAY_FEATURE_LINE_LAYER_ID,
          type: 'line',
          source: PUBLISHED_OVERLAY_FEATURE_SOURCE_ID,
          paint: {
            'line-color': '#7e22ce',
            'line-width': 3,
          },
        })
      }
      if (!map.getLayer(PUBLISHED_OVERLAY_FEATURE_POINT_LAYER_ID)) {
        map.addLayer({
          id: PUBLISHED_OVERLAY_FEATURE_POINT_LAYER_ID,
          type: 'circle',
          source: PUBLISHED_OVERLAY_FEATURE_SOURCE_ID,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-color': '#7e22ce',
            'circle-radius': 5,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        })
      }
    }

    const setOverlayData = (projects: DrawingProject[]) => {
      const zoom = map.getZoom()
      const boundarySource = getSourceSafe(map, PUBLISHED_OVERLAY_BOUNDARY_SOURCE_ID)
      const featureSource = getSourceSafe(map, PUBLISHED_OVERLAY_FEATURE_SOURCE_ID)
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
      if (disposed || !getSourceSafe(map, PUBLISHED_OVERLAY_BOUNDARY_SOURCE_ID)) {
        return
      }
      const zoom = map.getZoom()
      if (zoom < PUBLISHED_OVERLAY_BOUNDARY_MIN_ZOOM) {
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
    const handleBoundaryClick = (event: MapLayerMouseEvent) => {
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
    map.on('click', PUBLISHED_OVERLAY_BOUNDARY_FILL_LAYER_ID, handleBoundaryClick)
    map.on('click', PUBLISHED_OVERLAY_BOUNDARY_LINE_LAYER_ID, handleBoundaryClick)

    return () => {
      disposed = true
      scheduleOverlayRefreshRef.current = null
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      map.off('load', onLoad)
      map.off('moveend', scheduleRefresh)
      map.off('zoomend', scheduleRefresh)
      map.off('click', PUBLISHED_OVERLAY_BOUNDARY_FILL_LAYER_ID, handleBoundaryClick)
      map.off('click', PUBLISHED_OVERLAY_BOUNDARY_LINE_LAYER_ID, handleBoundaryClick)
      for (const layerId of [
        PUBLISHED_OVERLAY_FEATURE_POINT_LAYER_ID,
        PUBLISHED_OVERLAY_FEATURE_LINE_LAYER_ID,
        PUBLISHED_OVERLAY_FEATURE_FILL_LAYER_ID,
        PUBLISHED_OVERLAY_BOUNDARY_LINE_LAYER_ID,
        PUBLISHED_OVERLAY_BOUNDARY_FILL_LAYER_ID,
      ]) {
        removeLayerSafe(map, layerId)
      }
      for (const sourceId of [PUBLISHED_OVERLAY_FEATURE_SOURCE_ID, PUBLISHED_OVERLAY_BOUNDARY_SOURCE_ID]) {
        removeSourceSafe(map, sourceId)
      }
    }
  }, [
    map,
    overlayProjectsRef,
    scheduleOverlayRefreshRef,
    selectedOverlayFloorIdRef,
    selectedOverlayProjectIdRef,
    setOverlayCenter,
    setOverlayProjects,
    setOverlayZoom,
    setSelectedOverlayFloorId,
    setSelectedOverlayProjectId,
  ])

  const handleDeleteOverlayProject = useCallback(async () => {
    if (!selectedOverlayProject) return
    const ok = window.confirm(`Delete map "${selectedOverlayProject.name}"?`)
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
      console.warn('Delete overlay map failed:', error)
    } finally {
      setIsDeletingOverlayProject(false)
    }
  }, [
    scheduleOverlayRefreshRef,
    selectedOverlayProject,
    setIsDeletingOverlayProject,
    setOverlayProjects,
    setSelectedOverlayFloorId,
    setSelectedOverlayProjectId,
  ])

  useEffect(() => {
    if (!map) return
    const zoom = map.getZoom()
    const boundarySource = getSourceSafe(map, PUBLISHED_OVERLAY_BOUNDARY_SOURCE_ID)
    const featureSource = getSourceSafe(map, PUBLISHED_OVERLAY_FEATURE_SOURCE_ID)
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

  return {
    handleDeleteOverlayProject,
  }
}
