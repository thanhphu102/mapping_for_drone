export interface TrackingPoint {
  lng: number
  lat: number
  timestamp: number
}

export type TrackingStatus = 'idle' | 'tracking' | 'paused' | 'completed'

export type TrackingSource = 'mouse_simulation' | 'drone_gps'

export interface TrackingRoute {
  id?: string
  name: string
  status: TrackingStatus
  droneId: string
  source: TrackingSource
  points: TrackingPoint[]
}

export interface TrackingLineStringGeometry {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface SaveTrackedRouteRequest {
  name: string
  droneId: string
  source: TrackingSource
  geometry: TrackingLineStringGeometry
  points: TrackingPoint[]
}

export interface SaveTrackedRouteResponse {
  ok: boolean
  route: {
    id: string
    name: string
    droneId: string
    source: TrackingSource
    path: string
    savedAt: number
    pointCount: number
  }
}

