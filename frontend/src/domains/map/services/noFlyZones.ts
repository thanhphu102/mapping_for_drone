import type { DrawingProject } from '../../spatial-editor/types'

function closedRing(ring: [number, number][]): [number, number][] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  return first && last && first[0] === last[0] && first[1] === last[1]
    ? ring
    : [...ring, first]
}

async function readZoneResponse(response: Response): Promise<DrawingProject> {
  if (!response.ok) {
    let detail = `No-fly zone request failed (${response.status})`
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
  const response = await fetch('/api/no-fly-zones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      geometry: { type: 'Polygon', coordinates: [closedRing(ring)] },
    }),
  })
  return readZoneResponse(response)
}

/** Replace the polygon of an existing no-fly zone (after dragging its vertices). */
export async function updateNoFlyZone(
  projectId: string,
  ring: [number, number][],
  name?: string,
): Promise<DrawingProject> {
  const response = await fetch(`/api/no-fly-zones/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      geometry: { type: 'Polygon', coordinates: [closedRing(ring)] },
    }),
  })
  return readZoneResponse(response)
}

/** Delete a no-fly zone project. */
export async function deleteNoFlyZone(projectId: string): Promise<void> {
  const response = await fetch(`/api/drawing-projects/${projectId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error(`Failed to delete no-fly zone (${response.status})`)
  }
}
