import type { DrawingProject } from '../../spatial-editor/types'

/**
 * Persist an outdoor no-fly zone drawn on the main map. The backend creates a
 * published project holding a single `no_fly_zone` feature, which then flows
 * into the overlay/geofence pipeline like any other zone.
 *
 * @param ring Polygon outer ring as `[lon, lat]` vertices.
 */
export async function createNoFlyZone(
  ring: [number, number][],
  name?: string,
): Promise<DrawingProject> {
  const first = ring[0]
  const last = ring[ring.length - 1]
  const closed =
    first && last && first[0] === last[0] && first[1] === last[1]
      ? ring
      : [...ring, first]

  const response = await fetch('/api/no-fly-zones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      geometry: { type: 'Polygon', coordinates: [closed] },
    }),
  })

  if (!response.ok) {
    let detail = `Failed to create no-fly zone (${response.status})`
    try {
      const error = (await response.json()) as { detail?: unknown }
      if (error?.detail) detail = String(error.detail)
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(detail)
  }

  const data = (await response.json()) as { project: DrawingProject }
  return data.project
}
