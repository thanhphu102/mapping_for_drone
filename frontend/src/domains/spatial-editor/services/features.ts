import type { Feature } from 'geojson'
import { readJsonResponse } from './api'

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

