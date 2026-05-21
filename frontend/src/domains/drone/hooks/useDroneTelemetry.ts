import { useCallback, useEffect, useRef, useState } from 'react'
import { createFrontendWebSocket } from '../services/realtime'
import type {
  ConnectionStatus,
  DroneRegistry,
  DroneState,
  DroneTelemetryPayload,
  FrontendEvent,
  TelemetrySnapshot,
} from '../types'

function initialSnapshot(): TelemetrySnapshot {
  return {
    dronesById: {},
    dirtyIds: [],
    version: 0,
  }
}

function asNumber(value: unknown, fallback: number) {
  const normalized = value || fallback
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asPayload(value: unknown): DroneTelemetryPayload {
  return value && typeof value === 'object'
    ? (value as DroneTelemetryPayload)
    : {}
}

function updateTelemetryState(
  dronesById: DroneRegistry,
  droneId: string,
  payload: DroneTelemetryPayload,
): DroneState {
  const current = dronesById[droneId] ?? { id: droneId, status: 'connected' }
  const next: DroneState = {
    ...current,
    id: droneId,
    status: 'connected',
    lat: asNumber(payload.lat, 0),
    lon: asNumber(payload.lon, 0),
    battery: payload.battery || 'N/A',
    lastSeen: Date.now(),
  }

  if (payload.alt !== undefined) {
    next.alt = payload.alt
  }

  dronesById[droneId] = next
  return next
}

export function useDroneTelemetry() {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>(initialSnapshot)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  const [connectionMessage, setConnectionMessage] = useState(
    'Connecting to telemetry stream',
  )

  const dronesRef = useRef<DroneRegistry>({})
  const dirtyIdsRef = useRef<Set<string>>(new Set())
  const animationFrameRef = useRef<number | null>(null)
  const versionRef = useRef(0)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)

  const flushSnapshot = useCallback(() => {
    animationFrameRef.current = null

    const dirtyIds = Array.from(dirtyIdsRef.current)
    dirtyIdsRef.current.clear()

    if (dirtyIds.length === 0) {
      return
    }

    versionRef.current += 1
    setSnapshot({
      dronesById: { ...dronesRef.current },
      dirtyIds,
      version: versionRef.current,
    })
  }, [])

  const scheduleSnapshot = useCallback(
    (droneId: string) => {
      dirtyIdsRef.current.add(droneId)

      if (animationFrameRef.current !== null) {
        return
      }

      animationFrameRef.current = window.requestAnimationFrame(flushSnapshot)
    },
    [flushSnapshot],
  )

  useEffect(() => {
    let active = true
    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const scheduleReconnect = () => {
      if (!active || reconnectTimerRef.current !== null) {
        return
      }

      const attempt = reconnectAttemptRef.current
      const delay = Math.min(1000 * 2 ** attempt, 10000)
      reconnectAttemptRef.current += 1

      setConnectionStatus('connecting')
      setConnectionMessage(`Reconnecting telemetry stream in ${Math.ceil(delay / 1000)}s`)

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        connect()
      }, delay)
    }

    const connect = () => {
      if (!active) {
        return
      }

      clearReconnectTimer()
      setConnectionStatus('connecting')
      setConnectionMessage('Connecting to telemetry stream')

      const socket = createFrontendWebSocket()
      socketRef.current = socket

      socket.onopen = () => {
        if (!active) {
          return
        }

        reconnectAttemptRef.current = 0
        setConnectionStatus('open')
        setConnectionMessage('Telemetry stream connected')
      }

      socket.onerror = () => {
        if (!active) {
          return
        }

        setConnectionStatus('error')
        setConnectionMessage('Telemetry stream error')
      }

      socket.onclose = () => {
        if (!active) {
          return
        }

        setConnectionStatus((current) => (current === 'error' ? current : 'closed'))
        setConnectionMessage('Telemetry stream closed')
        scheduleReconnect()
      }

      socket.onmessage = (event) => {
        if (!active) {
          return
        }

        try {
          const message = JSON.parse(event.data as string) as FrontendEvent

          if (message.type === 'telemetry') {
            updateTelemetryState(
              dronesRef.current,
              message.drone_id,
              asPayload(message.payload),
            )
            scheduleSnapshot(message.drone_id)
            return
          }

          if (message.type === 'connect') {
            const current = dronesRef.current[message.drone_id]
            dronesRef.current[message.drone_id] = {
              ...current,
              id: message.drone_id,
              status: 'connected',
            }
            scheduleSnapshot(message.drone_id)
            return
          }

          if (message.type === 'disconnect') {
            const current = dronesRef.current[message.drone_id]
            if (current) {
              dronesRef.current[message.drone_id] = {
                ...current,
                status: 'disconnected',
              }
            }
            scheduleSnapshot(message.drone_id)
            return
          }

          if (message.type === 'command_sent') {
            console.info('Command sent to:', message.to ?? [])
          }
        } catch (error) {
          console.error('WebSocket parse error:', error)
          setConnectionMessage('Telemetry message parse error')
        }
      }
    }

    connect()

    return () => {
      active = false
      clearReconnectTimer()

      if (socketRef.current) {
        socketRef.current.onopen = null
        socketRef.current.onclose = null
        socketRef.current.onerror = null
        socketRef.current.onmessage = null
        socketRef.current.close()
        socketRef.current = null
      }

      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [scheduleSnapshot])

  return {
    snapshot,
    connectionStatus,
    connectionMessage,
  }
}
