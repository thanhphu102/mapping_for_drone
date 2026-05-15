import { useEffect, useRef, useState } from 'react'
import maplibregl, {
  type Map,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapTargetDraft } from '../types/drone'

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
      maxzoom: 19,
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

  useEffect(() => {
    onTargetSelectRef.current = onTargetSelect
  }, [onTargetSelect])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    const mapInstance = new maplibregl.Map({
      container: containerRef.current,
      style: rasterOsmStyle,
      center: [0, 0],
      zoom: 2,
      fadeDuration: 0,
    })

    const maplibreInfo = maplibregl as MapLibreWithSupport
    console.info('maplibre-gl version:', maplibreInfo.version)

    // Create a small debug overlay inside the map container to surface status
    let debugEl: HTMLDivElement | null = null
    if (containerRef.current) {
      debugEl = document.createElement('div')
      debugEl.style.position = 'absolute'
      debugEl.style.zIndex = '40'
      debugEl.style.top = '1rem'
      debugEl.style.right = '1rem'
      debugEl.style.padding = '0.5rem 0.75rem'
      debugEl.style.background = 'rgba(2,6,23,0.7)'
      debugEl.style.color = 'white'
      debugEl.style.borderRadius = '8px'
      debugEl.style.fontSize = '12px'
      debugEl.style.pointerEvents = 'none'
      debugEl.textContent = 'Map: creating...'
      containerRef.current.appendChild(debugEl)
    }

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

    // Log and show support status
    console.info('MapLibre supported (WebGL available):', webglSupported)
    if (debugEl) {
      debugEl.textContent = `Map: init (WebGL=${String(webglSupported)})`
    }

    // Ensure container and reasonable ancestors have height so map can render.
    // This is a targeted, conservative fix for environments where CSS utilities
    // result in a 0px height. We only set inline styles when computed height is 0.
    try {
      let el: HTMLElement | null = containerRef.current
      const stack: Array<{tag: string; h: number}> = []
      while (el && el !== document.body && el !== document.documentElement) {
        const rect = el.getBoundingClientRect()
        stack.push({ tag: el.tagName.toLowerCase(), h: Math.round(rect.height) })
        if (rect.height === 0) {
          // set a fallback height; prefer percentage so it stretches with layout
          el.style.minHeight = el.style.minHeight || '420px'
          el.style.height = el.style.height || '100%'
        }
        el = el.parentElement
      }
      console.info('Map container ancestor heights:', stack)
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
      mapInstance.resize()
      if (debugEl) {
        debugEl.textContent = 'Map: loaded'
      }
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
      if (debugEl) {
        debugEl.textContent = `Map: error ${String(maybeError?.error ?? maybeError)}`
      }
    }

    mapInstance.on('load', handleLoad)
    mapInstance.on('click', handleClick)
    mapInstance.on('error', handleError)
    window.addEventListener('resize', handleResize)
    canvas.addEventListener('webglcontextlost', handleWebGlContextLost)
    canvas.addEventListener('webglcontextrestored', handleWebGlContextRestored)

    return () => {
      mapInstance.off('load', handleLoad)
      mapInstance.off('click', handleClick)
      mapInstance.off('error', handleError)
      window.removeEventListener('resize', handleResize)
      canvas.removeEventListener('webglcontextlost', handleWebGlContextLost)
      canvas.removeEventListener('webglcontextrestored', handleWebGlContextRestored)
      mapInstance.remove()
      mapRef.current = null
    }
  }, [])

  return {
    containerRef,
    map,
  }
}
