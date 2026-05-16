import { useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { GeoJSONSource, Map } from 'maplibre-gl'
import type { DrawingProject, ProjectCanvasConfig } from '../types/drone'
import type { SnapPreview } from './useSnapEngine'
import type { DrawMode } from './useDrawingEngine'

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
const selectedVertexSourceId = 'selected-feature-vertex-source'
const selectedVertexLayerId = 'selected-feature-vertex'

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

function selectedVertexFeatures(visibleFeatures: Feature[], selectedFeatureIds: string[]): Feature[] {
  if (selectedFeatureIds.length !== 1) return []
  const targetId = selectedFeatureIds[0]
  const selected = visibleFeatures.find((feature) => String(feature.id ?? feature.properties?.id ?? '') === targetId)
  if (!selected?.geometry) return []
  if (selected.geometry.type === 'Point') {
    return [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: selected.geometry.coordinates },
      properties: { featureId: targetId, vertexIndex: 0 },
    } as Feature]
  }
  if (selected.geometry.type === 'LineString') {
    return selected.geometry.coordinates.map((coordinate, index) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coordinate },
      properties: { featureId: targetId, vertexIndex: index },
    } as Feature))
  }
  if (selected.geometry.type === 'Polygon') {
    const ring = selected.geometry.coordinates[0] ?? []
    return ring.slice(0, -1).map((coordinate, index) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coordinate },
      properties: { featureId: targetId, vertexIndex: index },
    } as Feature))
  }
  return []
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
  activeMode: DrawMode
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
  activeMode,
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
    const selectedVertexCollection = featureCollection(
      activeMode === 'edit_points'
        ? selectedVertexFeatures(visibleFeatures, selectedFeatureIds)
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

    if (!getSourceSafe(map, selectedVertexSourceId)) {
      map.addSource(selectedVertexSourceId, { type: 'geojson', data: selectedVertexCollection })
    } else {
      getSourceSafe(map, selectedVertexSourceId)?.setData(selectedVertexCollection)
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

    if (!map.getLayer('project-features-selected-outline')) {
      map.addLayer({
        id: 'project-features-selected-outline',
        type: 'line',
        source: featureSourceId,
        paint: {
          'line-color': '#38bdf8',
          'line-width': 4,
        },
      })
    }

    if (!map.getLayer('project-features-label')) {
      map.addLayer({
        id: 'project-features-label',
        type: 'symbol',
        source: featureSourceId,
        minzoom: project.detailMinZoom,
        filter: ['!=', ['get', 'featureType'], 'text_label'],
        layout: {
          'text-field': ['coalesce', ['get', 'tag'], ['get', 'name'], ['get', 'featureType']],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#dbeafe',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.2,
        },
      })
    }

    if (!map.getLayer('project-text-label')) {
      map.addLayer({
        id: 'project-text-label',
        type: 'symbol',
        source: featureSourceId,
        minzoom: project.boundaryMinZoom,
        filter: ['==', ['get', 'featureType'], 'text_label'],
        layout: {
          'text-field': ['coalesce', ['get', 'text'], ['get', 'name'], ['get', 'tag'], 'Text'],
          'text-size': 14,
          'text-anchor': 'center',
          'text-justify': 'center',
          'text-max-width': 20,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
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

    if (!map.getLayer(selectedVertexLayerId)) {
      map.addLayer({
        id: selectedVertexLayerId,
        type: 'circle',
        source: selectedVertexSourceId,
        paint: {
          'circle-color': '#38bdf8',
          'circle-radius': 5,
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
  }, [activeMode, draftCollection, mapReady, mapLoaded, project, projectConfig.precisionZoom, snapPreview, visibleFeatures, selectedFeatureIds, map, isMounted, onBoundaryRendered, onMessage])

  useEffect(() => {
    if (!map || !project || !mapReadyForStyle(map, mapLoaded)) return
    const hasSelection = selectedFeatureIds.length > 0
    const filter = hasSelection
      ? ['in', ['to-string', ['id']], ['literal', selectedFeatureIds]]
      : ['==', ['geometry-type'], 'GeometryCollection']
    if (map.getLayer('project-features-selected-outline')) {
      map.setFilter('project-features-selected-outline', filter as any)
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
