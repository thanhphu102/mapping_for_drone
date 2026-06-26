import type { Feature, MultiPolygon } from 'geojson'
import type { OsmElementType, OsmTags } from '../osm/types'

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

export interface SpatialObject {
  id: string
  name: string
  sourceKey?: string
  mode?: EditorMode
  floors: SpatialFloor[]
}

export interface SpatialFeatureProperties {
  featureType?: string
  floorId?: string | null
  minZoom?: number
  maxZoom?: number
  updatedAt?: number
  [key: string]: unknown
}

export interface SpatialFeature extends Feature {
  id?: string | number
  projectId?: string
  objectId?: string
  floorId?: string | null
  properties: SpatialFeatureProperties
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
  objects?: SpatialObject[]
  floors: SpatialFloor[]
  features: SpatialFeature[]
  publishedFeatures?: SpatialFeature[]
  parentProjectId?: string | null
  sourceFeatureId?: string | null
  publishedAt?: number | null
  config?: ProjectCanvasConfig
  /** Set to 'no_fly_zone' for standalone main-map no-fly zones. */
  kind?: string
}
