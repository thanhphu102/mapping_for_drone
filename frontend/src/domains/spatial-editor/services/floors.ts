import type { SpatialFloor } from '../types'
import { readJsonResponse } from './api'

type FloorPayload = {
  label: string
  code: string
  level: number
  elevation?: number
  visible?: boolean
  sortOrder?: number
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
  floor: FloorPayload,
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
  floor: FloorPayload,
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

