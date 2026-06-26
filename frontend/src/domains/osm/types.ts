import type { MultiPolygon } from 'geojson'

export type OsmElementType = 'way' | 'relation'

export type OsmTags = Record<string, string>

export interface OsmGeometryPoint {
  lat: number
  lon: number
}

export interface OsmRelationMemberGeometry {
  type?: string
  role?: string
  ref?: number
  geometry?: OsmGeometryPoint[]
}

export interface OsmCandidateGeometry {
  geometry?: OsmGeometryPoint[]
  members?: OsmRelationMemberGeometry[]
}

export interface OsmCandidate {
  id: number
  type: OsmElementType
  tags: OsmTags
  geometry: OsmCandidateGeometry
  label: string
  category: string
}

export interface OsmElementGeometryResponse {
  osmType: OsmElementType
  osmId: number
  tags: OsmTags
  geometry: MultiPolygon
  bbox: [number, number, number, number]
  areaSquareKm: number
  areaM2: number
  perimeterM: number
  pointCount: number
  warnings: string[]
  requiresConfirmation: boolean
}
