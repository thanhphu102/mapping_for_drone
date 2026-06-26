import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type {
  OsmCandidate,
  OsmGeometryPoint,
  OsmRelationMemberGeometry,
} from '../../osm/types'

export {
  OSM_HIGHLIGHT_FILL_LAYER_ID,
  OSM_HIGHLIGHT_LINE_LAYER_ID,
  OSM_HIGHLIGHT_SOURCE_ID,
} from './mapSourceIds'

function toPositions(points: OsmGeometryPoint[]): Position[] {
  return points.map((point) => [point.lon, point.lat])
}

function isClosedRing(points: Position[]): boolean {
  if (points.length < 4) {
    return false
  }

  const first = points[0]
  const last = points[points.length - 1]
  return first[0] === last[0] && first[1] === last[1]
}

function toWayFeature(points: OsmGeometryPoint[]): Feature<Geometry> | null {
  if (points.length < 2) {
    return null
  }

  const positions = toPositions(points)
  if (isClosedRing(positions)) {
    const polygonFeature: Feature<Geometry> = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [positions],
      },
      properties: {},
    }
    return polygonFeature
  }

  const lineFeature: Feature<Geometry> = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: positions,
    },
    properties: {},
  }
  return lineFeature
}

function relationMembersToFeatures(
  members: OsmRelationMemberGeometry[] | undefined,
): Feature<Geometry>[] {
  if (!members) {
    return []
  }

  const lineStrings: Position[][] = []
  const polygons: Position[][][] = []

  for (const member of members) {
    if (member.type !== 'way' || !member.geometry || member.geometry.length < 2) {
      continue
    }

    const positions = toPositions(member.geometry)
    if (isClosedRing(positions)) {
      polygons.push([positions])
    } else {
      lineStrings.push(positions)
    }
  }

  const features: Feature<Geometry>[] = []

  if (polygons.length > 0) {
    if (polygons.length === 1) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: polygons[0],
        },
        properties: {},
      })
    } else {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: polygons,
        },
        properties: {},
      })
    }
  }

  if (lineStrings.length > 0) {
    if (lineStrings.length === 1) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: lineStrings[0],
        },
        properties: {},
      })
    } else {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: lineStrings,
        },
        properties: {},
      })
    }
  }

  return features
}

export function candidateToFeatureCollection(
  candidate: OsmCandidate | null,
): FeatureCollection<Geometry> {
  if (!candidate) {
    return { type: 'FeatureCollection', features: [] }
  }

  if (candidate.type === 'way') {
    const wayFeature = toWayFeature(candidate.geometry.geometry ?? [])
    return {
      type: 'FeatureCollection',
      features: wayFeature ? [wayFeature] : [],
    }
  }

  const relationFeatures = relationMembersToFeatures(candidate.geometry.members)
  if (relationFeatures.length > 0) {
    return {
      type: 'FeatureCollection',
      features: relationFeatures,
    }
  }

  const fallbackFeature = toWayFeature(candidate.geometry.geometry ?? [])
  return {
    type: 'FeatureCollection',
    features: fallbackFeature ? [fallbackFeature] : [],
  }
}
