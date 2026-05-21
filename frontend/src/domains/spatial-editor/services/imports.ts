export type ImportScanPreviewResponse = {
  objectId: string | null
  floorId: string | null
  detectedRooms: number
  validRooms: number
  invalidRooms: number
  warnings: string[]
  previewFeatures?: unknown[]
}

export type ImportPolygonPayload = {
  name?: string
  externalId?: string
  tag?: string
  note?: string
  coordinates: [number, number][]
}

export async function previewScanJsonImport(params: {
  projectId: string
  objectId?: string
  floorId?: string | null
  floorCode?: string
  floorLabel?: string
  floorLevel?: number
  polygons: ImportPolygonPayload[]
}): Promise<ImportScanPreviewResponse> {
  const response = await fetch('/api/imports/scan-json/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object: {
        projectId: params.projectId,
        objectId: params.objectId,
      },
      floor: {
        floorId: params.floorId ?? undefined,
        code: params.floorCode,
        label: params.floorLabel,
        level: params.floorLevel,
      },
      payload: {
        polygons: params.polygons,
      },
    }),
  })
  const data = (await response.json().catch(() => null)) as
    | { detail?: unknown }
    | ImportScanPreviewResponse
    | null
  if (!response.ok) {
    const detail = typeof data === 'object' && data && 'detail' in data
      ? (data as { detail?: unknown }).detail
      : null
    throw new Error(typeof detail === 'string' ? detail : `Request failed with HTTP ${response.status}`)
  }
  return data as ImportScanPreviewResponse
}

export async function commitScanJsonImport(params: {
  projectId: string
  objectId?: string
  floorId?: string | null
  floorCode?: string
  floorLabel?: string
  floorLevel?: number
  polygons: ImportPolygonPayload[]
}): Promise<{
  ok: boolean
  projectId: string
  objectId: string
  floorId: string
  changes: { features: { upsert: unknown[] } }
  detectedRooms: number
  validRooms: number
  invalidRooms: number
  warnings: string[]
}> {
  const response = await fetch('/api/imports/scan-json/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirm: true,
      object: {
        projectId: params.projectId,
        objectId: params.objectId,
      },
      floor: {
        floorId: params.floorId ?? undefined,
        code: params.floorCode,
        label: params.floorLabel,
        level: params.floorLevel,
      },
      payload: {
        polygons: params.polygons,
      },
    }),
  })
  const data = (await response.json().catch(() => null)) as
    | { detail?: unknown }
    | {
        ok: boolean
        projectId: string
        objectId: string
        floorId: string
        changes: { features: { upsert: unknown[] } }
        detectedRooms: number
        validRooms: number
        invalidRooms: number
        warnings: string[]
      }
    | null
  if (!response.ok) {
    const detail = typeof data === 'object' && data && 'detail' in data
      ? (data as { detail?: unknown }).detail
      : null
    throw new Error(typeof detail === 'string' ? detail : `Request failed with HTTP ${response.status}`)
  }
  return data as {
    ok: boolean
    projectId: string
    objectId: string
    floorId: string
    changes: { features: { upsert: unknown[] } }
    detectedRooms: number
    validRooms: number
    invalidRooms: number
    warnings: string[]
  }
}
