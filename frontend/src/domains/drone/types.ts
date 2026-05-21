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

