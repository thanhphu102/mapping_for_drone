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

// eslint-disable-next-line react-refresh/only-export-components
export function useMapContext() {
  return useContext(MapContext)
}

const editorStyle: maplibregl.StyleSpecification = {
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
      id: 'editor-background',
      type: 'background',
      paint: { 'background-color': '#e5e7eb' },
    },
    {
      id: 'editor-osm-basemap',
      type: 'raster',
      source: 'osm',
      paint: {
        'raster-opacity': 0.28,
        'raster-saturation': -0.75,
        'raster-brightness-min': 0.18,
        'raster-brightness-max': 0.95,
      },
    },
  ],
}

const spatialEditorMinZoom = 10
const spatialEditorMaxZoom = 24

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
        style: editorStyle,
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
