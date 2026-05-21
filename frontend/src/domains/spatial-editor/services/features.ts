import type { SpatialFeature } from '../types'
import { readJsonResponse } from './api'

export async function fetchDrawingProjectFeatures(
  projectId: string,
  signal?: AbortSignal,
): Promise<SpatialFeature[]> {
  const response = await fetch(`/api/drawing-projects/${projectId}/features`, {
    signal,
  })
  const data = await readJsonResponse<{ features: SpatialFeature[] }>(response)
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
): Promise<SpatialFeature[]> {
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
  const data = await readJsonResponse<{ features: SpatialFeature[] }>(response)
  return data.features
}

export async function saveDrawingFeature(
  projectId: string,
  feature: SpatialFeature,
): Promise<{ ok: boolean; feature: SpatialFeature }> {
  const response = await fetch(`/api/drawing-projects/${projectId}/features`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ feature }),
  })
  return readJsonResponse<{ ok: boolean; feature: SpatialFeature }>(response)
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
