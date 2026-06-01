import { useEffect, useRef, useState } from 'react'
import maplibregl, {
  type Map,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapTargetDraft } from '../../drone/types'
import { mapClickEventToTarget } from './useMapClickTarget'
import {
  readStoredMainMapCamera,
  type StoredMainMapCamera,
  writeStoredMainMapCamera,
} from '../utils/mainMapCamera'

export const VIETNAM_MAP_CENTER: [number, number] = [108.2772, 14.0583]
export const VIETNAM_OVERVIEW_BOUNDS: [[number, number], [number, number]] = [
  [101.8, 7.4],
  [111.4, 23.7],
]
export const VIETNAM_DEFAULT_ZOOM = 4.85
export const VIETNAM_FOCUS_ZOOM = 5.1
const GOOGLE_RASTER_MAX_ZOOM = 21

interface InitialMainMapCamera {
  camera: StoredMainMapCamera
  source: 'stored' | 'vietnam-overview'
}

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

export function fitVietnamOverview(map: Map, duration = 650) {
  map.easeTo({
    bearing: 0,
    pitch: 0,
    duration: 0,
  })
  map.fitBounds(VIETNAM_OVERVIEW_BOUNDS, {
    padding: {
      top: 56,
      right: 56,
      bottom: 56,
      left: 56,
    },
    duration,
  })
}

function initialMainMapCamera(): InitialMainMapCamera {
  const restoredCamera = readStoredMainMapCamera()
  if (restoredCamera && !isLegacyNullIslandCamera(restoredCamera)) {
    return {
      camera: restoredCamera,
      source: 'stored',
    }
  }

  return {
    camera: {
      center: VIETNAM_MAP_CENTER,
      zoom: VIETNAM_DEFAULT_ZOOM,
      bearing: 0,
      pitch: 0,
    },
    source: 'vietnam-overview',
  }
}

function googleRasterTileScale() {
  return window.devicePixelRatio >= 1.25 ? 2 : 1
}

function createRasterGoogleHybridStyle(): StyleSpecification {
  const tileScale = googleRasterTileScale()

  return {
    version: 8,
    sources: {
      googleHybrid: {
        type: 'raster',
        tiles: [
          `/api/tiles/google/hybrid/{z}/{x}/{y}.png?scale=${tileScale}`,
        ],
        tileSize: 256,
        maxzoom: GOOGLE_RASTER_MAX_ZOOM,
        attribution: '&copy; <a href="https://www.google.com/maps">Google Maps</a>',
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#f8fafc' },
      },
      {
        id: 'google-hybrid',
        type: 'raster',
        source: 'googleHybrid',
        paint: {
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
        },
      },
    ],
  }
}

interface MapLibreWithSupport {
  version?: string
  supported?: () => boolean
}

export function useBaseMap(onTargetSelect: (target: MapTargetDraft) => void) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const onTargetSelectRef = useRef(onTargetSelect)
  const mapReadyRef = useRef(false)
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
      style: createRasterGoogleHybridStyle(),
      center: initialCamera.camera.center,
      zoom: initialCamera.camera.zoom,
      maxZoom: GOOGLE_RASTER_MAX_ZOOM,
      renderWorldCopies: false,
      bearing: initialCamera.camera.bearing,
      pitch: initialCamera.camera.pitch,
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

    const handleClick = (event: Parameters<typeof mapClickEventToTarget>[0]) => {
      onTargetSelectRef.current(mapClickEventToTarget(event))
    }

    const handleLoad = () => {
      if (initialCamera.source === 'stored') {
        const savedCamera = initialCamera.camera
        mapInstance.jumpTo({
          center: savedCamera.center,
          zoom: savedCamera.zoom,
          bearing: savedCamera.bearing,
          pitch: savedCamera.pitch,
        })
      } else {
        fitVietnamOverview(mapInstance, 0)
      }
      mapInstance.resize()
      persistCamera()
      mapReadyRef.current = true
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
      if (maybeError.sourceId === 'googleHybrid') {
        return
      }
      // MapLibre can emit recoverable source/tile runtime errors.
      // Do not show fatal overlay once map has loaded successfully.
      if (mapReadyRef.current) {
        console.warn('MapLibre recoverable runtime warning:', maybeError)
        return
      }
      const errorMessage =
        typeof maybeError.error === 'object' &&
        maybeError.error &&
        'message' in (maybeError.error as Record<string, unknown>)
          ? String((maybeError.error as { message?: unknown }).message ?? '')
          : ''
      const lowered = errorMessage.toLowerCase()
      const severe =
        lowered.includes('webgl') ||
        lowered.includes('context') ||
        lowered.includes('failed to initialize')

      if (severe) {
        console.error('MapLibre fatal initialization error:', maybeError)
        setMapStatus('error')
      } else {
        console.warn('MapLibre non-fatal initialization warning:', maybeError)
      }
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
      mapReadyRef.current = false
      setMap(null)
    }
  }, [])

  return {
    containerRef,
    map,
    mapStatus,
  }
}

export { useBaseMap as useDroneMap }
