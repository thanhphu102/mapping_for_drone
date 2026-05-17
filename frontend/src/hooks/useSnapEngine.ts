import { useEffect, useRef } from 'react'
import type { Feature, Position } from 'geojson'
import type { Map } from 'maplibre-gl'
import type { DrawingProject, ProjectCanvasConfig } from '../types/drone'

export interface SnapPreview {
  point: Position
  kind: 'vertex' | 'midpoint' | 'edge' | 'corridor_center' | 'door_center'
}

function samePosition(left: Position | null, right: Position | null) {
  if (!left || !right) return left === right
  return left[0] === right[0] && left[1] === right[1]
}

function sameSnap(left: SnapPreview | null, right: SnapPreview | null) {
  if (!left || !right) return left === right
  return left.kind === right.kind && samePosition(left.point, right.point)
}

function nearestPointOnSegment(
  map: Map,
  point: Position,
  start: Position,
  end: Position,
): { point: Position; distancePx: number } {
  const projectedPoint = map.project({ lng: point[0], lat: point[1] })
  const projectedStart = map.project({ lng: start[0], lat: start[1] })
  const projectedEnd = map.project({ lng: end[0], lat: end[1] })
  const dx = projectedEnd.x - projectedStart.x
  const dy = projectedEnd.y - projectedStart.y
  const lengthSquared = dx * dx + dy * dy || 1
  const t = Math.max(
    0,
    Math.min(
      1,
      ((projectedPoint.x - projectedStart.x) * dx + (projectedPoint.y - projectedStart.y) * dy) /
        lengthSquared,
    ),
  )
  const nearestX = projectedStart.x + t * dx
  const nearestY = projectedStart.y + t * dy
  const unprojected = map.unproject([nearestX, nearestY] as [number, number])
  return {
    point: [unprojected.lng, unprojected.lat],
    distancePx: Math.hypot(nearestX - projectedPoint.x, nearestY - projectedPoint.y),
  }
}

function boundaryFeature(project: DrawingProject): Feature {
  return {
    type: 'Feature',
    id: project.id,
    geometry: project.baseGeometry,
    properties: {
      projectId: project.id,
      name: project.name,
      locked: true,
    },
  }
}

interface UseSnapEngineOptions {
  map: Map | null
  project: DrawingProject | null
  projectConfig: ProjectCanvasConfig
  visibleFeatures: Feature[]
  toolsEnabled: boolean
  isMounted: () => boolean
  onSnapPreview: (snap: SnapPreview | null) => void
  onHoverCoordinate: (coord: Position) => void
}

export function useSnapEngine({
  map,
  project,
  projectConfig,
  visibleFeatures,
  toolsEnabled,
  isMounted,
  onSnapPreview,
  onHoverCoordinate,
}: UseSnapEngineOptions) {
  const projectRef = useRef(project)
  const visibleFeaturesRef = useRef(visibleFeatures)
  const toolsEnabledRef = useRef(toolsEnabled)
  const pendingPointerRef = useRef<Position | null>(null)
  const frameRef = useRef<number | null>(null)
  const lastHoverRef = useRef<Position | null>(null)
  const lastSnapRef = useRef<SnapPreview | null>(null)

  useEffect(() => {
    projectRef.current = project
  }, [project])

  useEffect(() => {
    visibleFeaturesRef.current = visibleFeatures
  }, [visibleFeatures])

  useEffect(() => {
    toolsEnabledRef.current = toolsEnabled
  }, [toolsEnabled])

  useEffect(() => {
    if (!map) {
      return
    }

    const publishHover = (point: Position) => {
      if (!isMounted()) return
      if (samePosition(lastHoverRef.current, point)) return
      lastHoverRef.current = point
      onHoverCoordinate(point)
    }

    const publishSnap = (snap: SnapPreview | null) => {
      if (!isMounted()) return
      if (sameSnap(lastSnapRef.current, snap)) return
      lastSnapRef.current = snap
      onSnapPreview(snap)
    }

    const processPointer = () => {
      frameRef.current = null
      const pointer = pendingPointerRef.current
      if (!pointer) {
        return
      }
      publishHover(pointer)

      const snappingConfig = projectRef.current?.config?.snapping
      if (!toolsEnabledRef.current || !snappingConfig?.enabled) {
        publishSnap(null)
        return
      }

      const currentProject = projectRef.current
      if (!currentProject) {
        return
      }
      const config = currentProject.config
      const mapZoomNow = map.getZoom()
      const snapDistancePx = config?.snapping.distancePx ?? projectConfig.snapping.distancePx
      let bestSnap: SnapPreview | null = null
      let bestDistance = Number.POSITIVE_INFINITY
      const currentPoint: Position = pointer
      const candidates = [...visibleFeaturesRef.current, boundaryFeature(currentProject)]

      for (const feature of candidates) {
        const geometry = feature.geometry
        const lines: Position[][] = []
        if (geometry.type === 'Point') {
          lines.push([geometry.coordinates])
        } else if (geometry.type === 'LineString') {
          lines.push(geometry.coordinates)
        } else if (geometry.type === 'Polygon') {
          lines.push(...geometry.coordinates)
        } else if (geometry.type === 'MultiPolygon') {
          for (const polygon of geometry.coordinates) {
            lines.push(...polygon)
          }
        }
        for (const line of lines) {
          for (let index = 0; index < line.length; index += 1) {
            const vertex = line[index]
            const vertexPx = map.project({ lng: vertex[0], lat: vertex[1] })
            const cursorPx = map.project({ lng: currentPoint[0], lat: currentPoint[1] })
            const vertexDistance = Math.hypot(vertexPx.x - cursorPx.x, vertexPx.y - cursorPx.y)
            if (config?.snapping.vertex && vertexDistance < bestDistance && vertexDistance <= snapDistancePx) {
              bestDistance = vertexDistance
              bestSnap = { point: vertex, kind: 'vertex' }
            }
            if (config?.snapping.midpoint && index > 0) {
              const prev = line[index - 1]
              const midpoint: Position = [(prev[0] + vertex[0]) / 2, (prev[1] + vertex[1]) / 2]
              const midpointPx = map.project({ lng: midpoint[0], lat: midpoint[1] })
              const midpointDistance = Math.hypot(midpointPx.x - cursorPx.x, midpointPx.y - cursorPx.y)
              if (midpointDistance < bestDistance && midpointDistance <= snapDistancePx) {
                bestDistance = midpointDistance
                bestSnap = { point: midpoint, kind: 'midpoint' }
              }
            }
            if (config?.snapping.edge && index > 0 && mapZoomNow >= (config?.detailZoom ?? 18)) {
              const edgeSnap = nearestPointOnSegment(map, currentPoint, line[index - 1], vertex)
              if (edgeSnap.distancePx < bestDistance && edgeSnap.distancePx <= snapDistancePx) {
                bestDistance = edgeSnap.distancePx
                bestSnap = { point: edgeSnap.point, kind: 'edge' }
              }
            }
          }
        }

        // --- Indoor snapping: corridor center, door center ---
        const featureType = feature.properties?.featureType as string | undefined
        if (featureType === 'corridor' && geometry.type === 'Polygon') {
          // Snap to centroid of corridor polygon
          const ring = geometry.coordinates[0]
          if (ring.length >= 4) {
            const centroid: Position = [
              ring.reduce((sum, p) => sum + p[0], 0) / ring.length,
              ring.reduce((sum, p) => sum + p[1], 0) / ring.length,
            ]
            const centroidPx = map.project({ lng: centroid[0], lat: centroid[1] })
            const cursorPxLocal = map.project({ lng: currentPoint[0], lat: currentPoint[1] })
            const centroidDist = Math.hypot(centroidPx.x - cursorPxLocal.x, centroidPx.y - cursorPxLocal.y)
            if (centroidDist < bestDistance && centroidDist <= snapDistancePx * 1.5) {
              bestDistance = centroidDist
              bestSnap = { point: centroid, kind: 'corridor_center' }
            }
          }
        }
        if (featureType === 'door' && geometry.type === 'Point') {
          const doorPoint = geometry.coordinates
          const doorPx = map.project({ lng: doorPoint[0], lat: doorPoint[1] })
          const cursorPxLocal = map.project({ lng: currentPoint[0], lat: currentPoint[1] })
          const doorDist = Math.hypot(doorPx.x - cursorPxLocal.x, doorPx.y - cursorPxLocal.y)
          if (doorDist < bestDistance && doorDist <= snapDistancePx * 1.5) {
            bestDistance = doorDist
            bestSnap = { point: doorPoint, kind: 'door_center' }
          }
        }
      }
      publishSnap(bestSnap)
    }

    const scheduleProcess = () => {
      if (frameRef.current !== null) {
        return
      }
      frameRef.current = window.requestAnimationFrame(processPointer)
    }

    const handleMouseMove = (event: { lngLat: { lng: number; lat: number } }) => {
      pendingPointerRef.current = [event.lngLat.lng, event.lngLat.lat]
      scheduleProcess()
    }

    map.on('mousemove', handleMouseMove)
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      map.off('mousemove', handleMouseMove)
    }
  }, [map, isMounted, onSnapPreview, onHoverCoordinate, projectConfig.snapping.distancePx])
}
