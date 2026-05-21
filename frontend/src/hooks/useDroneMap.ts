import { useEffect, useRef, useState } from 'react'
import maplibregl, {
  type Map,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapTargetDraft } from '../types/drone'
import {
  readStoredMainMapCamera,
  type StoredMainMapCamera,
  writeStoredMainMapCamera,
} from '../utils/mainMapCamera'

export const VIETNAM_MAP_CENTER: [number, number] = [108.2772, 14.0583]
export const VIETNAM_DEFAULT_ZOOM = 5.15
export const VIETNAM_FOCUS_ZOOM = 5.55

const legacyNullIslandCamera = {
  center: [0, 0] as [number, number],
  zoom: 2,
}

function isLegacyNullIslandCamera(camera: StoredMainMapCamera | null) {
  if (!camera) return false
  const [lng, lat] = camera.center
  return (
    Math.abs(lng - legacyNullIslandCamera.center[0]) < 0.000001 &&
    Math.abs(lat - legacyNullIslandCamera.center[1]) < 0.000001 &&
    Math.abs(camera.zoom - legacyNullIslandCamera.zoom) < 0.05
  )
}

function initialMainMapCamera(): StoredMainMapCamera {
  const restoredCamera = readStoredMainMapCamera()
  if (restoredCamera && !isLegacyNullIslandCamera(restoredCamera)) {
    return restoredCamera
  }

  return {
    center: VIETNAM_MAP_CENTER,
    zoom: VIETNAM_DEFAULT_ZOOM,
    bearing: 0,
    pitch: 0,
  }
}

const rasterOsmStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#0f172a' },
    },
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-fade-duration': 0 },
    },
  ],
}

interface MapLibreWithSupport {
  version?: string
  supported?: () => boolean
}

export function useDroneMap(onTargetSelect: (target: MapTargetDraft) => void) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const onTargetSelectRef = useRef(onTargetSelect)
  const [map, setMap] = useState<Map | null>(null)
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    onTargetSelectRef.current = onTargetSelect
  }, [onTargetSelect])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    const initialCamera = initialMainMapCamera()
    const mapInstance = new maplibregl.Map({
      container: containerRef.current,
      style: rasterOsmStyle,
      center: initialCamera.center,
      zoom: initialCamera.zoom,
      bearing: initialCamera.bearing,
      pitch: initialCamera.pitch,
      fadeDuration: 0,
    })

    const maplibreInfo = maplibregl as MapLibreWithSupport

    // Robust WebGL detection: try MapLibre supported() when available; otherwise
    // create a temporary canvas and probe getContext('webgl2'|'webgl'|'experimental-webgl')
    let webglSupported: boolean | undefined = undefined
    try {
      const supportedFn = maplibreInfo.supported
      if (typeof supportedFn === 'function') {
        webglSupported = supportedFn()
      }
    } catch {
      // ignore
    }

    if (webglSupported === undefined) {
      try {
        const probeCanvas = document.createElement('canvas')
        const ctx = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl') || probeCanvas.getContext('experimental-webgl')
        webglSupported = !!ctx
      } catch {
        webglSupported = false
      }
    }

    if (!webglSupported) {
      setMapStatus('error')
    }

    // Ensure container and reasonable ancestors have height so map can render.
    // This is a targeted, conservative fix for environments where CSS utilities
    // result in a 0px height. We only set inline styles when computed height is 0.
    try {
      let el: HTMLElement | null = containerRef.current
      while (el && el !== document.body && el !== document.documentElement) {
        const rect = el.getBoundingClientRect()
        if (rect.height === 0) {
          // set a fallback height; prefer percentage so it stretches with layout
          el.style.minHeight = el.style.minHeight || '420px'
          el.style.height = el.style.height || '100%'
        }
        el = el.parentElement
      }
    } catch {
      // ignore
    }

    mapRef.current = mapInstance
    setMap(mapInstance)
    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right')

    const handleClick = (event: MapMouseEvent) => {
      onTargetSelectRef.current({
        lat: event.lngLat.lat,
        lon: event.lngLat.lng,
      })
    }

    const handleLoad = () => {
      const savedCamera = readStoredMainMapCamera()
      if (savedCamera) {
        mapInstance.jumpTo({
          center: savedCamera.center,
          zoom: savedCamera.zoom,
          bearing: savedCamera.bearing,
          pitch: savedCamera.pitch,
        })
      }
      mapInstance.resize()
      setMapStatus('ready')
    }

    const handleResize = () => {
      mapInstance.resize()
    }

    const canvas = mapInstance.getCanvas()

    const handleWebGlContextLost = (event: Event) => {
      // Allow MapLibre to attempt restoration instead of leaving a dead canvas.
      event.preventDefault()
      console.warn('Map WebGL context lost; attempting recovery')
    }

    const handleWebGlContextRestored = () => {
      console.info('Map WebGL context restored')
      mapInstance.resize()
      mapInstance.triggerRepaint()
    }

    const handleError = (event: unknown) => {
      const maybeError = event as { error?: unknown; sourceId?: string }
      console.error('MapLibre runtime error:', maybeError)
      setMapStatus('error')
    }

    const persistCamera = () => {
      const center = mapInstance.getCenter()
      writeStoredMainMapCamera({
        center: [center.lng, center.lat],
        zoom: mapInstance.getZoom(),
        bearing: mapInstance.getBearing(),
        pitch: mapInstance.getPitch(),
      })
    }

    const handleCameraFlushRequest = () => {
      persistCamera()
    }

    mapInstance.on('load', handleLoad)
    mapInstance.on('click', handleClick)
    mapInstance.on('error', handleError)
    mapInstance.on('moveend', persistCamera)
    mapInstance.on('zoomend', persistCamera)
    mapInstance.on('rotateend', persistCamera)
    mapInstance.on('pitchend', persistCamera)
    window.addEventListener('resize', handleResize)
    window.addEventListener('drone:flush-main-map-camera', handleCameraFlushRequest)
    canvas.addEventListener('webglcontextlost', handleWebGlContextLost)
    canvas.addEventListener('webglcontextrestored', handleWebGlContextRestored)
    persistCamera()

    return () => {
      mapInstance.off('load', handleLoad)
      mapInstance.off('click', handleClick)
      mapInstance.off('error', handleError)
      mapInstance.off('moveend', persistCamera)
      mapInstance.off('zoomend', persistCamera)
      mapInstance.off('rotateend', persistCamera)
      mapInstance.off('pitchend', persistCamera)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('drone:flush-main-map-camera', handleCameraFlushRequest)
      canvas.removeEventListener('webglcontextlost', handleWebGlContextLost)
      canvas.removeEventListener('webglcontextrestored', handleWebGlContextRestored)
      mapInstance.remove()
      mapRef.current = null
      setMap(null)
    }
  }, [])

  return {
    containerRef,
    map,
    mapStatus,
  }
}
