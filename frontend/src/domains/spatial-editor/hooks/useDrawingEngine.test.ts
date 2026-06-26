import { describe, expect, it } from 'vitest'
import type { Feature, FeatureCollection, LineString, Point, Polygon, Position } from 'geojson'
import type { Map } from 'maplibre-gl'
import type { DrawingProject } from '../types'
import {
  draftToFeatures,
  featureInsideBoundary,
  featureMeasurement,
  featureTypeForMode,
  featureTypeGeometry,
  localCoordinates,
  pointInBoundary,
  rotateFeatureGeometry,
  translateFeatureGeometry,
} from './useDrawingEngine'

/**
 * Characterization tests for the pure/near-pure exports of useDrawingEngine.ts.
 *
 * Scope decision: this file does NOT attempt renderHook-style tests of the
 * `useDrawingEngine` hook body itself (lines ~423-1262). That body is almost
 * entirely (a) State-to-Ref sync effects that the planned `useLatest` helper
 * will eliminate outright, and (b) MapLibre mouse/keyboard event handlers with
 * no return value, whose behavior can only be observed by simulating map
 * events against a heavy MapLibre mock (event registration, layer/source
 * management, canvas). That is a materially larger, separate effort with a
 * different risk profile than unit-testing pure functions, and is better
 * scoped on its own immediately before the Phase 3 decomposition of this file
 * (where the spec to characterize against is clearest).
 *
 * What IS covered here is exactly the logic Phase 3 plans to extract into
 * "preview geometry" / "commit" modules: draftToFeatures, the rotate/translate
 * geometry helpers, measurement formatting, and the boundary-containment
 * checks shared with geometry/validation.ts.
 */

// A minimal MapLibre Map test double: a simple invertible linear scale
// (no real Web Mercator math needed — the production code only relies on
// project/unproject being mutually consistent and on relative pixel
// distances for tolerance checks).
type LngLatLike = [number, number] | { lng: number; lat: number }

function toLngLatTuple(value: LngLatLike): [number, number] {
  return Array.isArray(value) ? value : [value.lng, value.lat]
}

function makeFakeMap(scale = 100): Map {
  return {
    project: (value: LngLatLike) => {
      const [lng, lat] = toLngLatTuple(value)
      return { x: lng * scale, y: lat * scale }
    },
    unproject: ([x, y]: [number, number]) => ({ lng: x / scale, lat: y / scale }),
  } as unknown as Map
}

const square = (x0: number, y0: number, x1: number, y1: number): Position[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
]

describe('pointInBoundary', () => {
  const map = makeFakeMap()
  const project = (coordinates: Position[][]): DrawingProject =>
    ({ baseGeometry: { type: 'MultiPolygon', coordinates: [coordinates] } }) as DrawingProject

  it('returns false when no map is available', () => {
    expect(pointInBoundary([5, 5], project([square(0, 0, 10, 10)]), null)).toBe(false)
  })

  it('accepts a point inside the boundary', () => {
    expect(pointInBoundary([5, 5], project([square(0, 0, 10, 10)]), map)).toBe(true)
  })

  it('rejects a point outside the boundary', () => {
    expect(pointInBoundary([15, 15], project([square(0, 0, 10, 10)]), map)).toBe(false)
  })

  it('accepts a point exactly on the boundary edge', () => {
    expect(pointInBoundary([5, 0], project([square(0, 0, 10, 10)]), map)).toBe(true)
  })

  it('rejects a point inside a hole', () => {
    const withHole = project([square(0, 0, 20, 20), square(8, 8, 12, 12)])
    expect(pointInBoundary([10, 10], withHole, map)).toBe(false)
  })
})

describe('featureInsideBoundary', () => {
  const map = makeFakeMap()
  const project: DrawingProject = {
    baseGeometry: { type: 'MultiPolygon', coordinates: [[square(0, 0, 10, 10)]] },
  } as DrawingProject

  it('returns false for a feature with no geometry', () => {
    const feature = { type: 'Feature', geometry: null, properties: {} } as unknown as Feature
    expect(featureInsideBoundary(feature, project, map)).toBe(false)
  })

  it('accepts a feature fully inside the boundary', () => {
    const feature: Feature<Point> = { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 5] }, properties: {} }
    expect(featureInsideBoundary(feature, project, map)).toBe(true)
  })

  it('rejects a feature with any vertex outside the boundary', () => {
    const feature: Feature<LineString> = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[5, 5], [15, 15]] },
      properties: {},
    }
    expect(featureInsideBoundary(feature, project, map)).toBe(false)
  })
})

describe('featureTypeGeometry', () => {
  it('maps representative feature types to their draw mode', () => {
    expect(featureTypeGeometry.flight_zone).toBe('polygon')
    expect(featureTypeGeometry.waypoint).toBe('point')
    expect(featureTypeGeometry.road).toBe('line')
    expect(featureTypeGeometry.text_label).toBe('text')
    expect(featureTypeGeometry.pen_path).toBe('pen')
    expect(featureTypeGeometry.room).toBe('polygon')
    expect(featureTypeGeometry.door).toBe('line')
  })
})

describe('featureTypeForMode', () => {
  it('maps each draw mode to its persisted feature type', () => {
    expect(featureTypeForMode('room')).toBe('room')
    expect(featureTypeForMode('wall')).toBe('wall')
    expect(featureTypeForMode('door')).toBe('door')
    expect(featureTypeForMode('corridor')).toBe('corridor')
    expect(featureTypeForMode('indoor_route')).toBe('indoor_route')
    expect(featureTypeForMode('line')).toBe('custom_line')
    expect(featureTypeForMode('polygon')).toBe('custom_area')
    expect(featureTypeForMode('rectangle')).toBe('custom_area')
    expect(featureTypeForMode('ellipse')).toBe('custom_area')
    expect(featureTypeForMode('square')).toBe('custom_area')
    expect(featureTypeForMode('triangle')).toBe('custom_area')
    expect(featureTypeForMode('point')).toBe('custom_point')
    expect(featureTypeForMode('text')).toBe('text_label')
    expect(featureTypeForMode('pen')).toBe('pen_path')
    expect(featureTypeForMode('delete_lasso')).toBe('custom_area')
  })

  it('falls back to custom_area for modes with no dedicated feature type', () => {
    expect(featureTypeForMode('select')).toBe('custom_area')
    expect(featureTypeForMode('move')).toBe('custom_area')
  })
})

describe('localCoordinates', () => {
  it('returns zero for the origin point itself', () => {
    expect(localCoordinates([10, 20], [10, 20])).toEqual({ x: 0, y: 0 })
  })

  it('converts a pure longitude delta at the equator using the equatorial meters-per-degree constant', () => {
    const result = localCoordinates([1, 0], [0, 0])
    expect(result.x).toBeCloseTo(111_320, 0)
    expect(result.y).toBeCloseTo(0, 6)
  })

  it('converts a pure latitude delta using the fixed meters-per-degree-latitude constant', () => {
    const result = localCoordinates([0, 1], [0, 0])
    expect(result.x).toBeCloseTo(0, 6)
    expect(result.y).toBeCloseTo(110_540, 0)
  })

  it('scales the longitude conversion by cos(mean latitude)', () => {
    const point: Position = [1, 60]
    const origin: Position = [0, 60]
    const result = localCoordinates(point, origin)
    const expectedX = 111_320 * Math.cos((60 * Math.PI) / 180) * 1
    expect(result.x).toBeCloseTo(expectedX, 3)
  })
})

describe('translateFeatureGeometry', () => {
  it('shifts a Point feature by the given delta', () => {
    const feature: Feature<Point> = { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }
    const translated = translateFeatureGeometry(feature, 0.5, -0.5)
    expect((translated.geometry as Point).coordinates).toEqual([1.5, 1.5])
  })

  it('shifts every vertex of a Polygon feature', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [square(0, 0, 2, 2)] },
      properties: {},
    }
    const translated = translateFeatureGeometry(feature, 1, 1)
    expect((translated.geometry as Polygon).coordinates).toEqual([square(1, 1, 3, 3)])
  })

  it('does not mutate the original feature', () => {
    const feature: Feature<Point> = { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }
    translateFeatureGeometry(feature, 5, 5)
    expect((feature.geometry as Point).coordinates).toEqual([1, 2])
  })
})

describe('rotateFeatureGeometry', () => {
  it('leaves a Point feature unchanged (its centroid is itself)', () => {
    const feature: Feature<Point> = { type: 'Feature', geometry: { type: 'Point', coordinates: [3, 4] }, properties: {} }
    const rotated = rotateFeatureGeometry(feature, 37)
    expect((rotated.geometry as Point).coordinates[0]).toBeCloseTo(3, 9)
    expect((rotated.geometry as Point).coordinates[1]).toBeCloseTo(4, 9)
  })

  it('returns the feature unchanged when the geometry has no positions', () => {
    const feature = {
      type: 'Feature',
      geometry: { type: 'GeometryCollection', geometries: [] },
      properties: {},
    } as unknown as Feature
    expect(rotateFeatureGeometry(feature, 90)).toBe(feature)
  })

  it('rotates a two-point LineString 180 degrees around its midpoint', () => {
    const feature: Feature<LineString> = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[1, 0], [3, 0]] },
      properties: {},
    }
    const rotated = rotateFeatureGeometry(feature, 180)
    const coords = (rotated.geometry as LineString).coordinates
    expect(coords[0][0]).toBeCloseTo(3, 6)
    expect(coords[0][1]).toBeCloseTo(0, 6)
    expect(coords[1][0]).toBeCloseTo(1, 6)
    expect(coords[1][1]).toBeCloseTo(0, 6)
  })
})

describe('featureMeasurement', () => {
  it('returns the no-draft message for null', () => {
    expect(featureMeasurement(null)).toBe('No draft feature')
  })

  it('returns the no-draft message for an empty collection', () => {
    expect(featureMeasurement({ type: 'FeatureCollection', features: [] })).toBe('No draft feature')
  })

  it('formats a Point feature as "lat, lng" to six decimals', () => {
    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [10.123456789, 20.987654321] }, properties: {} }],
    }
    expect(featureMeasurement(collection)).toBe('20.987654, 10.123457')
  })

  it('formats a short LineString length in centimeters', () => {
    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [0, 0.000003]] }, properties: {} }],
    }
    expect(featureMeasurement(collection)).toMatch(/^Length \d+ cm$/)
  })

  it('formats a multi-hundred-meter LineString length in meters', () => {
    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [0, 0.001]] }, properties: {} }],
    }
    expect(featureMeasurement(collection)).toMatch(/^Length \d+\.\d m$/)
  })

  it('formats a multi-kilometer LineString length in kilometers', () => {
    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [0, 0.02]] }, properties: {} }],
    }
    expect(featureMeasurement(collection)).toMatch(/^Length \d+\.\d{2} km$/)
  })

  it('formats Polygon area and perimeter together', () => {
    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [square(0, 0, 0.001, 0.001)] }, properties: {} }],
    }
    expect(featureMeasurement(collection)).toMatch(/^Area \d+\.\d m² · Perimeter \d+\.\d m$/)
  })

  it('skips draft-vertex marker features and measures the real draft feature', () => {
    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [[0, 0], [0, 0.001]] }, properties: { isDraftVertex: true } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [0, 0.001]] }, properties: {} },
      ],
    }
    expect(featureMeasurement(collection)).toMatch(/^Length /)
  })

  it('returns the unsupported-geometry message when only a MultiPoint is present', () => {
    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [[0, 0]] }, properties: { isDraftVertex: true } }],
    }
    expect(featureMeasurement(collection)).toBe('Unsupported geometry')
  })
})

describe('draftToFeatures', () => {
  it('returns null when there are no points yet', () => {
    expect(draftToFeatures('polygon', [], 'custom_area', null)).toBeNull()
  })

  it('builds a draft-vertex marker plus a Point feature for point mode', () => {
    const result = draftToFeatures('point', [[1, 2]], 'custom_point', null)
    expect(result?.features).toHaveLength(2)
    expect(result?.features[0].geometry).toEqual({ type: 'MultiPoint', coordinates: [[1, 2]] })
    expect(result?.features[1].geometry).toEqual({ type: 'Point', coordinates: [1, 2] })
  })

  it('appends the hover coordinate as a live preview point for line mode', () => {
    const result = draftToFeatures('line', [[0, 0], [1, 1]], 'custom_line', [2, 2])
    const line = result?.features.find((f) => f.geometry.type === 'LineString')
    expect((line?.geometry as LineString).coordinates).toEqual([[0, 0], [1, 1], [2, 2]])
    // The draft-vertex marker tracks only the committed points, not the hover preview.
    const marker = result?.features.find((f) => f.geometry.type === 'MultiPoint')
    expect(marker?.geometry).toEqual({ type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] })
  })

  it('closes a polygon ring once there are at least 3 points', () => {
    const points: Position[] = [[0, 0], [1, 0], [1, 1]]
    const result = draftToFeatures('polygon', points, 'custom_area', null)
    const polygon = result?.features.find((f) => f.geometry.type === 'Polygon')
    expect((polygon?.geometry as Polygon).coordinates).toEqual([[...points, points[0]]])
  })

  it('falls back to a LineString preview for a polygon with only 2 points', () => {
    const result = draftToFeatures('polygon', [[0, 0], [1, 1]], 'custom_area', null)
    const line = result?.features.find((f) => f.geometry.type === 'LineString')
    expect(line).toBeDefined()
    expect(result?.features.some((f) => f.geometry.type === 'Polygon')).toBe(false)
  })

  it('builds an axis-aligned rectangle ring without a map', () => {
    const result = draftToFeatures('rectangle', [[0, 0], [2, 3]], 'custom_area', null, null)
    const polygon = result?.features.find((f) => f.geometry.type === 'Polygon')
    expect((polygon?.geometry as Polygon).coordinates).toEqual([square(0, 0, 2, 3)])
  })

  it('builds a rectangle ring via map projection when a map is supplied', () => {
    const map = makeFakeMap()
    const result = draftToFeatures('rectangle', [[0, 0], [2, 3]], 'custom_area', null, map)
    const polygon = result?.features.find((f) => f.geometry.type === 'Polygon')
    expect((polygon?.geometry as Polygon).coordinates).toEqual([square(0, 0, 2, 3)])
  })

  it('forces equal sides for square mode and omits the draft-vertex marker', () => {
    const result = draftToFeatures('square', [[0, 0], [3, 1]], 'custom_area', null, null)
    expect(result?.features).toHaveLength(1)
    const polygon = result?.features[0]
    expect(polygon?.geometry.type).toBe('Polygon')
    expect((polygon?.geometry as Polygon).coordinates).toEqual([[[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]]])
  })

  it('builds a triangle from the bounding box of the two drag points', () => {
    const result = draftToFeatures('triangle', [[0, 0], [4, 2]], 'custom_area', null)
    const polygon = result?.features.find((f) => f.geometry.type === 'Polygon')
    expect((polygon?.geometry as Polygon).coordinates).toEqual([[[2, 0], [4, 2], [0, 2], [2, 0]]])
  })

  it('builds a delete-lasso bounding box', () => {
    const result = draftToFeatures('delete_lasso', [[0, 0], [5, 5]], 'custom_area', null)
    expect(result?.features).toHaveLength(2)
    const polygon = result?.features.find((f) => f.geometry.type === 'Polygon')
    expect((polygon?.geometry as Polygon).coordinates).toEqual([square(0, 0, 5, 5)])
  })

  it('approximates a circle (40-segment ring) when boxShapeVariant is explicitly circle', () => {
    const result = draftToFeatures('rectangle', [[0, 0], [2, 0]], 'custom_area', null, null, 'circle')
    const polygon = result?.features.find((f) => f.geometry.type === 'Polygon')
    const ring = (polygon?.geometry as Polygon).coordinates[0]
    expect(ring).toHaveLength(41)
    // Closes back to its start point.
    expect(ring[0][0]).toBeCloseTo(ring[40][0], 6)
    expect(ring[0][1]).toBeCloseTo(ring[40][1], 6)
    // Quarter-turn point sits directly "above" the center (center=[1,0], radius=1).
    expect(ring[10][0]).toBeCloseTo(1, 6)
    expect(ring[10][1]).toBeCloseTo(1, 6)
  })

  it('uses elliptical (non-uniform) radii along each axis when a map is supplied for ellipse mode', () => {
    const map = makeFakeMap()
    const result = draftToFeatures('ellipse', [[0, 0], [4, 2]], 'custom_area', null, map)
    const polygon = result?.features.find((f) => f.geometry.type === 'Polygon')
    const ring = (polygon?.geometry as Polygon).coordinates[0]
    // center=[2,1], radiusLng=2, radiusLat=1 — the rightmost point sits at lng=4, lat=1.
    const rightmost = ring.reduce((max, p) => (p[0] > max[0] ? p : max))
    expect(rightmost[0]).toBeCloseTo(4, 6)
    expect(rightmost[1]).toBeCloseTo(1, 6)
  })

  it('builds a rectangular text-box preview for text mode', () => {
    const result = draftToFeatures('text', [[0, 0], [3, 1]], 'text_label', null)
    const polygon = result?.features.find((f) => f.geometry.type === 'Polygon')
    expect((polygon?.geometry as Polygon).coordinates).toEqual([square(0, 0, 3, 1)])
  })
})
