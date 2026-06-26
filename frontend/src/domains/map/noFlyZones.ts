import type { Geometry, Position } from 'geojson'
import type { DrawingProject } from '../spatial-editor/types'
import { isPointInPolygon } from '../../shared/utils/geoUtils'

export const NO_FLY_ZONE_FEATURE_TYPE = 'no_fly_zone'
export const NFZ_FILL_LAYER_ID = 'published-overlay-nfz-fill'
export const NFZ_LINE_LAYER_ID = 'published-overlay-nfz-line'

export interface NoFlyZone {
  id: string
  /** Outer rings (`[lon, lat][]`) for a Polygon, or one per MultiPolygon member. */
  rings: [number, number][][]
}

/** True for the standalone no-fly-zone projects created from the main map. */
export function isNoFlyZoneProject(project: DrawingProject): boolean {
  return project.kind === NO_FLY_ZONE_FEATURE_TYPE
}

/** The outer ring ([lon, lat][]) of a no-fly-zone project's polygon, if any. */
export function noFlyZoneProjectRing(project: DrawingProject): [number, number][] | null {
  const feature = (project.publishedFeatures ?? []).find(
    (item) => item.properties?.featureType === NO_FLY_ZONE_FEATURE_TYPE,
  )
  const geometry = feature?.geometry
  if (geometry?.type !== 'Polygon') {
    return null
  }
  const ring = geometry.coordinates[0]
  if (!ring || ring.length === 0) {
    return null
  }
  const points = ring.map((p) => [p[0], p[1]] as [number, number])
  // Drop the duplicate closing vertex so each corner maps to one drag handle.
  const first = points[0]
  const last = points[points.length - 1]
  if (points.length > 1 && first[0] === last[0] && first[1] === last[1]) {
    points.pop()
  }
  return points
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
