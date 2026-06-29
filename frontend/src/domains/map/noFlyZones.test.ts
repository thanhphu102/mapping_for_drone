import { describe, expect, it } from 'vitest'
import type { Geometry } from 'geojson'
import type { DrawingProject, SpatialFeature } from '../spatial-editor/types'
import {
  ALLOWED_ZONE_FEATURE_TYPE,
  collectAllowedZones,
  collectNoFlyZones,
  extractPolygons,
  isInsideAnyAllowedZone,
  isPointInNoFlyZones,
  NO_FLY_ZONE_FEATURE_TYPE,
  zoneProjectRing,
  type ZoneFeatureType,
} from './noFlyZones'

const outerRing = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
]
const holeRing = [
  [4, 4],
  [6, 4],
  [6, 6],
  [4, 6],
  [4, 4],
]

function zoneProject(
  type: ZoneFeatureType,
  geometry: Geometry,
  floorId: string | null = null,
): DrawingProject {
  const feature: SpatialFeature = {
    type: 'Feature',
    id: `${type}-feature`,
    geometry,
    floorId,
    properties: { featureType: type, floorId },
  }
  return {
    id: `${type}-project`,
    kind: type,
    publishedFeatures: [feature],
  } as unknown as DrawingProject
}

describe('extractPolygons', () => {
  it('keeps holes for a Polygon geometry', () => {
    const polygons = extractPolygons({ type: 'Polygon', coordinates: [outerRing, holeRing] })
    expect(polygons).toHaveLength(1)
    expect(polygons[0].holes).toHaveLength(1)
  })

  it('returns one entry per part for a MultiPolygon', () => {
    const polygons = extractPolygons({
      type: 'MultiPolygon',
      coordinates: [[outerRing], [[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]]],
    })
    expect(polygons).toHaveLength(2)
  })

  it('returns [] for non-polygonal geometry', () => {
    expect(extractPolygons({ type: 'Point', coordinates: [0, 0] })).toEqual([])
  })
})

describe('collectZones', () => {
  it('filters by feature type', () => {
    const projects = [
      zoneProject(NO_FLY_ZONE_FEATURE_TYPE, { type: 'Polygon', coordinates: [outerRing] }),
      zoneProject(ALLOWED_ZONE_FEATURE_TYPE, { type: 'Polygon', coordinates: [outerRing] }),
    ]
    expect(collectNoFlyZones(projects, null)).toHaveLength(1)
    expect(collectNoFlyZones(projects, null)[0].type).toBe(NO_FLY_ZONE_FEATURE_TYPE)
    expect(collectAllowedZones(projects, null)).toHaveLength(1)
    expect(collectAllowedZones(projects, null)[0].type).toBe(ALLOWED_ZONE_FEATURE_TYPE)
  })

  it('drops floor-specific zones when the drone is on another floor', () => {
    const projects = [
      zoneProject(NO_FLY_ZONE_FEATURE_TYPE, { type: 'Polygon', coordinates: [outerRing] }, 'floor-2'),
    ]
    expect(collectNoFlyZones(projects, 'floor-1')).toHaveLength(0)
    expect(collectNoFlyZones(projects, 'floor-2')).toHaveLength(1)
  })
})

describe('zone membership respects holes', () => {
  it('treats the hole of a donut no-fly zone as outside', () => {
    const donut = zoneProject(NO_FLY_ZONE_FEATURE_TYPE, {
      type: 'Polygon',
      coordinates: [outerRing, holeRing],
    })
    const zones = collectNoFlyZones([donut], null)
    expect(isPointInNoFlyZones([1, 1], zones)).toBe(true) // in the ring
    expect(isPointInNoFlyZones([5, 5], zones)).toBe(false) // in the hole
  })

  it('treats the hole of an allowed zone as not allowed', () => {
    const donut = zoneProject(ALLOWED_ZONE_FEATURE_TYPE, {
      type: 'Polygon',
      coordinates: [outerRing, holeRing],
    })
    const zones = collectAllowedZones([donut], null)
    expect(isInsideAnyAllowedZone([1, 1], zones)).toBe(true)
    expect(isInsideAnyAllowedZone([5, 5], zones)).toBe(false)
  })
})

describe('zoneProjectRing', () => {
  it('returns the outer ring for a simple single Polygon', () => {
    const project = zoneProject(NO_FLY_ZONE_FEATURE_TYPE, { type: 'Polygon', coordinates: [outerRing] })
    const ring = zoneProjectRing(project)
    expect(ring).not.toBeNull()
    // Closing vertex dropped -> 4 distinct corners.
    expect(ring).toHaveLength(4)
  })

  it('returns null for a Polygon with a hole (delete-only)', () => {
    const project = zoneProject(NO_FLY_ZONE_FEATURE_TYPE, {
      type: 'Polygon',
      coordinates: [outerRing, holeRing],
    })
    expect(zoneProjectRing(project)).toBeNull()
  })

  it('returns null for a MultiPolygon (delete-only)', () => {
    const project = zoneProject(NO_FLY_ZONE_FEATURE_TYPE, {
      type: 'MultiPolygon',
      coordinates: [[outerRing]],
    })
    expect(zoneProjectRing(project)).toBeNull()
  })
})
