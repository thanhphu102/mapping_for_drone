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
