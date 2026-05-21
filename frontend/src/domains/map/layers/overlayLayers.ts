import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { DrawingProject } from '../../spatial-editor/types'

export {
  PUBLISHED_OVERLAY_BOUNDARY_MIN_ZOOM,
  PUBLISHED_OVERLAY_BOUNDARY_FILL_LAYER_ID,
  PUBLISHED_OVERLAY_BOUNDARY_LINE_LAYER_ID,
  PUBLISHED_OVERLAY_BOUNDARY_SOURCE_ID,
  PUBLISHED_OVERLAY_FEATURE_FILL_LAYER_ID,
  PUBLISHED_OVERLAY_FEATURE_LINE_LAYER_ID,
  PUBLISHED_OVERLAY_FEATURE_POINT_LAYER_ID,
  PUBLISHED_OVERLAY_FEATURE_SOURCE_ID,
  PUBLISHED_OVERLAY_FLOOR_PANEL_MIN_ZOOM,
  PUBLISHED_OVERLAY_MAX_NEARBY_BUILDINGS,
} from './mapSourceIds'

export function projectsToBoundaryCollection(
  projects: DrawingProject[],
): FeatureCollection<Geometry> {
  return {
    type: 'FeatureCollection',
    features: projects.map((project) => ({
      type: 'Feature',
      id: project.id,
      geometry: project.baseGeometry,
      properties: {
        projectId: project.id,
        name: project.name,
        editorMode: project.editorMode,
      },
    })),
  }
}

export function projectsToFeatureCollection(
  projects: DrawingProject[],
  selectedProjectId: string | null,
  selectedFloorId: string | null,
): FeatureCollection<Geometry> {
  return {
    type: 'FeatureCollection',
    features: projects.flatMap((project) =>
      (project.publishedFeatures ?? [])
        .filter((feature) => {
          if (!selectedProjectId || project.id !== selectedProjectId) return true
          if (!selectedFloorId) return true
          const floorId = String((feature.properties as Record<string, unknown> | undefined)?.floorId ?? '')
          return floorId === selectedFloorId
        })
        .map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            projectId: project.id,
            projectName: project.name,
            editorMode: project.editorMode,
          },
        })),
    ) as Feature<Geometry>[],
  }
}
