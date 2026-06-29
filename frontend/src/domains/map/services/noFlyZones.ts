import type { DrawingProject } from '../../spatial-editor/types'
import {
  ALLOWED_ZONE_FEATURE_TYPE,
  NO_FLY_ZONE_FEATURE_TYPE,
  type ZoneFeatureType,
} from '../noFlyZones'

function closedRing(ring: [number, number][]): [number, number][] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  return first && last && first[0] === last[0] && first[1] === last[1]
    ? ring
    : [...ring, first]
}

/** Map a zone type to its REST collection path. */
function zoneEndpoint(type: ZoneFeatureType): string {
  return type === ALLOWED_ZONE_FEATURE_TYPE ? '/api/allowed-zones' : '/api/no-fly-zones'
}

async function readZoneResponse(response: Response): Promise<DrawingProject> {
  if (!response.ok) {
    let detail = `Zone request failed (${response.status})`
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
 * Persist an outdoor geofence zone drawn on the main map. The backend creates a
 * published project holding a single zone feature, clips any overlapping older
 * zones (newest-wins), and the result flows into the overlay pipeline.
 *
 * @param ring Polygon outer ring as `[lon, lat]` vertices.
 * @param type Which zone to create: `no_fly_zone` or `allowed_zone`.
 */
export async function createZone(
  ring: [number, number][],
  type: ZoneFeatureType,
  name?: string,
): Promise<DrawingProject> {
  const response = await fetch(zoneEndpoint(type), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      geometry: { type: 'Polygon', coordinates: [closedRing(ring)] },
    }),
  })
  return readZoneResponse(response)
}

/** Replace the polygon of an existing zone (after dragging its vertices). */
export async function updateZone(
  projectId: string,
  ring: [number, number][],
  type: ZoneFeatureType,
  name?: string,
): Promise<DrawingProject> {
  const response = await fetch(`${zoneEndpoint(type)}/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      geometry: { type: 'Polygon', coordinates: [closedRing(ring)] },
    }),
  })
  return readZoneResponse(response)
}

/** Delete a zone project (works for either zone type). */
export async function deleteZone(projectId: string): Promise<void> {
  const response = await fetch(`/api/drawing-projects/${projectId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error(`Failed to delete zone (${response.status})`)
  }
}

// --- Backwards-compatible no-fly-zone wrappers ---------------------------- //

/** @deprecated use {@link createZone} with `no_fly_zone`. */
export function createNoFlyZone(ring: [number, number][], name?: string): Promise<DrawingProject> {
  return createZone(ring, NO_FLY_ZONE_FEATURE_TYPE, name)
}

/** @deprecated use {@link updateZone} with `no_fly_zone`. */
export function updateNoFlyZone(
  projectId: string,
  ring: [number, number][],
  name?: string,
): Promise<DrawingProject> {
  return updateZone(projectId, ring, NO_FLY_ZONE_FEATURE_TYPE, name)
}

/** @deprecated use {@link deleteZone}. */
export function deleteNoFlyZone(projectId: string): Promise<void> {
  return deleteZone(projectId)
}
