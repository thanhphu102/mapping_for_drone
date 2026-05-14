import { useEffect } from 'react'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { GeoJSONSource } from 'maplibre-gl'
import { useDroneMap } from '../hooks/useDroneMap'
import { useDroneMarkers } from '../hooks/useDroneMarkers'
import { useProjectedTarget } from '../hooks/useProjectedTarget'
import type {
  CommandDispatchStatus,
  CommandTarget,
  DroneRegistry,
  MapTargetDraft,
  OsmCandidate,
  OsmGeometryPoint,
  OsmRelationMemberGeometry,
} from '../types/drone'
import { TargetCommandPopover } from './TargetCommandPopover'

const highlightSourceId = 'osm-highlight-source'
const highlightFillLayerId = 'osm-highlight-fill-layer'
const highlightLineLayerId = 'osm-highlight-line-layer'

interface DroneMapProps {
  dronesById: DroneRegistry
  dirtyIds: string[]
  selectedTarget: CommandTarget | null
  connectedCount: number
  commandStatus: CommandDispatchStatus
  highlightedCandidate: OsmCandidate | null
  isFetchingCandidates: boolean
  isFetchingFull: boolean
  locationFetchMessage: { tone: 'success' | 'error' | 'info'; text: string } | null
  onTargetSelect: (target: MapTargetDraft) => void
  onFetchLocation: () => void
  onCancelTarget: () => void
  onConfirmTarget: () => void
}

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
  if (!members || members.length === 0) {
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

function candidateToFeatureCollection(
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

export function DroneMap({
  dronesById,
  dirtyIds,
  selectedTarget,
  connectedCount,
  commandStatus,
  highlightedCandidate,
  isFetchingCandidates,
  isFetchingFull,
  locationFetchMessage,
  onTargetSelect,
  onFetchLocation,
  onCancelTarget,
  onConfirmTarget,
}: DroneMapProps) {
  const { containerRef, map } = useDroneMap(onTargetSelect)
  const targetPoint = useProjectedTarget(map, selectedTarget)

  useDroneMarkers({
    map,
    dronesById,
    dirtyIds,
  })

  useEffect(() => {
    if (!map) {
      return
    }

    const ensureHighlightLayers = () => {
      if (!map.getSource(highlightSourceId)) {
        map.addSource(highlightSourceId, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        })
      }

      if (!map.getLayer(highlightFillLayerId)) {
        map.addLayer({
          id: highlightFillLayerId,
          type: 'fill',
          source: highlightSourceId,
          paint: {
            'fill-color': '#ff6a00',
            'fill-opacity': 0.12,
          },
        })
      }

      if (!map.getLayer(highlightLineLayerId)) {
        map.addLayer({
          id: highlightLineLayerId,
          type: 'line',
          source: highlightSourceId,
          paint: {
            'line-color': '#ff6a00',
            'line-width': 4,
          },
        })
      }
    }

    const onLoad = () => {
      ensureHighlightLayers()
    }

    if (map.isStyleLoaded()) {
      ensureHighlightLayers()
    } else {
      map.once('load', onLoad)
    }

    return () => {
      map.off('load', onLoad)
      if (map.getLayer(highlightLineLayerId)) {
        map.removeLayer(highlightLineLayerId)
      }
      if (map.getLayer(highlightFillLayerId)) {
        map.removeLayer(highlightFillLayerId)
      }
      if (map.getSource(highlightSourceId)) {
        map.removeSource(highlightSourceId)
      }
    }
  }, [map])

  useEffect(() => {
    if (!map || !map.getSource(highlightSourceId)) {
      return
    }

    const source = map.getSource(highlightSourceId) as GeoJSONSource
    source.setData(candidateToFeatureCollection(highlightedCandidate))
  }, [highlightedCandidate, map])

  return (
    <div className="drone-map relative h-full min-h-[420px] overflow-hidden bg-slate-900 lg:min-h-0">
      <div ref={containerRef} className="absolute inset-0" aria-label="Drone map" />
      <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border border-white/20 bg-slate-950/80 px-3 py-2 text-sm text-white shadow-lg backdrop-blur">
        Click map to set target for connected drones
      </div>
      {selectedTarget ? (
        <TargetCommandPopover
          target={selectedTarget}
          point={targetPoint}
          connectedCount={connectedCount}
          status={commandStatus}
          onFetchLocation={onFetchLocation}
          isFetchingCandidates={isFetchingCandidates}
          isFetchingFull={isFetchingFull}
          locationFetchMessage={locationFetchMessage}
          onCancel={onCancelTarget}
          onConfirm={onConfirmTarget}
        />
      ) : null}
    </div>
  )
}
