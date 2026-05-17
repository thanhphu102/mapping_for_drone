import { useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { FilterSpecification, GeoJSONSource, Map } from 'maplibre-gl'
import type { DrawingProject, ProjectCanvasConfig } from '../types/drone'
import type { SnapPreview } from './useSnapEngine'

const boundarySourceId = 'base-boundary'
const featureSourceId = 'project-features'
const draftSourceId = 'draft-feature'
const baseBoundaryFillLayerId = 'base-boundary-fill'
const baseBoundaryOutlineLayerId = 'base-boundary-outline'
const featureFillLayerId = 'project-features-fill'
const featureLineLayerId = 'project-features-line'
const featurePointLayerId = 'project-features-point'
const dimMaskSourceId = 'dim-mask'
const dimMaskLayerId = 'dim-mask-fill'
const snapPreviewSourceId = 'snap-preview'
const baseBoundaryOutlineColor = '#f97316'

function mapReadyForStyle(map: Map, mapLoaded: boolean) {
  return mapLoaded && map.isStyleLoaded()
}

function getSourceSafe(map: Map, sourceId: string): GeoJSONSource | null {
  try {
    return (map.getSource(sourceId) as GeoJSONSource | undefined) ?? null
  } catch {
    return null
  }
}

function featureCollection(features: Feature[]): FeatureCollection<Geometry> {
  return {
    type: 'FeatureCollection',
    features: features as Feature<Geometry>[],
  }
}

function boundaryFeature(project: DrawingProject): Feature<Geometry> {
  return {
    type: 'Feature',
    id: project.id,
    geometry: project.baseGeometry,
    properties: {
      projectId: project.id,
      name: project.name,
      locked: true,
    },
  }
}

function dimMaskFeature(project: DrawingProject): Feature<Geometry> {
  const holes = project.baseGeometry.coordinates.map((polygon) => polygon[0])
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-180, -85],
          [180, -85],
          [180, 85],
          [-180, 85],
          [-180, -85],
        ],
        ...holes,
      ],
    },
    properties: {},
  }
}

function boundaryBBox(project: DrawingProject): [number, number, number, number] {
  return project.bbox
}

interface UseMapRendererOptions {
  map: Map | null
  mapReady: boolean
  mapLoaded: boolean
  mapZoom: number
  project: DrawingProject | null
  projectConfig: ProjectCanvasConfig
  visibleFeatures: Feature[]
  selectedFeatureIds: string[]
  draftCollection: GeoJSON.FeatureCollection | null
  snapPreview: SnapPreview | null
  isMounted: () => boolean
  onBoundaryRendered: () => void
  onMessage: (msg: string) => void
}

export function useMapRenderer({
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
  onBoundaryRendered,
  onMessage,
}: UseMapRendererOptions) {
  const boundaryFittedProjectIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!map || !project) {
      return
    }
    if (!mapReadyForStyle(map, mapLoaded)) {
      return
    }

    const baseFeature = boundaryFeature(project)
    const baseCollection = featureCollection([baseFeature])
    const dimCollection = featureCollection([dimMaskFeature(project)])
    const projectFeatureCollection = featureCollection(visibleFeatures)
    const draftCollectionFeature = draftCollection ?? { type: 'FeatureCollection', features: [] }
    const snapCollection = featureCollection(
      snapPreview
        ? [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: snapPreview.point },
            properties: { kind: snapPreview.kind },
          } as Feature,
        ]
        : [],
    )
    // --- Sources ---
    if (!getSourceSafe(map, boundarySourceId)) {
      map.addSource(boundarySourceId, { type: 'geojson', data: baseCollection })
    } else {
      getSourceSafe(map, boundarySourceId)?.setData(baseCollection)
    }

    if (projectConfig.canvasMode === 'dimOutside') {
      if (!getSourceSafe(map, dimMaskSourceId)) {
        map.addSource(dimMaskSourceId, { type: 'geojson', data: dimCollection })
      } else {
        getSourceSafe(map, dimMaskSourceId)?.setData(dimCollection)
      }
    } else {
      if (map.getLayer(dimMaskLayerId)) {
        map.removeLayer(dimMaskLayerId)
      }
      if (getSourceSafe(map, dimMaskSourceId)) {
        map.removeSource(dimMaskSourceId)
      }
    }

    if (!getSourceSafe(map, featureSourceId)) {
      map.addSource(featureSourceId, { type: 'geojson', data: projectFeatureCollection })
    } else {
      getSourceSafe(map, featureSourceId)?.setData(projectFeatureCollection)
    }

    if (!getSourceSafe(map, draftSourceId)) {
      map.addSource(draftSourceId, { type: 'geojson', data: draftCollectionFeature })
    } else {
      getSourceSafe(map, draftSourceId)?.setData(draftCollectionFeature)
    }

    if (!getSourceSafe(map, snapPreviewSourceId)) {
      map.addSource(snapPreviewSourceId, { type: 'geojson', data: snapCollection })
    } else {
      getSourceSafe(map, snapPreviewSourceId)?.setData(snapCollection)
    }

    // --- Layers ---
    if (projectConfig.canvasMode === 'dimOutside' && !map.getLayer(dimMaskLayerId)) {
      map.addLayer({
        id: dimMaskLayerId,
        type: 'fill',
        source: dimMaskSourceId,
        paint: { 'fill-color': '#0f172a', 'fill-opacity': 0.35 },
      })
    }

    if (!map.getLayer(baseBoundaryFillLayerId)) {
      map.addLayer({
        id: baseBoundaryFillLayerId,
        type: 'fill',
        source: boundarySourceId,
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 1 },
      })
    }

    if (!map.getLayer(baseBoundaryOutlineLayerId)) {
      map.addLayer({
        id: baseBoundaryOutlineLayerId,
        type: 'line',
        source: boundarySourceId,
        paint: { 'line-color': baseBoundaryOutlineColor, 'line-opacity': 1, 'line-width': 3 },
      })
    }
    map.setPaintProperty(baseBoundaryOutlineLayerId, 'line-color', baseBoundaryOutlineColor)

    if (!map.getLayer(featureFillLayerId)) {
      map.addLayer({
        id: featureFillLayerId,
        type: 'fill',
        source: featureSourceId,
        minzoom: project.boundaryMinZoom,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#16a34a', 'fill-opacity': 0 },
      })
    }

    if (!map.getLayer(featureLineLayerId)) {
      map.addLayer({
        id: featureLineLayerId,
        type: 'line',
        source: featureSourceId,
        minzoom: project.boundaryMinZoom,
        paint: { 'line-color': '#15803d', 'line-opacity': 0, 'line-width': 3 },
      })
    }

    if (!map.getLayer('project-features-selected-outline')) {
      map.addLayer({
        id: 'project-features-selected-outline',
        type: 'line',
        source: featureSourceId,
        paint: {
          'line-color': '#38bdf8',
          'line-opacity': 0,
          'line-width': 4,
        },
      })
    }

    if (!map.getLayer(featurePointLayerId)) {
      map.addLayer({
        id: featurePointLayerId,
        type: 'circle',
        source: featureSourceId,
        minzoom: project.detailMinZoom,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Point'],
          ['!=', ['get', 'featureType'], 'text_label'],
        ],
        paint: {
          'circle-color': '#15803d',
          'circle-opacity': 0,
          'circle-stroke-opacity': 0,
          'circle-radius': 6,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
    }

    // --- Fit bounds once per project ---
    map.resize()
    requestAnimationFrame(() => {
      if (!map || !mapReadyForStyle(map, mapLoaded)) {
        return
      }
      map.resize()
      if (boundaryFittedProjectIdRef.current !== project.id) {
        const [minLng, minLat, maxLng, maxLat] = boundaryBBox(project)
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          { padding: 72, duration: 0 },
        )
        boundaryFittedProjectIdRef.current = project.id
      }
      if (isMounted()) {
        onBoundaryRendered()
        onMessage('Base boundary rendered')
      }
    })
  }, [draftCollection, mapReady, mapLoaded, project, projectConfig.canvasMode, snapPreview, visibleFeatures, selectedFeatureIds, map, isMounted, onBoundaryRendered, onMessage])

  useEffect(() => {
    if (!map || !project || !mapReadyForStyle(map, mapLoaded)) return
    const hasSelection = selectedFeatureIds.length > 0
    const filter = hasSelection
      ? ['in', ['to-string', ['id']], ['literal', selectedFeatureIds]]
      : ['==', ['geometry-type'], 'GeometryCollection']
    if (map.getLayer('project-features-selected-outline')) {
      map.setFilter('project-features-selected-outline', filter as FilterSpecification)
    }
  }, [map, mapLoaded, project, selectedFeatureIds])

  // --- Precision mode: fade raster tiles at deep zoom ---
  useEffect(() => {
    if (!map || !project) {
      return
    }
    if (!mapReadyForStyle(map, mapLoaded)) {
      return
    }

    const currentZoom = map.getZoom()
    const isPrecision = currentZoom >= projectConfig.precisionZoom
    const osmLayer = map.getLayer('osm')
    if (osmLayer) {
      map.setPaintProperty('osm', 'raster-opacity', isPrecision ? 0.3 : 1)
    }

  }, [map, mapLoaded, project, projectConfig.precisionZoom, mapReady, mapZoom])
}
