import type {
  OsmCandidate,
  OsmElementType,
  OsmGeometryPoint,
  OsmRelationMemberGeometry,
  OsmTags,
} from '../types'

interface OverpassElement {
  type?: string
  id?: number
  tags?: unknown
  geometry?: unknown
  members?: unknown
}

interface OverpassResponse {
  elements?: OverpassElement[]
}

const categoryTagPriority = [
  'amenity',
  'shop',
  'highway',
  'building',
  'landuse',
  'leisure',
  'natural',
  'man_made',
  'railway',
  'tourism',
  'operator',
] as const

function asTags(value: unknown): OsmTags {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const tags: OsmTags = {}
  for (const [key, tagValue] of Object.entries(value)) {
    if (typeof tagValue === 'string') {
      tags[key] = tagValue
    }
  }

  return tags
}

function asGeometryPoints(value: unknown): OsmGeometryPoint[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((point) => {
      if (!point || typeof point !== 'object') {
        return null
      }

      const lat = (point as { lat?: unknown }).lat
      const lon = (point as { lon?: unknown }).lon
      if (typeof lat !== 'number' || typeof lon !== 'number') {
        return null
      }

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null
      }

      return { lat, lon }
    })
    .filter((point): point is OsmGeometryPoint => point !== null)
}

function asRelationMembers(value: unknown): OsmRelationMemberGeometry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((member) => {
      if (!member || typeof member !== 'object') {
        return null
      }

      const memberObject = member as {
        type?: unknown
        role?: unknown
        ref?: unknown
        geometry?: unknown
      }

      const next: OsmRelationMemberGeometry = {}
      if (typeof memberObject.type === 'string') {
        next.type = memberObject.type
      }
      if (typeof memberObject.role === 'string') {
        next.role = memberObject.role
      }
      if (typeof memberObject.ref === 'number') {
        next.ref = memberObject.ref
      }

      const geometry = asGeometryPoints(memberObject.geometry)
      if (geometry.length > 0) {
        next.geometry = geometry
      }

      return next
    })
    .filter((member): member is OsmRelationMemberGeometry => member !== null)
}

function buildLabel(tags: OsmTags): string {
  return (
    tags.name ||
    tags['addr:housename'] ||
    tags.operator ||
    tags.building ||
    tags.landuse ||
    'Unnamed element'
  )
}

function buildCategory(tags: OsmTags): string {
  for (const key of categoryTagPriority) {
    const value = tags[key]
    if (value) {
      return `${key}=${value}`
    }
  }

  return 'unknown'
}

function asCandidateType(value: string | undefined): OsmElementType | null {
  if (value === 'way' || value === 'relation') {
    return value
  }

  return null
}

export async function fetchEnclosingOsmElements(
  lat: number,
  lon: number,
): Promise<OsmCandidate[]> {
  const overpassQuery = `
[out:json][timeout:10];
is_in(${lat},${lon})->.areas;
(
  way(pivot.areas);
  relation(pivot.areas);
);
out tags geom;
`
  const overpassBody = new URLSearchParams({ data: overpassQuery }).toString()
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: overpassBody,
  })

  if (!response.ok) {
    throw new Error(`Overpass API failed with HTTP ${response.status}`)
  }

  const data = (await response.json()) as OverpassResponse
  const elements = data.elements ?? []
  const candidates: OsmCandidate[] = []
  const seen = new Set<string>()

  for (const element of elements) {
    const type = asCandidateType(element.type)
    if (!type || typeof element.id !== 'number') {
      continue
    }
    const dedupeKey = `${type}:${element.id}`
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)

    const tags = asTags(element.tags)
    const geometry = asGeometryPoints(element.geometry)
    const members = asRelationMembers(element.members)

    candidates.push({
      id: element.id,
      type,
      tags,
      geometry: {
        geometry: geometry.length > 0 ? geometry : undefined,
        members: members.length > 0 ? members : undefined,
      },
      label: buildLabel(tags),
      category: buildCategory(tags),
    })
  }

  return candidates
}

export async function fetchOsmElementFull(type: OsmElementType, id: number) {
  const response = await fetch(
    `https://api.openstreetmap.org/api/0.6/${type}/${id}/full.json`,
  )

  if (!response.ok) {
    throw new Error(`OSM API failed with HTTP ${response.status}`)
  }

  return response.json() as Promise<unknown>
}
