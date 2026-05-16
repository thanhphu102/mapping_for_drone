import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import type {
  DrawingProject,
  OsmElementGeometryResponse,
  OsmElementType,
  SpatialFloor,
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

export async function fetchOsmElementGeometry(
  osmType: OsmElementType,
  osmId: number,
): Promise<OsmElementGeometryResponse> {
  const response = await fetch(`/api/osm/elements/${osmType}/${osmId}/geometry`)
  return readJsonResponse<OsmElementGeometryResponse>(response)
}

export async function createDrawingProjectFromOsm(
  osmType: OsmElementType,
  osmId: number,
  options?: {
    editorModeOverride?: string
    confirmedLargeArea?: boolean
  },
): Promise<{
  projectId: string
  project: DrawingProject
  editorMode: string
  warnings: string[]
}> {
  const response = await fetch('/api/drawing-projects/from-osm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      osmType,
      osmId,
      editorModeOverride: options?.editorModeOverride,
      confirmedLargeArea: options?.confirmedLargeArea,
    }),
  })
  const data = (await response.json().catch(() => null)) as
    | { detail?: unknown }
    | null
  if (!response.ok) {
    if (typeof data?.detail === 'string') {
      let parsed: {
        message?: string
        requiresConfirmation?: boolean
        warnings?: string[]
      }
      try {
        parsed = JSON.parse(data.detail) as {
          message?: string
          requiresConfirmation?: boolean
          warnings?: string[]
        }
      } catch {
        throw new Error(data.detail)
      }
      const error = new Error(
        parsed.message ?? `Request failed with HTTP ${response.status}`,
      ) as Error & {
        requiresConfirmation?: boolean
        warnings?: string[]
      }
      error.requiresConfirmation = parsed.requiresConfirmation
      error.warnings = parsed.warnings
      throw error
    }
    throw new Error(`Request failed with HTTP ${response.status}`)
  }
  return data as {
    projectId: string
    project: DrawingProject
    editorMode: string
    warnings: string[]
  }
}

export async function fetchDrawingProject(
  projectId: string,
  signal?: AbortSignal,
): Promise<DrawingProject> {
  const response = await fetch(`/api/drawing-projects/${projectId}`, { signal })
  return readJsonResponse<DrawingProject>(response)
}

export async function fetchDrawingProjects(filters?: {
  parentProjectId?: string
  osmType?: OsmElementType
  osmId?: number
}): Promise<DrawingProject[]> {
  const params = new URLSearchParams()
  if (filters?.parentProjectId) {
    params.set('parentProjectId', filters.parentProjectId)
  }
  if (filters?.osmType) {
    params.set('osmType', filters.osmType)
  }
  if (typeof filters?.osmId === 'number') {
    params.set('osmId', String(filters.osmId))
  }
  const query = params.toString()
  const response = await fetch(`/api/drawing-projects${query ? `?${query}` : ''}`)
  const data = await readJsonResponse<{ projects: DrawingProject[] }>(response)
  return data.projects
}

export async function fetchDrawingProjectFeatures(
  projectId: string,
  signal?: AbortSignal,
): Promise<Feature[]> {
  const response = await fetch(`/api/drawing-projects/${projectId}/features`, {
    signal,
  })
  const data = await readJsonResponse<{ features: Feature[] }>(response)
  return data.features
}

export async function fetchProjectVisibleFeatures(
  payload: {
    projectId: string
    bbox: [number, number, number, number]
    zoom: number
    layerId?: string | null
    floorId?: string | null
  },
  signal?: AbortSignal,
): Promise<Feature[]> {
  const params = new URLSearchParams({
    projectId: payload.projectId,
    bbox: payload.bbox.join(','),
    zoom: String(payload.zoom),
  })
  if (payload.layerId) {
    params.set('layerId', payload.layerId)
  }
  if (payload.floorId) {
    params.set('floorId', payload.floorId)
  }
  const response = await fetch(`/api/map-features?${params.toString()}`, { signal })
  const data = await readJsonResponse<{ features: Feature[] }>(response)
  return data.features
}

export async function saveDrawingFeature(
  projectId: string,
  feature: Feature,
): Promise<{ ok: boolean; feature: Feature }> {
  const response = await fetch(`/api/drawing-projects/${projectId}/features`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ feature }),
  })
  return readJsonResponse<{ ok: boolean; feature: Feature }>(response)
}

export async function publishDrawingProject(
  projectId: string,
): Promise<{ ok: boolean; project: DrawingProject }> {
  const response = await fetch(`/api/drawing-projects/${projectId}/publish`, {
    method: 'POST',
  })
  return readJsonResponse<{ ok: boolean; project: DrawingProject }>(response)
}

export async function deleteDrawingProject(
  projectId: string,
): Promise<{ ok: boolean }> {
  const response = await fetch(`/api/drawing-projects/${projectId}`, {
    method: 'DELETE',
  })
  return readJsonResponse<{ ok: boolean }>(response)
}

export async function deleteDrawingFeature(
  projectId: string,
  featureId: string,
): Promise<{ ok: boolean }> {
  const response = await fetch(
    `/api/drawing-projects/${projectId}/features/${featureId}`,
    { method: 'DELETE' },
  )
  return readJsonResponse<{ ok: boolean }>(response)
}

export async function fetchProjectFloors(
  projectId: string,
): Promise<SpatialFloor[]> {
  const response = await fetch(`/api/drawing-projects/${projectId}/floors`)
  const data = await readJsonResponse<{ floors: SpatialFloor[] }>(response)
  return data.floors
}

export async function createProjectFloor(
  projectId: string,
  floor: { label: string; code: string; level: number; elevation?: number; visible?: boolean; sortOrder?: number },
): Promise<{ floor: SpatialFloor; floors: SpatialFloor[] }> {
  const response = await fetch(`/api/drawing-projects/${projectId}/floors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(floor),
  })
  return readJsonResponse<{ floor: SpatialFloor; floors: SpatialFloor[] }>(response)
}

export async function updateProjectFloor(
  projectId: string,
  floorId: string,
  floor: { label: string; code: string; level: number; elevation?: number; visible?: boolean; sortOrder?: number },
): Promise<{ ok: boolean; floors: SpatialFloor[] }> {
  const response = await fetch(`/api/drawing-projects/${projectId}/floors/${floorId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(floor),
  })
  return readJsonResponse<{ ok: boolean; floors: SpatialFloor[] }>(response)
}

export async function deleteProjectFloor(
  projectId: string,
  floorId: string,
): Promise<{ ok: boolean; floors: SpatialFloor[] }> {
  const response = await fetch(`/api/drawing-projects/${projectId}/floors/${floorId}`, {
    method: 'DELETE',
  })
  return readJsonResponse<{ ok: boolean; floors: SpatialFloor[] }>(response)
}

export async function fetchMapOverlays(
  bbox: [number, number, number, number],
): Promise<{ projects: DrawingProject[] }> {
  const response = await fetch(`/api/map-overlays?bbox=${bbox.join(',')}`)
  return readJsonResponse<{ projects: DrawingProject[] }>(response)
}

export async function createSpatialProjectFromGeometry(
  payload: {
    name: string
    geometry: Polygon | MultiPolygon
    editorMode: string
  },
): Promise<{ projectId: string; project: DrawingProject }> {
  const response = await fetch('/api/spatial-projects/from-geometry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJsonResponse<{ projectId: string; project: DrawingProject }>(response)
}

export async function importSpatialProjectGeoJson(
  payload: {
    name: string
    geojson: Feature | FeatureCollection | Polygon | MultiPolygon
    editorMode?: string
  },
): Promise<{ projectId: string; project: DrawingProject }> {
  const response = await fetch('/api/spatial-projects/import-geojson', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJsonResponse<{ projectId: string; project: DrawingProject }>(response)
}

export async function createChildProject(
  projectId: string,
  featureId: string,
  options?: { name?: string; editorMode?: 'building' | 'indoor' },
): Promise<{ childProjectId: string; project: DrawingProject }> {
  const response = await fetch(
    `/api/drawing-projects/${projectId}/features/${featureId}/create-child-project`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options ?? {}),
    },
  )
  return readJsonResponse<{ childProjectId: string; project: DrawingProject }>(response)
}

export async function fetchChildProjects(
  projectId: string,
): Promise<DrawingProject[]> {
  return fetchDrawingProjects({ parentProjectId: projectId })
}
