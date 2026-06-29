import type { Geometry, Position } from 'geojson'
import type { DrawingProject } from '../spatial-editor/types'
import { isPointInPolygonWithHoles } from '../../shared/utils/geoUtils'

export const NO_FLY_ZONE_FEATURE_TYPE = 'no_fly_zone'
export const ALLOWED_ZONE_FEATURE_TYPE = 'allowed_zone'
export const ZONE_FEATURE_TYPES = [NO_FLY_ZONE_FEATURE_TYPE, ALLOWED_ZONE_FEATURE_TYPE] as const

export type ZoneFeatureType = (typeof ZONE_FEATURE_TYPES)[number]

export const NFZ_FILL_LAYER_ID = 'published-overlay-nfz-fill'
export const NFZ_LINE_LAYER_ID = 'published-overlay-nfz-line'
export const ALLOWED_FILL_LAYER_ID = 'published-overlay-allowed-fill'
export const ALLOWED_LINE_LAYER_ID = 'published-overlay-allowed-line'

/** A single polygon of a zone: an outer ring plus any carved-out holes. */
export interface ZonePolygon {
  outer: [number, number][]
  holes: [number, number][][]
}

/** An active geofence zone collected from the published overlay projects. */
export interface Zone {
  id: string
  type: ZoneFeatureType
  /** Polygons (`[lon, lat]` rings) — one for a Polygon, many for a MultiPolygon. */
  polygons: ZonePolygon[]
}

/** @deprecated retained for compatibility — use {@link Zone}. */
export type NoFlyZone = Zone

function isZoneFeatureType(value: unknown): value is ZoneFeatureType {
  return value === NO_FLY_ZONE_FEATURE_TYPE || value === ALLOWED_ZONE_FEATURE_TYPE
}

/** True for the standalone no-fly-zone projects created from the main map. */
export function isNoFlyZoneProject(project: DrawingProject): boolean {
  return project.kind === NO_FLY_ZONE_FEATURE_TYPE
}

/** True for the standalone allowed (inclusion) zone projects. */
export function isAllowedZoneProject(project: DrawingProject): boolean {
  return project.kind === ALLOWED_ZONE_FEATURE_TYPE
}

/** True for either kind of standalone geofence zone project. */
export function isZoneProject(project: DrawingProject): boolean {
  return isZoneFeatureType(project.kind)
}

/** The zone type of a project (`no_fly_zone` / `allowed_zone`), or null. */
export function zoneProjectType(project: DrawingProject): ZoneFeatureType | null {
  return isZoneFeatureType(project.kind) ? project.kind : null
}

function toRing(positions: Position[]): [number, number][] {
  return positions.map((position) => [position[0], position[1]] as [number, number])
}

function polygonToZonePolygon(rings: Position[][]): ZonePolygon | null {
  const outer = rings[0]
  if (!Array.isArray(outer) || outer.length === 0) {
    return null
  }
  return {
    outer: toRing(outer),
    holes: rings
      .slice(1)
      .filter((ring): ring is Position[] => Array.isArray(ring) && ring.length > 0)
      .map(toRing),
  }
}

/** Outer + hole rings for a Polygon/MultiPolygon geometry (`[lon, lat]`). */
export function extractPolygons(geometry: Geometry | null | undefined): ZonePolygon[] {
  if (!geometry) {
    return []
  }
  if (geometry.type === 'Polygon') {
    const polygon = polygonToZonePolygon(geometry.coordinates)
    return polygon ? [polygon] : []
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map(polygonToZonePolygon)
      .filter((polygon): polygon is ZonePolygon => polygon !== null)
  }
  return []
}

/**
 * The outer ring (`[lon, lat][]`) of a zone project — but only when the zone is
 * a single, simple Polygon with no holes, so it can be reshaped by dragging its
 * vertices. Collapsed zones (MultiPolygon or donut) return `null` and are
 * delete-only in the editor.
 */
export function zoneProjectRing(project: DrawingProject): [number, number][] | null {
  const feature = (project.publishedFeatures ?? []).find((item) =>
    isZoneFeatureType(item.properties?.featureType),
  )
  const geometry = feature?.geometry
  if (geometry?.type !== 'Polygon') {
    return null
  }
  const rings = geometry.coordinates
  // A simple zone has exactly one ring (the outer one); >1 means it has a hole.
  if (!rings || rings.length !== 1) {
    return null
  }
  const ring = rings[0]
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

/** @deprecated retained for compatibility — use {@link zoneProjectRing}. */
export const noFlyZoneProjectRing = zoneProjectRing

/**
 * Collect active zones of a given type from the published overlay projects.
 *
 * Floor logic: a global zone (`floorId == null`) always applies; a floor-specific
 * zone only applies when the drone is on that floor (the selected overlay floor).
 *
 * @param featureType Restrict to one zone type, or collect both when omitted.
 */
export function collectZones(
  projects: DrawingProject[],
  selectedFloorId: string | null,
  featureType?: ZoneFeatureType,
): Zone[] {
  const zones: Zone[] = []
  for (const project of projects) {
    for (const feature of project.publishedFeatures ?? []) {
      const type = feature.properties?.featureType
      if (!isZoneFeatureType(type)) {
        continue
      }
      if (featureType && type !== featureType) {
        continue
      }
      const rawFloorId = feature.floorId ?? feature.properties?.floorId
      const floorId = rawFloorId == null || rawFloorId === '' ? null : String(rawFloorId)
      if (floorId !== null && floorId !== selectedFloorId) {
        continue
      }
      const polygons = extractPolygons(feature.geometry)
      if (polygons.length === 0) {
        continue
      }
      zones.push({
        id: String(feature.id ?? `${project.id}:${zones.length}`),
        type,
        polygons,
      })
    }
  }
  return zones
}

/** Active no-fly zones from the published overlay projects. */
export function collectNoFlyZones(
  projects: DrawingProject[],
  selectedFloorId: string | null,
): Zone[] {
  return collectZones(projects, selectedFloorId, NO_FLY_ZONE_FEATURE_TYPE)
}

/** Active allowed (inclusion) zones from the published overlay projects. */
export function collectAllowedZones(
  projects: DrawingProject[],
  selectedFloorId: string | null,
): Zone[] {
  return collectZones(projects, selectedFloorId, ALLOWED_ZONE_FEATURE_TYPE)
}

/** True when `point` ([lon, lat]) falls inside a zone, respecting its holes. */
export function isPointInZone(point: [number, number], zone: Zone): boolean {
  return zone.polygons.some((polygon) =>
    isPointInPolygonWithHoles(point, polygon.outer, polygon.holes),
  )
}

/** True when `point` ([lon, lat]) falls inside any of the supplied no-fly zones. */
export function isPointInNoFlyZones(point: [number, number], zones: Zone[]): boolean {
  return zones.some((zone) => isPointInZone(point, zone))
}

/** True when `point` ([lon, lat]) falls inside at least one allowed zone. */
export function isInsideAnyAllowedZone(point: [number, number], zones: Zone[]): boolean {
  return zones.some((zone) => isPointInZone(point, zone))
}
