import { readJsonResponse } from '../../../shared/api/http'
import type {
  SaveTrackedRouteRequest,
  SaveTrackedRouteResponse,
} from '../types'

export async function saveTrackedRoute(
  payload: SaveTrackedRouteRequest,
): Promise<SaveTrackedRouteResponse> {
  const response = await fetch('/api/routes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return readJsonResponse<SaveTrackedRouteResponse>(response)
}
