import { useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, Geometry, Point, Position } from 'geojson'
import type { Map } from 'maplibre-gl'
import type { OsmCandidate } from '../../osm/types'
import {
  OSM_HIGHLIGHT_FILL_LAYER_ID,
  OSM_HIGHLIGHT_LINE_LAYER_ID,
  OSM_HIGHLIGHT_SOURCE_ID,
  candidateToFeatureCollection,
  transformPreviewFeatureCollection,
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
  calibrationDragEnabled?: boolean
  onCalibrationDragDelta?: (deltaLon: number, deltaLat: number) => void
  onCalibrationRotateDelta?: (deltaDeg: number) => void
  previewCalibration?: {
    offsetLon: number
    offsetLat: number
    rotationDeg: number
  } | null
}

const OSM_CALIBRATION_HANDLE_SOURCE_ID = 'osm-calibration-handle-source'
const OSM_CALIBRATION_HANDLE_LAYER_ID = 'osm-calibration-handle-layer'

function geometryPoints(geometry: Geometry): Position[] {
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flat(2)
  }
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.flat(1)
  }
  return []
}

function geometryCentroid(geometry: Geometry): Position | null {
  const pts = geometryPoints(geometry)
  if (pts.length === 0) return null
  let lon = 0
  let lat = 0
  for (const [x, y] of pts) {
    lon += x
    lat += y
  }
  return [lon / pts.length, lat / pts.length]
}

function calibrationHandleFeature(geometry: Geometry): Feature<Point> | null {
  const pts = geometryPoints(geometry)
  const centroid = geometryCentroid(geometry)
  if (!centroid || pts.length === 0) return null
  const maxLat = Math.max(...pts.map(([, lat]) => lat))
  const minLat = Math.min(...pts.map(([, lat]) => lat))
  const offset = Math.max((maxLat - minLat) * 0.18, 0.00005)
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [centroid[0], maxLat + offset] },
    properties: {},
  }
}

export function useOsmPreviewLayers({
  map,
  highlightedCandidate,
  selectedBoundaryGeometry,
  calibrationDragEnabled = false,
  onCalibrationDragDelta,
  onCalibrationRotateDelta,
  previewCalibration = null,
}: UseOsmPreviewLayersOptions) {
  const selectedGeometryRef = useRef<Geometry | null>(selectedBoundaryGeometry)
  const dragDeltaRef = useRef(onCalibrationDragDelta)
  const rotateDeltaRef = useRef(onCalibrationRotateDelta)

  useEffect(() => {
    selectedGeometryRef.current = selectedBoundaryGeometry
  }, [selectedBoundaryGeometry])

  useEffect(() => {
    dragDeltaRef.current = onCalibrationDragDelta
  }, [onCalibrationDragDelta])

  useEffect(() => {
    rotateDeltaRef.current = onCalibrationRotateDelta
  }, [onCalibrationRotateDelta])

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
      if (!map.getSource(OSM_CALIBRATION_HANDLE_SOURCE_ID)) {
        map.addSource(OSM_CALIBRATION_HANDLE_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }
      if (!map.getLayer(OSM_CALIBRATION_HANDLE_LAYER_ID)) {
        map.addLayer({
          id: OSM_CALIBRATION_HANDLE_LAYER_ID,
          type: 'circle',
          source: OSM_CALIBRATION_HANDLE_SOURCE_ID,
          paint: {
            'circle-radius': 6,
            'circle-color': '#0ea5e9',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
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
      removeLayerSafe(map, OSM_CALIBRATION_HANDLE_LAYER_ID)
      removeSourceSafe(map, OSM_HIGHLIGHT_SOURCE_ID)
      removeSourceSafe(map, OSM_CALIBRATION_HANDLE_SOURCE_ID)
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

    source.setData(
      transformPreviewFeatureCollection(
        candidateToFeatureCollection(highlightedCandidate),
        previewCalibration,
      ),
    )
  }, [highlightedCandidate, map, previewCalibration, selectedBoundaryGeometry])

  useEffect(() => {
    if (!map) return
    const source = getSourceSafe(map, OSM_CALIBRATION_HANDLE_SOURCE_ID)
    if (!source) return
    if (!selectedBoundaryGeometry || !calibrationDragEnabled) {
      source.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    const handle = calibrationHandleFeature(selectedBoundaryGeometry)
    const fc: FeatureCollection = { type: 'FeatureCollection', features: handle ? [handle] : [] }
    source.setData(fc)
  }, [calibrationDragEnabled, map, selectedBoundaryGeometry])

  useEffect(() => {
    if (!map || !calibrationDragEnabled || !selectedGeometryRef.current || !dragDeltaRef.current) {
      if (map) {
        map.getCanvas().style.cursor = ''
      }
      return
    }

    let dragging = false
    let previousLngLat: { lng: number; lat: number } | null = null
    let rotating = false
    let previousAngle = 0

    const angleFromCenter = (lng: number, lat: number): number => {
      const geometry = selectedGeometryRef.current
      if (!geometry) return 0
      const center = geometryCentroid(geometry)
      if (!center) return 0
      return Math.atan2(lat - center[1], lng - center[0]) * (180 / Math.PI)
    }

    const handleMouseEnter = () => {
      if (!dragging) {
        map.getCanvas().style.cursor = 'grab'
      }
    }
    const handleMouseLeave = () => {
      if (!dragging) {
        map.getCanvas().style.cursor = ''
      }
    }
    const handleMouseDown = (event: { lngLat: { lng: number; lat: number }; originalEvent?: { preventDefault?: () => void; stopPropagation?: () => void } }) => {
      event.originalEvent?.preventDefault?.()
      event.originalEvent?.stopPropagation?.()
      dragging = true
      rotating = false
      previousLngLat = { lng: event.lngLat.lng, lat: event.lngLat.lat }
      map.dragPan.disable()
      map.getCanvas().style.cursor = 'grabbing'
    }
    const handleRotateMouseDown = (event: { lngLat: { lng: number; lat: number }; originalEvent?: { preventDefault?: () => void; stopPropagation?: () => void } }) => {
      event.originalEvent?.preventDefault?.()
      event.originalEvent?.stopPropagation?.()
      dragging = true
      rotating = true
      previousAngle = angleFromCenter(event.lngLat.lng, event.lngLat.lat)
      map.dragPan.disable()
      map.getCanvas().style.cursor = 'grabbing'
    }
    const handleMouseMove = (event: { lngLat: { lng: number; lat: number } }) => {
      if (!dragging) {
        return
      }
      if (rotating) {
        const nextAngle = angleFromCenter(event.lngLat.lng, event.lngLat.lat)
        let delta = nextAngle - previousAngle
        if (delta > 180) delta -= 360
        if (delta < -180) delta += 360
        if (delta !== 0 && rotateDeltaRef.current) {
          rotateDeltaRef.current(delta)
        }
        previousAngle = nextAngle
        return
      }
      if (!previousLngLat) return
      const current = event.lngLat
      const deltaLon = current.lng - previousLngLat.lng
      const deltaLat = current.lat - previousLngLat.lat
      if (deltaLon !== 0 || deltaLat !== 0) {
        dragDeltaRef.current?.(deltaLon, deltaLat)
      }
      previousLngLat = { lng: current.lng, lat: current.lat }
    }
    const handleMouseUp = () => {
      if (!dragging) return
      dragging = false
      previousLngLat = null
      map.dragPan.enable()
      map.getCanvas().style.cursor = 'grab'
    }

    map.on('mouseenter', OSM_HIGHLIGHT_FILL_LAYER_ID, handleMouseEnter)
    map.on('mouseleave', OSM_HIGHLIGHT_FILL_LAYER_ID, handleMouseLeave)
    map.on('mousedown', OSM_HIGHLIGHT_FILL_LAYER_ID, handleMouseDown)
    map.on('mousedown', OSM_CALIBRATION_HANDLE_LAYER_ID, handleRotateMouseDown)
    map.on('mousemove', handleMouseMove)
    map.on('mouseup', handleMouseUp)
    map.on('mouseleave', handleMouseUp)

    return () => {
      map.off('mouseenter', OSM_HIGHLIGHT_FILL_LAYER_ID, handleMouseEnter)
      map.off('mouseleave', OSM_HIGHLIGHT_FILL_LAYER_ID, handleMouseLeave)
      map.off('mousedown', OSM_HIGHLIGHT_FILL_LAYER_ID, handleMouseDown)
      map.off('mousedown', OSM_CALIBRATION_HANDLE_LAYER_ID, handleRotateMouseDown)
      map.off('mousemove', handleMouseMove)
      map.off('mouseup', handleMouseUp)
      map.off('mouseleave', handleMouseUp)
      map.dragPan.enable()
      map.getCanvas().style.cursor = ''
    }
  }, [calibrationDragEnabled, map])
}
