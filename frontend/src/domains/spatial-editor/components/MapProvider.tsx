import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import maplibregl, { type Map } from 'maplibre-gl'
import {
  GOOGLE_HYBRID_LAYER_ID,
  GOOGLE_HYBRID_SOURCE_ID,
  GOOGLE_RASTER_MAX_ZOOM,
  GOOGLE_STREETS_LAYER_ID,
  GOOGLE_STREETS_SOURCE_ID,
  googleRasterTileScale,
  readStoredGoogleBaseMapMode,
  setGoogleBaseMapLayerVisibility,
  writeStoredGoogleBaseMapMode,
  type GoogleBaseMapMode,
} from '../../map/baseMapModes'

// eslint-disable-next-line react-refresh/only-export-components
export function useMapContext() {
  return useContext(MapContext)
}

function createEditorStyle(mode: GoogleBaseMapMode): maplibregl.StyleSpecification {
  const tileScale = googleRasterTileScale()

  return {
    version: 8,
    sources: {
      [GOOGLE_STREETS_SOURCE_ID]: {
        type: 'raster',
        tiles: [
          `/api/tiles/google/streets/{z}/{x}/{y}.png?scale=${tileScale}`,
        ],
        tileSize: 256,
        maxzoom: GOOGLE_RASTER_MAX_ZOOM,
        attribution: '&copy; <a href="https://www.google.com/maps">Google Maps</a>',
      },
      [GOOGLE_HYBRID_SOURCE_ID]: {
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
        id: 'editor-background',
        type: 'background',
        paint: { 'background-color': '#e5e7eb' },
      },
      {
        id: GOOGLE_STREETS_LAYER_ID,
        type: 'raster',
        source: GOOGLE_STREETS_SOURCE_ID,
        layout: {
          visibility: mode === 'map' ? 'visible' : 'none',
        },
        paint: {
          'raster-opacity': 0.46,
          'raster-saturation': -0.5,
          'raster-brightness-min': 0.14,
          'raster-brightness-max': 0.96,
          'raster-resampling': 'linear',
        },
      },
      {
        id: GOOGLE_HYBRID_LAYER_ID,
        type: 'raster',
        source: GOOGLE_HYBRID_SOURCE_ID,
        layout: {
          visibility: mode === 'satellite' ? 'visible' : 'none',
        },
        paint: {
          'raster-opacity': 0.42,
          'raster-saturation': -0.2,
          'raster-brightness-min': 0.12,
          'raster-brightness-max': 0.95,
          'raster-resampling': 'linear',
        },
      },
    ],
  }
}

const spatialEditorMinZoom = 10
const spatialEditorMaxZoom = GOOGLE_RASTER_MAX_ZOOM

interface MapContextValue {
  map: Map | null
  mapReady: boolean
  mapLoaded: boolean
  mapZoom: number
  baseMapMode: GoogleBaseMapMode
  setBaseMapMode: (mode: GoogleBaseMapMode) => void
  containerRef: (node: HTMLDivElement | null) => void
}

const MapContext = createContext<MapContextValue>({
  map: null,
  mapReady: false,
  mapLoaded: false,
  mapZoom: 0,
  baseMapMode: 'map',
  setBaseMapMode: () => { },
  containerRef: () => { },
})

interface MapProviderProps {
  children: ReactNode
}

export function MapProvider({ children }: MapProviderProps) {
  const mapInstanceRef = useRef<Map | null>(null)
  const containerNodeRef = useRef<HTMLDivElement | null>(null)
  const mapLoadedRef = useRef(false)
  const isMountedRef = useRef(true)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [mapInstance, setMapInstance] = useState<Map | null>(null)

  const [mapReady, setMapReady] = useState(false)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [mapZoom, setMapZoom] = useState(0)
  const [baseMapMode, setBaseMapMode] = useState<GoogleBaseMapMode>(
    readStoredGoogleBaseMapMode,
  )

  // Callback ref for the map container div
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node === containerNodeRef.current) {
      return
    }
    containerNodeRef.current = node

    // If there's already a map and the container changed, reattach is not
    // supported by MapLibre — the map instance stays on the original container.
    // We only create a new map if one doesn't exist yet.
    if (node && !mapInstanceRef.current) {
      const map = new maplibregl.Map({
        container: node,
        style: createEditorStyle(readStoredGoogleBaseMapMode()),
        center: [106.70098, 10.77689],
        zoom: 14,
        minZoom: spatialEditorMinZoom,
        maxZoom: spatialEditorMaxZoom,
        fadeDuration: 0,
        preserveDrawingBuffer: false,
        dragPan: false,
        scrollZoom: true,
        boxZoom: false,
        doubleClickZoom: false,
        touchZoomRotate: false,
        keyboard: false,
      })
      mapInstanceRef.current = map
      setMapInstance(map)

      const handleLoad = () => {
        mapLoadedRef.current = true
        map.resize()
        map.triggerRepaint()
        requestAnimationFrame(() => {
          map.resize()
          map.triggerRepaint()
        })
        window.setTimeout(() => {
          map.resize()
          map.triggerRepaint()
        }, 120)
        setMapLoaded(true)
        setMapReady(true)
        setMapZoom(map.getZoom())
      }

      const handleError = (event: unknown) => {
        const maybeError = event as { error?: unknown }
        if (isMountedRef.current) {
          console.warn('MapProvider map error:', maybeError.error ?? maybeError)
        }
      }

      const handleContextLost = (event: Event) => {
        event.preventDefault()
        mapLoadedRef.current = false
        if (isMountedRef.current) {
          setMapReady(false)
          setMapLoaded(false)
        }
      }

      const handleContextRestored = () => {
        if (!isMountedRef.current) {
          return
        }
        // Map will re-emit 'load' when ready
      }

      const handleViewChange = () => {
        if (isMountedRef.current) {
          setMapZoom(map.getZoom())
        }
      }

      map.on('load', handleLoad)
      map.on('error', handleError)
      map.on('move', handleViewChange)
      map.on('zoom', handleViewChange)
      map.getCanvas().addEventListener('webglcontextlost', handleContextLost)
      map.getCanvas().addEventListener('webglcontextrestored', handleContextRestored)

      resizeObserverRef.current = new ResizeObserver(() => {
        map.resize()
        map.triggerRepaint()
      })
      resizeObserverRef.current.observe(node)
    }
  }, [])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) {
      return
    }

    const applyBaseMapMode = () => {
      setGoogleBaseMapLayerVisibility(map, baseMapMode)
      writeStoredGoogleBaseMapMode(baseMapMode)
    }

    if (map.isStyleLoaded()) {
      applyBaseMapMode()
    } else {
      map.once('load', applyBaseMapMode)
    }

    return () => {
      map.off('load', applyBaseMapMode)
    }
  }, [baseMapMode])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      const map = mapInstanceRef.current
      if (map) {
        map.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  return (
    <MapContext.Provider
      value={{
        map: mapInstance,
        mapReady,
        mapLoaded,
        mapZoom,
        baseMapMode,
        setBaseMapMode,
        containerRef,
      }}
    >
      {children}
    </MapContext.Provider>
  )
}
