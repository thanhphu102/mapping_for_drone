import { useEffect } from 'react'
import type { Geometry } from 'geojson'
import type { Map } from 'maplibre-gl'
import type { OsmCandidate } from '../../osm/types'
import {
  OSM_HIGHLIGHT_FILL_LAYER_ID,
  OSM_HIGHLIGHT_LINE_LAYER_ID,
  OSM_HIGHLIGHT_SOURCE_ID,
  candidateToFeatureCollection,
} from '../layers/osmPreviewLayers'
import {
  getSourceSafe,
  mapStyleReady,
  removeLayerSafe,
  removeSourceSafe,
} from './useMapSources'

interface UseOsmPreviewLayersOptions {
  map: Map | null
  highlightedCandidate: OsmCandidate | null
  selectedBoundaryGeometry: Geometry | null
}

export function useOsmPreviewLayers({
  map,
  highlightedCandidate,
  selectedBoundaryGeometry,
}: UseOsmPreviewLayersOptions) {
  useEffect(() => {
    if (!map) {
      return
    }

    const ensureHighlightLayers = () => {
      if (!mapStyleReady(map)) {
        return
      }
      if (!map.getSource(OSM_HIGHLIGHT_SOURCE_ID)) {
        map.addSource(OSM_HIGHLIGHT_SOURCE_ID, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        })
      }

      if (!map.getLayer(OSM_HIGHLIGHT_FILL_LAYER_ID)) {
        map.addLayer({
          id: OSM_HIGHLIGHT_FILL_LAYER_ID,
          type: 'fill',
          source: OSM_HIGHLIGHT_SOURCE_ID,
          paint: {
            'fill-color': '#ff6a00',
            'fill-opacity': 0.12,
          },
        })
      }

      if (!map.getLayer(OSM_HIGHLIGHT_LINE_LAYER_ID)) {
        map.addLayer({
          id: OSM_HIGHLIGHT_LINE_LAYER_ID,
          type: 'line',
          source: OSM_HIGHLIGHT_SOURCE_ID,
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
      removeLayerSafe(map, OSM_HIGHLIGHT_LINE_LAYER_ID)
      removeLayerSafe(map, OSM_HIGHLIGHT_FILL_LAYER_ID)
      removeSourceSafe(map, OSM_HIGHLIGHT_SOURCE_ID)
    }
  }, [map])

  useEffect(() => {
    if (!map) {
      return
    }

    const source = getSourceSafe(map, OSM_HIGHLIGHT_SOURCE_ID)
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
  }, [highlightedCandidate, map, selectedBoundaryGeometry])
}
