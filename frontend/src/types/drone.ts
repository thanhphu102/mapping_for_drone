import type { Feature, MultiPolygon } from 'geojson'

export type DroneStatus = 'connected' | 'disconnected'

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error'

export type CommandDispatchStatus = 'idle' | 'sending' | 'success' | 'error'

export type BatteryValue = number | string

export interface DroneTelemetryPayload {
  lat?: number | string
  lon?: number | string
  alt?: number | string
  battery?: BatteryValue
  [key: string]: unknown
}

export interface DroneState {
  id: string
  status: DroneStatus
  lat?: number
  lon?: number
  alt?: number | string
  battery?: BatteryValue
  lastSeen?: number
}

export type DroneRegistry = Record<string, DroneState>

export interface CommandTarget {
  lat: number
  lon: number
  alt?: number
}

export interface CommandResponse {
  ok: boolean
  sent: string[]
}

export interface TelemetrySnapshot {
  dronesById: DroneRegistry
  dirtyIds: string[]
  version: number
}

export type FrontendEvent =
  | {
      type: 'connect'
      drone_id: string
    }
  | {
      type: 'disconnect'
      drone_id: string
    }
  | {
      type: 'telemetry'
      drone_id: string
      payload?: DroneTelemetryPayload
    }
  | {
      type: 'command_sent'
      target?: CommandTarget
      to?: string[]
    }

export interface MapTargetDraft {
  lat: number
  lon: number
}

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

export type EditorMode =
  | 'region'
  | 'campus'
  | 'agriculture'
  | 'building'
  | 'indoor'
  | 'parking'
  | 'custom'

export type ProjectSource = 'openstreetmap' | 'manual' | 'imported'

export type ProjectStatus = 'draft' | 'published' | 'archived'

export interface SpatialLayer {
  id: string
  name: string
  locked: boolean
  visible: boolean
  minZoom?: number
  maxZoom?: number
  featureTypes?: string[]
}

export type FloorScope = 'single' | 'multiple' | 'global'

export interface SpatialFloor {
  id: string
  label: string
  code: string
  level: number
  elevation?: number
  visible: boolean
  sortOrder: number
}

export interface ProjectSnappingConfig {
  enabled: boolean
  vertex: boolean
  edge: boolean
  midpoint: boolean
  grid: boolean
  distancePx: number
}

export interface ProjectMeasurementConfig {
  distanceUnit: 'cm' | 'm' | 'km'
  areaUnit: 'm2' | 'ha' | 'km2'
  precision: number
}

export interface ProjectCanvasConfig {
  canvasMode: 'dimOutside' | 'normal'
  defaultZoom: number
  detailZoom: number
  precisionZoom: number
  minFeaturePixelSize: number
  snapping: ProjectSnappingConfig
  measurement: ProjectMeasurementConfig
}

export interface DrawingProject {
  id: string
  name: string
  source: ProjectSource
  osmType: OsmElementType | null
  osmId: number | null
  osmTags: OsmTags
  editorMode: EditorMode
  baseGeometry: MultiPolygon
  bbox: [number, number, number, number]
  areaSquareKm: number
  areaM2?: number
  perimeterM?: number
  status: ProjectStatus
  boundaryMinZoom: number
  detailMinZoom: number
  indoorMinZoom: number | null
  layers: SpatialLayer[]
  floors: SpatialFloor[]
  features: Feature[]
  parentProjectId?: string | null
  sourceFeatureId?: string | null
  publishedAt?: number | null
  config?: ProjectCanvasConfig
}

export interface EnclosingSpaceClassification {
  editorMode: EditorMode
  confidence: number
  reason: string
  warnings: string[]
  requiresConfirmation: boolean
}

export interface OsmElementGeometryResponse {
  osmType: OsmElementType
  osmId: number
  tags: OsmTags
  geometry: MultiPolygon
  editorMode: EditorMode
  classification: EnclosingSpaceClassification
  bbox: [number, number, number, number]
  areaSquareKm: number
  areaM2: number
  perimeterM: number
  pointCount: number
  warnings: string[]
}
