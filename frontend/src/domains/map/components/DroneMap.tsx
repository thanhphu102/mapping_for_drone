import { useCallback, useEffect, useRef } from 'react'
import type { Geometry } from 'geojson'
import { AlertTriangle, Loader2, MapPinned, Navigation } from 'lucide-react'
import {
  fitVietnamOverview,
  useBaseMap,
} from '../hooks/useBaseMap'
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

interface DroneMapProps {
  dronesById: DroneRegistry
  dirtyIds: string[]
  selectedTarget: CommandTarget | null
  connectedCount: number
  commandStatus: CommandDispatchStatus
  highlightedCandidate: OsmCandidate | null
  selectedBoundaryGeometry: Geometry | null
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
}

export function DroneMap({
  dronesById,
  dirtyIds,
  selectedTarget,
  connectedCount,
  commandStatus,
  highlightedCandidate,
  selectedBoundaryGeometry,
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
}: DroneMapProps) {
  const isTrackingRef = useRef(false)
  const handleMapTargetSelect = useCallback((target: MapTargetDraft) => {
    if (isTrackingRef.current) {
      return
    }
    onTargetSelect(target)
  }, [onTargetSelect])
  const { containerRef, map, mapStatus } = useBaseMap(handleMapTargetSelect)
  const tracking = useDroneTracking({
    map,
    onNotice: onTrackingNotice,
  })
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
    <div className="drone-map relative h-full min-h-[420px] overflow-hidden bg-slate-900 lg:min-h-0">
      <div ref={containerRef} className="absolute inset-0" aria-label="Drone map" />
      {mapStatus !== 'ready' ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-slate-950/20 backdrop-blur-[1px]">
          <div className="flex items-center gap-3 rounded-lg border border-white/20 bg-slate-950/85 px-4 py-3 text-sm text-white shadow-xl">
            {mapStatus === 'loading' ? (
              <Loader2 className="size-4 animate-spin text-sky-300" aria-hidden="true" />
            ) : (
              <AlertTriangle className="size-4 text-amber-300" aria-hidden="true" />
            )}
            <span>{mapStatus === 'loading' ? 'Loading Vietnam map...' : 'Unable to load map'}</span>
          </div>
        </div>
      ) : null}
      <div className="pointer-events-none absolute left-4 top-4 z-20 max-w-[min(26rem,calc(100%-2rem))] rounded-lg border border-white/20 bg-slate-950/82 px-3 py-2 text-sm text-white shadow-lg backdrop-blur">
        <div className="flex items-center gap-2 font-semibold">
          <MapPinned className="size-4 text-sky-300" aria-hidden="true" />
          <span>Vietnam operations map</span>
        </div>
        <div className="mt-1 text-xs text-slate-200">
          {tracking.status === 'tracking'
            ? 'Tracking active. Map click target selection is disabled.'
            : 'Click map to set target for connected drones.'}
        </div>
      </div>
      <button
        type="button"
        className="absolute left-4 top-20 z-20 inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-900 shadow-lg backdrop-blur transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
        onClick={handleFocusVietnam}
      >
        <Navigation className="size-3.5" aria-hidden="true" />
        Focus Vietnam
      </button>
      {overlayZoom >= PUBLISHED_OVERLAY_FLOOR_PANEL_MIN_ZOOM && nearestOverlayProjects.length > 0 ? (
        <div className="absolute left-4 top-32 z-20 w-72 rounded-lg border border-white/20 bg-slate-950/85 p-2 text-xs text-white shadow-lg backdrop-blur">
          <div className="mb-1 font-semibold text-sky-200">Spatial Maps</div>
          <div className="mb-2 text-[11px] text-slate-300">Nearest maps first</div>
          <div className="max-h-36 space-y-1 overflow-y-auto border-b border-white/10 pb-2">
            {nearestOverlayProjects.map((project) => {
              const active = project.id === selectedOverlayProjectId
              return (
                <button
                  key={project.id}
                  type="button"
                  className={`w-full rounded border px-2 py-1 text-left ${
                    active
                      ? 'border-sky-400/60 bg-sky-500/25 text-sky-100'
                      : 'border-white/15 bg-slate-900/80 text-slate-200 hover:text-white'
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
          <div className="mt-2 text-[11px] text-slate-300">
            {selectedOverlayProject ? selectedOverlayProject.name : 'Select a building'}
          </div>
          {selectedOverlayProject ? (
            <button
              type="button"
              className="mt-1 w-full rounded border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-left text-[11px] text-rose-100 hover:bg-rose-500/25 disabled:opacity-50"
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
                      ? 'border-sky-400/60 bg-sky-500/25 text-sky-100'
                      : 'border-white/15 bg-slate-900/80 text-slate-200 hover:text-white'
                  }`}
                  onClick={() => setSelectedOverlayFloorId(floor.id)}
                >
                  {floor.label} <span className="text-[10px] text-slate-400">{floor.code}</span>
                </button>
              ))
            ) : (
              <div className="rounded border border-white/10 px-2 py-1 text-slate-300">No floor selected</div>
            )}
          </div>
        </div>
      ) : null}
      {selectedTarget && tracking.status !== 'tracking' ? (
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
