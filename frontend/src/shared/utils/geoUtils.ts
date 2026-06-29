// Pure geometry helpers. No React, no side effects — simple inputs, simple outputs.

/**
 * Ray-casting (even-odd rule) point-in-polygon test.
 *
 * @param point   The coordinate to test, as `[lon, lat]` (GeoJSON order).
 * @param polygon A single linear ring as an array of `[lon, lat]` vertices.
 *                Closed rings (first vertex === last vertex) are tolerated.
 * @returns `true` when the point lies inside the ring.
 *
 * Mirrors the even-odd ray cast used by the spatial editor
 * (`spatial-editor/geometry/validation.ts`). A vertex/edge hit may land on
 * either side depending on floating point, which is acceptable for geofencing.
 */
export function isPointInPolygon(
  point: [number, number],
  polygon: [number, number][],
): boolean {
  if (polygon.length < 3) {
    return false
  }

  const [x, y] = point
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]

    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

/**
 * Point-in-polygon test that respects interior holes (a "donut").
 *
 * @param point  The coordinate to test, as `[lon, lat]`.
 * @param outer  The outer ring as `[lon, lat]` vertices.
 * @param holes  Interior rings carved out of the polygon (default none).
 * @returns `true` when the point is inside the outer ring and not inside any
 *          hole — mirrors the backend `point_in_multipolygon` semantics.
 *
 * Collapsed geofence zones can become donuts (e.g. a no-fly zone with an allowed
 * zone punched out of it); without hole awareness a drone parked in the carved
 * out region would falsely register as inside the zone.
 */
export function isPointInPolygonWithHoles(
  point: [number, number],
  outer: [number, number][],
  holes: [number, number][][] = [],
): boolean {
  if (!isPointInPolygon(point, outer)) {
    return false
  }
  return !holes.some((hole) => isPointInPolygon(point, hole))
}
