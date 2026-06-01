import { useCallback, useEffect, useRef } from 'react'
import type { Geometry } from 'geojson'
import { AlertTriangle, Loader2, Navigation } from 'lucide-react'
import {
  fitVietnamOverview,
  useBaseMap,
} from '../hooks/useBaseMap'
import { GoogleBaseMapPicker } from './GoogleBaseMapPicker'
import { PUBLISHED_OVERLAY_FLOOR_PANEL_MIN_ZOOM } from '../layers/overlayLayers'
import { useOsmPreviewLayers } from '../hooks/useOsmPreviewLayers'
import { useOverlaySelection } from '../hooks/useOverlaySelection'
import { usePublishedOverlays } from '../hooks/usePublishedOverlays'
import { useDroneMarkers } from '../hooks/useDroneMarkers'
import { useDroneTracking } from '../../tracking/hooks/useDroneTracking'
import { useProjectedTarget } from '../hooks/useProjectedTarget'
import type {
  CommandDispatchStatus,
  CommandTarget,
  DroneRegistry,
  MapTargetDraft,
} from '../../drone/types'
import type { OsmCandidate } from '../../osm/types'
import type { SaveTrackedRouteResponse } from '../../tracking/types'
import { TargetCommandPopover } from '../../drone/components/TargetCommandPopover'

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tagName = target.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true
  }
  return Boolean(target.closest('[contenteditable="true"]'))
}

interface DroneMapProps {
  dronesById: DroneRegistry
  dirtyIds: string[]
  selectedTarget: CommandTarget | null
  connectedCount: number
  commandStatus: CommandDispatchStatus
  highlightedCandidate: OsmCandidate | null
  selectedBoundaryGeometry: Geometry | null
  calibrationDragEnabled?: boolean
  onCalibrationDragDelta?: (deltaLon: number, deltaLat: number) => void
  onCalibrationRotateDelta?: (deltaDeg: number) => void
  previewCalibration?: {
    offsetLon: number
    offsetLat: number
    rotationDeg: number
  } | null
  isFetchingCandidates: boolean
  isFetchingFull: boolean
  locationFetchMessage: { tone: 'success' | 'error' | 'info'; text: string } | null
  onTargetSelect: (target: MapTargetDraft) => void
  onFetchLocation: () => void
  onCancelTarget: () => void
  onConfirmTarget: () => void
  onTrackingNotice: (notice: { tone: 'success' | 'error' | 'info'; title: string; detail?: string }) => void
  selectedTrackingDroneId: string | null
  onTrackingStateChange: (state: {
    status: 'idle' | 'tracking' | 'paused' | 'completed'
    pointsCount: number
    maxPoints: number
    canSave: boolean
    isSaving: boolean
    activeDroneId: string | null
  }) => void
  onTrackingControllerReady: (controller: {
    startTracking: (droneId: string) => void
    stopTracking: () => void
    clearTracking: () => void
    saveTrackingRoute: () => Promise<SaveTrackedRouteResponse>
  } | null) => void
  disableTargetSelect?: boolean
  hideTargetPopover?: boolean
}

export function DroneMap({
  dronesById,
  dirtyIds,
  selectedTarget,
  connectedCount,
  commandStatus,
  highlightedCandidate,
  selectedBoundaryGeometry,
  calibrationDragEnabled = false,
  onCalibrationDragDelta,
  onCalibrationRotateDelta,
  previewCalibration = null,
  isFetchingCandidates,
  isFetchingFull,
  locationFetchMessage,
  onTargetSelect,
  onFetchLocation,
  onCancelTarget,
  onConfirmTarget,
  onTrackingNotice,
  selectedTrackingDroneId,
  onTrackingStateChange,
  onTrackingControllerReady,
  disableTargetSelect = false,
  hideTargetPopover = false,
}: DroneMapProps) {
  const isTrackingRef = useRef(false)
  const stopTrackingRef = useRef<() => void>(() => {})
  const handleMapTargetSelect = useCallback((target: MapTargetDraft) => {
    if (disableTargetSelect) {
      return
    }
    if (isTrackingRef.current) {
      stopTrackingRef.current()
      onTrackingNotice({
        tone: 'info',
        title: 'Tracking stopped',
        detail: 'Left click stops route tracking quickly.',
      })
      return
    }
    onTargetSelect(target)
  }, [disableTargetSelect, onTargetSelect, onTrackingNotice])
  const {
    containerRef,
    map,
    mapStatus,
    baseMapMode,
    setBaseMapMode,
  } = useBaseMap(handleMapTargetSelect)
  const tracking = useDroneTracking({
    map,
    onNotice: onTrackingNotice,
  })
  useEffect(() => {
    stopTrackingRef.current = tracking.stopTracking
  }, [tracking.stopTracking])
  useEffect(() => {
    onTrackingControllerReady({
      startTracking: tracking.startTracking,
      stopTracking: tracking.stopTracking,
      clearTracking: tracking.clearTracking,
      saveTrackingRoute: tracking.saveTrackingRoute,
    })
    return () => onTrackingControllerReady(null)
  }, [
    onTrackingControllerReady,
    tracking.clearTracking,
    tracking.saveTrackingRoute,
    tracking.startTracking,
    tracking.stopTracking,
  ])
  useEffect(() => {
    onTrackingStateChange({
      status: tracking.status,
      pointsCount: tracking.points.length,
      maxPoints: tracking.maxPoints,
      canSave: tracking.canSave,
      isSaving: tracking.isSaving,
      activeDroneId: tracking.droneId,
    })
  }, [
    onTrackingStateChange,
    tracking.canSave,
    tracking.droneId,
    tracking.isSaving,
    tracking.maxPoints,
    tracking.points.length,
    tracking.status,
  ])
  useEffect(() => {
    isTrackingRef.current = tracking.status === 'tracking'
  }, [tracking.status])

  useEffect(() => {
    const handleQuickStop = (event: KeyboardEvent) => {
      if (tracking.status !== 'tracking') {
        return
      }
      if (isEditableEventTarget(event.target)) {
        return
      }
      if (event.key !== 'Enter' && event.key !== '/') {
        return
      }
      event.preventDefault()
      tracking.stopTracking()
      onTrackingNotice({
        tone: 'info',
        title: 'Tracking stopped',
        detail: 'Quick stop via keyboard.',
      })
    }
    window.addEventListener('keydown', handleQuickStop)
    return () => window.removeEventListener('keydown', handleQuickStop)
  }, [onTrackingNotice, tracking])
  const targetPoint = useProjectedTarget(map, selectedTarget)
  const {
    overlayProjects,
    setOverlayProjects,
    selectedOverlayProjectId,
    setSelectedOverlayProjectId,
    selectedOverlayFloorId,
    setSelectedOverlayFloorId,
    overlayZoom,
    setOverlayZoom,
    setOverlayCenter,
    isDeletingOverlayProject,
    setIsDeletingOverlayProject,
    overlayProjectsRef,
    selectedOverlayProjectIdRef,
    selectedOverlayFloorIdRef,
    scheduleOverlayRefreshRef,
    selectedOverlayProject,
    overlayFloors,
    nearestOverlayProjects,
  } = useOverlaySelection()

  const handleFocusVietnam = useCallback(() => {
    if (!map) return
    fitVietnamOverview(map)
  }, [map])

  useDroneMarkers({
    map,
    dronesById,
    dirtyIds,
  })

  const { handleDeleteOverlayProject } = usePublishedOverlays({
    map,
    overlayProjects,
    setOverlayProjects,
    selectedOverlayProjectId,
    selectedOverlayFloorId,
    selectedOverlayProject,
    setSelectedOverlayProjectId,
    setSelectedOverlayFloorId,
    setOverlayZoom,
    setOverlayCenter,
    setIsDeletingOverlayProject,
    overlayProjectsRef,
    selectedOverlayProjectIdRef,
    selectedOverlayFloorIdRef,
    scheduleOverlayRefreshRef,
  })

  useOsmPreviewLayers({
    map,
    highlightedCandidate,
    selectedBoundaryGeometry,
    calibrationDragEnabled,
    onCalibrationDragDelta,
    onCalibrationRotateDelta,
    previewCalibration,
  })

  useEffect(() => {
    if (
      tracking.status === 'tracking' &&
      selectedTrackingDroneId &&
      tracking.droneId &&
      selectedTrackingDroneId !== tracking.droneId
    ) {
      onTrackingNotice({
        tone: 'info',
        title: 'Drone selection changed',
        detail: `Tracking continues for ${tracking.droneId}. Stop tracking before switching active route.`,
      })
    }
  }, [onTrackingNotice, selectedTrackingDroneId, tracking.droneId, tracking.status])

  return (
    <div className="drone-map relative h-full min-h-[420px] overflow-hidden bg-slate-100 lg:min-h-0">
      <div ref={containerRef} className="absolute inset-0" aria-label="Drone map" />
      {mapStatus !== 'ready' ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-white/30 backdrop-blur-[1px]">
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-sm text-slate-800 shadow-xl">
            {mapStatus === 'loading' ? (
              <Loader2 className="size-4 animate-spin text-sky-600" aria-hidden="true" />
            ) : (
              <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />
            )}
            <span>{mapStatus === 'loading' ? 'Loading Vietnam map...' : 'Unable to load map'}</span>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className="absolute left-4 top-4 z-20 inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-900 shadow-lg backdrop-blur transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
        onClick={handleFocusVietnam}
      >
        <Navigation className="size-3.5" aria-hidden="true" />
        Reset view
      </button>
      <GoogleBaseMapPicker
        mode={baseMapMode}
        onChange={setBaseMapMode}
        className="absolute bottom-4 left-4 z-20"
      />
      {overlayZoom >= PUBLISHED_OVERLAY_FLOOR_PANEL_MIN_ZOOM && nearestOverlayProjects.length > 0 ? (
        <div className="absolute left-4 top-16 z-20 w-72 rounded-lg border border-slate-200 bg-white/95 p-2 text-xs text-slate-700 shadow-lg backdrop-blur">
          <div className="mb-2 font-semibold text-slate-900">Saved maps nearby</div>
          <div className="max-h-36 space-y-1 overflow-y-auto border-b border-slate-200 pb-2">
            {nearestOverlayProjects.map((project) => {
              const active = project.id === selectedOverlayProjectId
              return (
                <button
                  key={project.id}
                  type="button"
                  className={`w-full rounded border px-2 py-1 text-left ${
                    active
                      ? 'border-sky-300 bg-sky-50 text-sky-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                  onClick={() => {
                    setSelectedOverlayProjectId(project.id)
                    setSelectedOverlayFloorId(project.floors[0]?.id ?? null)
                  }}
                >
                  {project.name}
                </button>
              )
            })}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            {selectedOverlayProject ? selectedOverlayProject.name : 'Select a map'}
          </div>
          {selectedOverlayProject ? (
            <button
              type="button"
              className="mt-1 w-full rounded border border-rose-300 bg-rose-50 px-2 py-1 text-left text-[11px] text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              onClick={handleDeleteOverlayProject}
              disabled={isDeletingOverlayProject}
            >
              {isDeletingOverlayProject ? 'Deleting...' : 'Delete map'}
            </button>
          ) : null}
          <div className="mt-1 max-h-44 space-y-1 overflow-y-auto">
            {selectedOverlayProject && overlayFloors.length > 0 ? (
              overlayFloors.map((floor) => (
                <button
                  key={floor.id}
                  type="button"
                  className={`w-full rounded border px-2 py-1 text-left ${
                    selectedOverlayFloorId === floor.id
                      ? 'border-sky-300 bg-sky-50 text-sky-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                  onClick={() => setSelectedOverlayFloorId(floor.id)}
                >
                  {floor.label}
                </button>
              ))
            ) : (
              <div className="rounded border border-slate-200 px-2 py-1 text-slate-500">No floor selected</div>
            )}
          </div>
        </div>
      ) : null}
      {selectedTarget && tracking.status !== 'tracking' && !hideTargetPopover ? (
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
