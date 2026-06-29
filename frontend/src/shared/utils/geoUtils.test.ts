import { describe, expect, it } from 'vitest'
import { isPointInPolygon, isPointInPolygonWithHoles } from './geoUtils'

const square: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]

const innerHole: [number, number][] = [
  [4, 4],
  [6, 4],
  [6, 6],
  [4, 6],
]

describe('isPointInPolygon', () => {
  it('returns true for a point inside the polygon', () => {
    expect(isPointInPolygon([5, 5], square)).toBe(true)
  })

  it('returns false for a point outside the polygon', () => {
    expect(isPointInPolygon([15, 15], square)).toBe(false)
  })

  it('tolerates a closed ring (first vertex repeated as last)', () => {
    const closed = [...square, square[0]]
    expect(isPointInPolygon([5, 5], closed)).toBe(true)
  })

  it('returns false when the polygon has fewer than 3 vertices', () => {
    expect(isPointInPolygon([0, 0], [[0, 0], [1, 1]])).toBe(false)
  })

  it('returns false for an empty polygon', () => {
    expect(isPointInPolygon([0, 0], [])).toBe(false)
  })
})

describe('isPointInPolygonWithHoles', () => {
  it('returns true inside the outer ring with no holes', () => {
    expect(isPointInPolygonWithHoles([5, 5], square)).toBe(true)
  })

  it('returns false inside a carved-out hole (the donut gap)', () => {
    expect(isPointInPolygonWithHoles([5, 5], square, [innerHole])).toBe(false)
  })

  it('returns true in the ring area outside the hole', () => {
    expect(isPointInPolygonWithHoles([1, 1], square, [innerHole])).toBe(true)
  })

  it('returns false outside the outer ring regardless of holes', () => {
    expect(isPointInPolygonWithHoles([15, 15], square, [innerHole])).toBe(false)
  })
})
