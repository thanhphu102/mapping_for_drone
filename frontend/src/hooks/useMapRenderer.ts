import { useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { GeoJSONSource, Map } from 'maplibre-gl'
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
const draftLineLayerId = 'draft-feature-line'
const draftPointLayerId = 'draft-feature-point'
const dimMaskSourceId = 'dim-mask'
const dimMaskLayerId = 'dim-mask-fill'
const snapPreviewSourceId = 'snap-preview'
const snapPreviewLayerId = 'snap-preview-point'

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

    if (!getSourceSafe(map, dimMaskSourceId)) {
      map.addSource(dimMaskSourceId, { type: 'geojson', data: dimCollection })
    } else {
      getSourceSafe(map, dimMaskSourceId)?.setData(dimCollection)
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
    if (!map.getLayer(dimMaskLayerId)) {
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
        paint: { 'fill-color': '#0ea5e9', 'fill-opacity': 0.18 },
      })
    }

    if (!map.getLayer(baseBoundaryOutlineLayerId)) {
      map.addLayer({
        id: baseBoundaryOutlineLayerId,
        type: 'line',
        source: boundarySourceId,
        paint: { 'line-color': '#0369a1', 'line-width': 3 },
      })
    }

    if (!map.getLayer(featureFillLayerId)) {
      map.addLayer({
        id: featureFillLayerId,
        type: 'fill',
        source: featureSourceId,
        minzoom: project.boundaryMinZoom,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.2 },
      })
    }

    if (!map.getLayer(featureLineLayerId)) {
      map.addLayer({
        id: featureLineLayerId,
        type: 'line',
        source: featureSourceId,
        minzoom: project.boundaryMinZoom,
        paint: { 'line-color': '#15803d', 'line-width': 3 },
      })
    }

    if (!map.getLayer(featurePointLayerId)) {
      map.addLayer({
        id: featurePointLayerId,
        type: 'circle',
        source: featureSourceId,
        minzoom: project.detailMinZoom,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': '#15803d',
          'circle-radius': 6,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
    }

    if (!map.getLayer(snapPreviewLayerId)) {
      map.addLayer({
        id: snapPreviewLayerId,
        type: 'circle',
        source: snapPreviewSourceId,
        minzoom: projectConfig.precisionZoom,
        paint: {
          'circle-color': '#f97316',
          'circle-radius': 6,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
    }

    if (!map.getLayer('draft-feature-fill')) {
      map.addLayer({
        id: 'draft-feature-fill',
        type: 'fill',
        source: draftSourceId,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#f97316', 'fill-opacity': 0.15 },
      })
    }

    if (!map.getLayer(draftLineLayerId)) {
      map.addLayer({
        id: draftLineLayerId,
        type: 'line',
        source: draftSourceId,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#f97316', 'line-width': 3, 'line-dasharray': [2, 1] },
      })
    }

    if (!map.getLayer(draftPointLayerId)) {
      map.addLayer({
        id: draftPointLayerId,
        type: 'circle',
        source: draftSourceId,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': '#f97316',
          'circle-radius': 5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
    }

    if (!map.getLayer('draft-feature-vertex')) {
      map.addLayer({
        id: 'draft-feature-vertex',
        type: 'circle',
        source: draftSourceId,
        filter: ['==', ['geometry-type'], 'MultiPoint'],
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': 4,
          'circle-stroke-color': '#f97316',
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
  }, [draftCollection, mapReady, mapLoaded, project, projectConfig.precisionZoom, snapPreview, visibleFeatures, map, isMounted, onBoundaryRendered, onMessage])

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

    // Show vertex handles on features at precision zoom
    const vertexHandleLayerId = 'feature-vertex-handles'
    if (isPrecision) {
      if (!map.getLayer(vertexHandleLayerId) && getSourceSafe(map, featureSourceId)) {
        map.addLayer({
          id: vertexHandleLayerId,
          type: 'circle',
          source: featureSourceId,
          paint: {
            'circle-color': '#f97316',
            'circle-radius': 4,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        })
      }
    } else {
      if (map.getLayer(vertexHandleLayerId)) {
        map.removeLayer(vertexHandleLayerId)
      }
    }
  }, [map, mapLoaded, project, projectConfig.precisionZoom, mapReady, mapZoom])
}
