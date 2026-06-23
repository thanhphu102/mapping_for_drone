import type { Geometry, Position } from 'geojson'
import type { DrawingProject } from '../spatial-editor/types'
import { isPointInPolygon } from '../../shared/utils/geoUtils'

export const NO_FLY_ZONE_FEATURE_TYPE = 'no_fly_zone'

export interface NoFlyZone {
  id: string
  /** Outer rings (`[lon, lat][]`) for a Polygon, or one per MultiPolygon member. */
  rings: [number, number][][]
}

function toRing(positions: Position[]): [number, number][] {
  return positions.map((position) => [position[0], position[1]] as [number, number])
}

function extractOuterRings(geometry: Geometry | null | undefined): [number, number][][] {
  if (!geometry) {
    return []
  }
  if (geometry.type === 'Polygon') {
    const outer = geometry.coordinates[0]
    return outer && outer.length > 0 ? [toRing(outer)] : []
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((polygon) => polygon[0])
      .filter((ring): ring is Position[] => Array.isArray(ring) && ring.length > 0)
      .map(toRing)
  }
  return []
}

/**
 * Collect the active no-fly-zone polygons from the published overlay projects.
 *
 * Floor logic: a global zone (`floorId == null`) always applies; a floor-specific
 * zone only applies when the drone is on that floor (the selected overlay floor).
 */
export function collectNoFlyZones(
  projects: DrawingProject[],
  selectedFloorId: string | null,
): NoFlyZone[] {
  const zones: NoFlyZone[] = []
  for (const project of projects) {
    for (const feature of project.publishedFeatures ?? []) {
      if (feature.properties?.featureType !== NO_FLY_ZONE_FEATURE_TYPE) {
        continue
      }
      const rawFloorId = feature.floorId ?? feature.properties?.floorId
      const floorId = rawFloorId == null || rawFloorId === '' ? null : String(rawFloorId)
      if (floorId !== null && floorId !== selectedFloorId) {
        continue
      }
      const rings = extractOuterRings(feature.geometry)
      if (rings.length === 0) {
        continue
      }
      zones.push({
        id: String(feature.id ?? `${project.id}:${zones.length}`),
        rings,
      })
    }
  }
  return zones
}

/** True when `point` ([lon, lat]) falls inside any of the supplied no-fly zones. */
export function isPointInNoFlyZones(point: [number, number], zones: NoFlyZone[]): boolean {
  return zones.some((zone) => zone.rings.some((ring) => isPointInPolygon(point, ring)))
}
