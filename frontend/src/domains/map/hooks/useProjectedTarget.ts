import { useEffect, useState } from 'react'
import type { Map } from 'maplibre-gl'
import type { CommandTarget } from '../../drone/types'

export interface ProjectedPoint {
  x: number
  y: number
}

export function useProjectedTarget(map: Map | null, target: CommandTarget | null) {
  const [point, setPoint] = useState<ProjectedPoint | null>(null)

  useEffect(() => {
    if (!map || !target) {
      return
    }

    const updatePoint = () => {
      const projected = map.project([target.lon, target.lat])
      setPoint({
        x: projected.x,
        y: projected.y,
      })
    }

    updatePoint()
    map.on('move', updatePoint)
    map.on('zoom', updatePoint)

    return () => {
      map.off('move', updatePoint)
      map.off('zoom', updatePoint)
    }
  }, [map, target])

  return point
}
