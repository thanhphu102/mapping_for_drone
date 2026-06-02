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

function geometryPositions(geometry: Geometry): Position[] {
  if (geometry.type === 'Point') return [geometry.coordinates]
  if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') return geometry.coordinates
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return geometry.coordinates.flat(1)
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2)
  return []
}

function geometryCentroid(geometry: Geometry): Position | null {
  const pts = geometryPositions(geometry)
  if (pts.length === 0) return null
  let lon = 0
  let lat = 0
  pts.forEach(([x, y]) => {
    lon += x
    lat += y
  })
  return [lon / pts.length, lat / pts.length]
}

function transformPosition(
  position: Position,
  center: Position,
  offsetLon: number,
  offsetLat: number,
  rotationDeg: number,
): Position {
  const [lon, lat] = position
  const [centerLon, centerLat] = center
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = lon - centerLon
  const dy = lat - centerLat
  return [
    ((dx * cos) - (dy * sin)) + centerLon + offsetLon,
    ((dx * sin) + (dy * cos)) + centerLat + offsetLat,
  ]
}

function transformGeometry(
  geometry: Geometry,
  center: Position,
  offsetLon: number,
  offsetLat: number,
  rotationDeg: number,
): Geometry {
  if (geometry.type === 'Point') {
    return { ...geometry, coordinates: transformPosition(geometry.coordinates, center, offsetLon, offsetLat, rotationDeg) }
  }
  if (geometry.type === 'MultiPoint') {
    return { ...geometry, coordinates: geometry.coordinates.map((p) => transformPosition(p, center, offsetLon, offsetLat, rotationDeg)) }
  }
  if (geometry.type === 'LineString') {
    return { ...geometry, coordinates: geometry.coordinates.map((p) => transformPosition(p, center, offsetLon, offsetLat, rotationDeg)) }
  }
  if (geometry.type === 'MultiLineString') {
    return { ...geometry, coordinates: geometry.coordinates.map((line) => line.map((p) => transformPosition(p, center, offsetLon, offsetLat, rotationDeg))) }
  }
  if (geometry.type === 'Polygon') {
    return { ...geometry, coordinates: geometry.coordinates.map((ring) => ring.map((p) => transformPosition(p, center, offsetLon, offsetLat, rotationDeg))) }
  }
  if (geometry.type === 'MultiPolygon') {
    return { ...geometry, coordinates: geometry.coordinates.map((poly) => poly.map((ring) => ring.map((p) => transformPosition(p, center, offsetLon, offsetLat, rotationDeg)))) }
  }
  return geometry
}

export function transformPreviewFeatureCollection(
  collection: FeatureCollection<Geometry>,
  transform: { offsetLon: number; offsetLat: number; rotationDeg: number } | null,
): FeatureCollection<Geometry> {
  if (!transform) return collection
  const hasTransform = transform.offsetLon !== 0 || transform.offsetLat !== 0 || transform.rotationDeg !== 0
  if (!hasTransform) return collection
  const firstGeometry = collection.features[0]?.geometry
  if (!firstGeometry) return collection
  const center = geometryCentroid(firstGeometry)
  if (!center) return collection
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => ({
      ...feature,
      geometry: transformGeometry(feature.geometry, center, transform.offsetLon, transform.offsetLat, transform.rotationDeg),
    })),
  }
}
