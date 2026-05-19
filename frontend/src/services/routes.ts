import type {
  SaveTrackedRouteRequest,
  SaveTrackedRouteResponse,
} from '../types/drone'

async function readJsonResponse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as
    | { detail?: unknown }
    | null

  if (!response.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : null
    throw new Error(detail ?? `Request failed with HTTP ${response.status}`)
  }

  return data as T
}

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
