import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import type {
  OsmCityCalibration,
  OsmElementGeometryResponse,
  OsmElementType,
} from '../../osm/types'
import type { DrawingProject } from '../types'
import { readJsonResponse } from './api'

export async function fetchOsmElementGeometry(
  osmType: OsmElementType,
  osmId: number,
  options?: {
    calibrationCityKey?: string
  },
): Promise<OsmElementGeometryResponse> {
  const params = new URLSearchParams()
  if (options?.calibrationCityKey) {
    params.set('calibrationCityKey', options.calibrationCityKey)
  }
  const query = params.toString()
  const response = await fetch(`/api/osm/elements/${osmType}/${osmId}/geometry${query ? `?${query}` : ''}`)
  const data = await readJsonResponse<OsmElementGeometryResponse | null>(response)

  if (!data || typeof data !== 'object') {
    throw new Error('OSM geometry response is empty')
  }

  if (!data.geometry || !data.editorMode) {
    throw new Error('OSM geometry response is incomplete')
  }

  return data
}

export async function createDrawingProjectFromOsm(
  osmType: OsmElementType,
  osmId: number,
  options?: {
    calibrationCityKey?: string
    editorModeOverride?: string
    confirmedLargeArea?: boolean
    calibrationOffsetLon?: number
    calibrationOffsetLat?: number
    calibrationRotationDeg?: number
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
      calibrationCityKey: options?.calibrationCityKey,
      editorModeOverride: options?.editorModeOverride,
      confirmedLargeArea: options?.confirmedLargeArea,
      calibrationOffsetLon: options?.calibrationOffsetLon ?? 0,
      calibrationOffsetLat: options?.calibrationOffsetLat ?? 0,
      calibrationRotationDeg: options?.calibrationRotationDeg ?? 0,
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

export async function fetchOsmCityCalibration(
  cityKey: string,
): Promise<OsmCityCalibration | null> {
  const response = await fetch(
    `/api/osm/calibrations/by-city?cityKey=${encodeURIComponent(cityKey)}`,
  )
  const data = await readJsonResponse<{
    cityKey: string
    calibration: OsmCityCalibration | null
  }>(response)
  return data.calibration
}

export async function saveOsmCityCalibration(
  payload: Omit<OsmCityCalibration, 'updatedAt'>,
): Promise<OsmCityCalibration> {
  const response = await fetch('/api/osm/calibrations/by-city', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = await readJsonResponse<{
    ok: boolean
    cityKey: string
    calibration: OsmCityCalibration
  }>(response)
  return data.calibration
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
