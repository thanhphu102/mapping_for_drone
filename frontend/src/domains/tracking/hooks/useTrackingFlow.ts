import { useCallback, useEffect, useRef, useState } from 'react'
import type { DroneState } from '../../drone/types'
import type { SaveTrackedRouteResponse, TrackingStatus } from '../types'

export interface TrackingFlowNotice {
  tone: 'success' | 'error' | 'info'
  title: string
  detail?: string
}

interface TrackingController {
  startTracking: (droneId: string) => void
  stopTracking: () => void
  clearTracking: () => void
  saveTrackingRoute: () => Promise<SaveTrackedRouteResponse>
}

export interface TrackingFlowState {
  status: TrackingStatus
  pointsCount: number
  maxPoints: number
  canSave: boolean
  isSaving: boolean
  activeDroneId: string | null
}

interface UseTrackingFlowOptions {
  connectedDrones: DroneState[]
  hasSelectedTarget: boolean
  onCancelTarget: () => void
  onNotice: (notice: TrackingFlowNotice) => void
}

const initialTrackingState: TrackingFlowState = {
  status: 'idle',
  pointsCount: 0,
  maxPoints: 10_000,
  canSave: false,
  isSaving: false,
  activeDroneId: null,
}

export function useTrackingFlow({
  connectedDrones,
  hasSelectedTarget,
  onCancelTarget,
  onNotice,
}: UseTrackingFlowOptions) {
  const [selectedTrackingDroneId, setSelectedTrackingDroneId] = useState<string | null>(null)
  const [trackingState, setTrackingState] = useState<TrackingFlowState>(
    initialTrackingState,
  )
  const trackingControllerRef = useRef<TrackingController | null>(null)

  const handleTrackingStateChange = useCallback((nextState: TrackingFlowState) => {
    setTrackingState(nextState)
  }, [])

  const handleTrackingControllerReady = useCallback((controller: TrackingController | null) => {
    trackingControllerRef.current = controller
  }, [])

  const handleSelectDroneForTracking = useCallback((droneId: string) => {
    if (selectedTrackingDroneId === droneId) return
    if (trackingState.status === 'tracking') {
      const ok = window.confirm('Tracking is active. Stop current tracking and switch drone?')
      if (!ok) return
      trackingControllerRef.current?.stopTracking()
    }
    setSelectedTrackingDroneId(droneId)
  }, [selectedTrackingDroneId, trackingState.status])

  const handleStartTracking = useCallback(() => {
    const fallbackDroneId = connectedDrones[0]?.id ?? null
    const trackingDroneId = selectedTrackingDroneId ?? fallbackDroneId

    if (!trackingDroneId) {
      onNotice({
        tone: 'info',
        title: 'No connected drone',
        detail: 'Connect at least one drone before starting route tracking.',
      })
      return
    }
    if (!selectedTrackingDroneId) {
      setSelectedTrackingDroneId(trackingDroneId)
      onNotice({
        tone: 'info',
        title: 'Auto-selected drone',
        detail: `Using ${trackingDroneId} for route tracking.`,
      })
    }
    if (hasSelectedTarget) {
      onCancelTarget()
    }
    trackingControllerRef.current?.startTracking(trackingDroneId)
  }, [connectedDrones, hasSelectedTarget, onCancelTarget, onNotice, selectedTrackingDroneId])

  const handleStopTracking = useCallback(() => {
    trackingControllerRef.current?.stopTracking()
  }, [])

  const handleClearTracking = useCallback(() => {
    trackingControllerRef.current?.clearTracking()
  }, [])

  const handleSaveTrackingRoute = useCallback(async () => {
    const controller = trackingControllerRef.current
    if (!controller) return
    try {
      const response = await controller.saveTrackingRoute()
      onNotice({
        tone: 'success',
        title: 'Route saved',
        detail: `Saved ${response.route.pointCount.toLocaleString()} points to ${response.route.path}`,
      })
    } catch (error) {
      onNotice({
        tone: 'error',
        title: 'Save route failed',
        detail: error instanceof Error ? error.message : 'Unable to save route',
      })
    }
  }, [onNotice])

  useEffect(() => {
    if (!selectedTrackingDroneId) return
    const stillConnected = connectedDrones.some((drone) => drone.id === selectedTrackingDroneId)
    if (!stillConnected) {
      onNotice({
        tone: 'info',
        title: 'Selected drone disconnected',
        detail: `Tracking data is kept. "${selectedTrackingDroneId}" is no longer connected.`,
      })
    }
  }, [connectedDrones, onNotice, selectedTrackingDroneId])

  return {
    selectedTrackingDroneId,
    trackingState,
    handleTrackingStateChange,
    handleTrackingControllerReady,
    handleSelectDroneForTracking,
    handleStartTracking,
    handleStopTracking,
    handleClearTracking,
    handleSaveTrackingRoute,
  }
}
