import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import type { OsmElementGeometryResponse, OsmElementType } from '../../osm/types'
import type { DrawingProject } from '../types'
import { readJsonResponse } from './api'

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

