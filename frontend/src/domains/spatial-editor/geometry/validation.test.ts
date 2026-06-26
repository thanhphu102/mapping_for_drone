import { describe, expect, it } from 'vitest'
import type { Geometry, GeometryCollection, LineString, MultiPolygon, Point, Polygon } from 'geojson'
import { geometryInsideBoundaryStrict } from './validation'

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
]

const simpleBoundary: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [[square(0, 0, 10, 10)]],
}

const point = (coordinates: [number, number]): Point => ({ type: 'Point', coordinates })
const lineString = (coordinates: [number, number][]): LineString => ({ type: 'LineString', coordinates })
const polygon = (rings: [number, number][][]): Polygon => ({ type: 'Polygon', coordinates: rings })

describe('geometryInsideBoundaryStrict', () => {
  it('accepts a point inside the boundary', () => {
    expect(geometryInsideBoundaryStrict(point([5, 5]), simpleBoundary)).toBe(true)
  })

  it('rejects a point outside the boundary', () => {
    expect(geometryInsideBoundaryStrict(point([15, 15]), simpleBoundary)).toBe(false)
  })

  it('accepts a line fully inside the boundary', () => {
    expect(geometryInsideBoundaryStrict(lineString([[2, 2], [8, 8]]), simpleBoundary)).toBe(true)
  })

  it('rejects a line that exits the boundary', () => {
    expect(geometryInsideBoundaryStrict(lineString([[5, 5], [15, 5]]), simpleBoundary)).toBe(false)
  })

  it('accepts a line that runs exactly along the boundary edge (touch, not cross)', () => {
    expect(geometryInsideBoundaryStrict(lineString([[0, 0], [10, 0]]), simpleBoundary)).toBe(true)
  })

  it('accepts a polygon fully inside the boundary', () => {
    expect(geometryInsideBoundaryStrict(polygon([square(2, 2, 8, 8)]), simpleBoundary)).toBe(true)
  })

  it('rejects a polygon that partially overlaps the boundary edge', () => {
    expect(geometryInsideBoundaryStrict(polygon([square(5, 5, 15, 15)]), simpleBoundary)).toBe(false)
  })

  it('returns false for an empty GeometryCollection', () => {
    const empty: GeometryCollection = { type: 'GeometryCollection', geometries: [] }
    expect(geometryInsideBoundaryStrict(empty, simpleBoundary)).toBe(false)
  })

  it('rejects a geometry inside a boundary hole', () => {
    const boundaryWithHole: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [[square(0, 0, 20, 20), square(8, 8, 12, 12)]],
    }
    expect(geometryInsideBoundaryStrict(point([10, 10]), boundaryWithHole)).toBe(false)
  })

  it('rejects a line whose endpoints sit outside a hole but whose segment cuts through it', () => {
    const boundaryWithHole: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [[square(0, 0, 20, 20), square(8, 8, 12, 12)]],
    }
    // Both endpoints individually pass the inside-outer/outside-hole point check,
    // but the straight segment between them crosses both hole edges.
    expect(geometryInsideBoundaryStrict(lineString([[5, 10], [15, 10]]), boundaryWithHole)).toBe(false)
  })

  it('accepts geometry inside one polygon of a multi-part boundary', () => {
    const twoSquareBoundary: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [[square(0, 0, 10, 10)], [square(20, 20, 30, 30)]],
    }
    expect(geometryInsideBoundaryStrict(point([25, 25]), twoSquareBoundary)).toBe(true)
  })

  it('handles a GeometryCollection by requiring every child geometry to be inside', () => {
    const mixed: GeometryCollection = {
      type: 'GeometryCollection',
      geometries: [point([5, 5]) as Geometry, point([15, 15]) as Geometry],
    }
    expect(geometryInsideBoundaryStrict(mixed, simpleBoundary)).toBe(false)
  })
})
