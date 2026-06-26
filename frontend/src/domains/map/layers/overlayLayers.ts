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
          const hasFloors = Array.isArray(project.floors) && project.floors.length > 0
          const rawFloorId =
            (feature as { floorId?: unknown }).floorId
            ?? (feature.properties as Record<string, unknown> | undefined)?.floorId
          const floorId = rawFloorId == null ? '' : String(rawFloorId)

          // Rule 1: if project has floors, never render no-floor features.
          if (hasFloors && floorId === '') {
            return false
          }
          // Rule 2: if project has no floors, only render no-floor features.
          if (!hasFloors && floorId !== '') {
            return false
          }

          // Optional floor focus when a project is selected.
          if (selectedProjectId && project.id === selectedProjectId && selectedFloorId && hasFloors) {
            return floorId === selectedFloorId
          }
          return true
        })
        .map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            projectId: project.id,
            projectName: project.name,
          },
        })),
    ) as Feature<Geometry>[],
  }
}
