import { useEffect, useRef, useState } from 'react'
import maplibregl, {
  type Map,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapTargetDraft } from '../types/drone'

const osmStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-fade-duration': 0 },
    },
  ],
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
      style: osmStyle,
      center: [0, 0],
      zoom: 2,
      fadeDuration: 0,
    })

    mapRef.current = mapInstance
    setMap(mapInstance)
    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right')

    const handleClick = (event: MapMouseEvent) => {
      onTargetSelectRef.current({
        lat: event.lngLat.lat,
        lon: event.lngLat.lng,
      })
    }

    mapInstance.on('click', handleClick)

    return () => {
      mapInstance.off('click', handleClick)
      mapInstance.remove()
      mapRef.current = null
    }
  }, [])

  return {
    containerRef,
    map,
  }
}
