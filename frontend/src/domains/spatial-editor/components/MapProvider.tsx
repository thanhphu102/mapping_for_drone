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
  OSM_ATTRIBUTION,
  OSM_LAYER_ID,
  OSM_RASTER_MAX_ZOOM,
  OSM_SOURCE_ID,
  OSM_TILE_URL,
} from '../../map/baseMapModes'
import { createLogger } from '../../../shared/logging/logger'

const logger = createLogger('MapProvider')

// eslint-disable-next-line react-refresh/only-export-components
export function useMapContext() {
  return useContext(MapContext)
}

function createEditorStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      [OSM_SOURCE_ID]: {
        type: 'raster',
        tiles: [OSM_TILE_URL],
        tileSize: 256,
        maxzoom: OSM_RASTER_MAX_ZOOM,
        attribution: OSM_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: 'editor-background',
        type: 'background',
        paint: { 'background-color': '#e5e7eb' },
      },
      {
        id: OSM_LAYER_ID,
        type: 'raster',
        source: OSM_SOURCE_ID,
        paint: {
          'raster-opacity': 0.46,
          'raster-saturation': -0.5,
          'raster-brightness-min': 0.14,
          'raster-brightness-max': 0.96,
          'raster-resampling': 'linear',
        },
      },
    ],
  }
}

const spatialEditorMinZoom = 10
const spatialEditorMaxZoom = OSM_RASTER_MAX_ZOOM

interface MapContextValue {
  map: Map | null
  mapReady: boolean
  mapLoaded: boolean
  mapZoom: number
  containerRef: (node: HTMLDivElement | null) => void
}

const MapContext = createContext<MapContextValue>({
  map: null,
  mapReady: false,
  mapLoaded: false,
  mapZoom: 0,
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
        style: createEditorStyle(),
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
          logger.warn('map error:', maybeError.error ?? maybeError)
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
        containerRef,
      }}
    >
      {children}
    </MapContext.Provider>
  )
}
