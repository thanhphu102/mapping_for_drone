import type { Geometry, MultiPolygon, Position } from 'geojson'

const GEOMETRY_EPSILON = 1e-9

interface Segment {
  start: Position
  end: Position
}

function almostEqual(a: number, b: number, epsilon = GEOMETRY_EPSILON) {
  return Math.abs(a - b) <= epsilon
}

function pointEquals(a: Position, b: Position, epsilon = GEOMETRY_EPSILON) {
  return almostEqual(a[0], b[0], epsilon) && almostEqual(a[1], b[1], epsilon)
}

function orientation(a: Position, b: Position, c: Position) {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  if (almostEqual(value, 0)) return 0
  return value > 0 ? 1 : -1
}

function pointOnSegment2D(point: Position, a: Position, b: Position, epsilon = GEOMETRY_EPSILON) {
  if (orientation(a, b, point) !== 0) {
    return false
  }
  return (
    point[0] >= Math.min(a[0], b[0]) - epsilon &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    point[1] >= Math.min(a[1], b[1]) - epsilon &&
    point[1] <= Math.max(a[1], b[1]) + epsilon
  )
}

function pointInRing(point: Position, ring: Position[]) {
  const [x, y] = point
  let inside = false
  let j = ring.length - 1
  for (let i = 0; i < ring.length; i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi
    if (intersects) inside = !inside
    j = i
  }
  return inside
}

function pointOnRing(point: Position, ring: Position[]) {
  for (let index = 1; index < ring.length; index += 1) {
    if (pointOnSegment2D(point, ring[index - 1], ring[index])) {
      return true
    }
  }
  return false
}

function isPointInsideBaseBoundary(point: Position, boundary: MultiPolygon) {
  return boundary.coordinates.some((polygon) => {
    const [outer, ...holes] = polygon
    const insideOuter = pointInRing(point, outer) || pointOnRing(point, outer)
    if (!insideOuter) {
      return false
    }
    return !holes.some((hole) => pointInRing(point, hole) || pointOnRing(point, hole))
  })
}

function isBoundaryTouchOnlyIntersection(a1: Position, a2: Position, b1: Position, b2: Position) {
  const touchAtEndpoints =
    pointEquals(a1, b1) || pointEquals(a1, b2) || pointEquals(a2, b1) || pointEquals(a2, b2)
  if (touchAtEndpoints) {
    return true
  }
  if (pointOnSegment2D(a1, b1, b2) || pointOnSegment2D(a2, b1, b2)) {
    return true
  }
  if (pointOnSegment2D(b1, a1, a2) || pointOnSegment2D(b2, a1, a2)) {
    return true
  }
  return false
}

function segmentsProperlyIntersect(a1: Position, a2: Position, b1: Position, b2: Position) {
  const o1 = orientation(a1, a2, b1)
  const o2 = orientation(a1, a2, b2)
  const o3 = orientation(b1, b2, a1)
  const o4 = orientation(b1, b2, a2)

  const generalIntersection = o1 !== o2 && o3 !== o4
  if (generalIntersection) {
    return !isBoundaryTouchOnlyIntersection(a1, a2, b1, b2)
  }

  if (o1 === 0 && pointOnSegment2D(b1, a1, a2)) return !isBoundaryTouchOnlyIntersection(a1, a2, b1, b2)
  if (o2 === 0 && pointOnSegment2D(b2, a1, a2)) return !isBoundaryTouchOnlyIntersection(a1, a2, b1, b2)
  if (o3 === 0 && pointOnSegment2D(a1, b1, b2)) return !isBoundaryTouchOnlyIntersection(a1, a2, b1, b2)
  if (o4 === 0 && pointOnSegment2D(a2, b1, b2)) return !isBoundaryTouchOnlyIntersection(a1, a2, b1, b2)
  return false
}

function geometrySegments(geometry: Geometry): Segment[] {
  if (geometry.type === 'LineString') {
    const coords = geometry.coordinates as Position[]
    const segments: Segment[] = []
    for (let index = 1; index < coords.length; index += 1) {
      segments.push({ start: coords[index - 1], end: coords[index] })
    }
    return segments
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.flatMap((line) => geometrySegments({ type: 'LineString', coordinates: line }))
  }
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.flatMap((ring) => geometrySegments({ type: 'LineString', coordinates: ring }))
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) =>
      polygon.flatMap((ring) => geometrySegments({ type: 'LineString', coordinates: ring })),
    )
  }
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.flatMap((child) => geometrySegments(child))
  }
  return []
}

function geometryPoints(geometry: Geometry): Position[] {
  if (geometry.type === 'Point') return [geometry.coordinates as Position]
  if (geometry.type === 'MultiPoint') return geometry.coordinates as Position[]
  if (geometry.type === 'LineString') return geometry.coordinates as Position[]
  if (geometry.type === 'MultiLineString') return geometry.coordinates.flat() as Position[]
  if (geometry.type === 'Polygon') return geometry.coordinates.flat() as Position[]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2) as Position[]
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap((child) => geometryPoints(child))
  return []
}

function boundaryRingSegments(boundary: MultiPolygon): Segment[] {
  const segments: Segment[] = []
  boundary.coordinates.forEach((polygon) => {
    polygon.forEach((ring) => {
      for (let index = 1; index < ring.length; index += 1) {
        segments.push({ start: ring[index - 1], end: ring[index] })
      }
    })
  })
  return segments
}

function segmentMidpoint(segment: Segment): Position {
  return [
    (segment.start[0] + segment.end[0]) / 2,
    (segment.start[1] + segment.end[1]) / 2,
  ]
}

export function geometryInsideBoundaryStrict(geometry: Geometry, boundary: MultiPolygon) {
  const points = geometryPoints(geometry)
  if (points.length === 0) {
    return false
  }
  if (!points.every((point) => isPointInsideBaseBoundary(point, boundary))) {
    return false
  }

  const candidateSegments = geometrySegments(geometry)
  const boundarySegments = boundaryRingSegments(boundary)
  for (const segment of candidateSegments) {
    if (!isPointInsideBaseBoundary(segmentMidpoint(segment), boundary)) {
      return false
    }
    for (const boundarySegment of boundarySegments) {
      if (
        segmentsProperlyIntersect(
          segment.start,
          segment.end,
          boundarySegment.start,
          boundarySegment.end,
        )
      ) {
        return false
      }
    }
  }
  return true
}
