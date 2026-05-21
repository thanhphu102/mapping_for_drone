import { Activity, MapPinned } from 'lucide-react'
import { DroneMap } from '../domains/map/components/DroneMap'
import { DroneTable } from '../domains/drone/components/DroneTable'
import { DroneTrackingControls } from '../domains/tracking/components/DroneTrackingControls'
import { Notice, type NoticeState } from '../shared/components/Notice'
import { OsmEnclosingPanel } from '../domains/osm/components/OsmEnclosingPanel'
import { StatusStrip } from '../domains/drone/components/StatusStrip'
import type { LocationFetchState, SidebarMode } from '../domains/osm/hooks/useOsmSelectionFlow'
import type { TrackingFlowState } from '../domains/tracking/hooks/useTrackingFlow'
import type {
  CommandDispatchStatus,
  CommandTarget,
  ConnectionStatus,
  DroneRegistry,
  DroneState,
  MapTargetDraft,
} from '../domains/drone/types'
import type {
  OsmCandidate,
  OsmElementGeometryResponse,
} from '../domains/osm/types'
import type { EditorMode } from '../domains/spatial-editor/types'
import type { SaveTrackedRouteResponse } from '../domains/tracking/types'

interface AppShellProps {
  dronesById: DroneRegistry
  dirtyIds: string[]
  connectedDrones: DroneState[]
  connectedCount: number
  averageBattery: string
  connectionStatus: ConnectionStatus
  connectionMessage: string
  selectedTarget: CommandTarget | null
  commandStatus: CommandDispatchStatus
  commandMessage: string
  sidebarMode: SidebarMode
  locationFetch: LocationFetchState
  locationSelectionMessage: string | null
  editorModeOverride: EditorMode | null
  isOpeningEditor: boolean
  confirmedLargeArea: boolean
  selectedTrackingDroneId: string | null
  trackingState: TrackingFlowState
  notice: NoticeState | null
  onTargetSelect: (target: MapTargetDraft) => void
  onFetchLocation: () => void
  onCancelTarget: () => void
  onConfirmTarget: () => void
  onTrackingNotice: (notice: NoticeState) => void
  onTrackingStateChange: (state: TrackingFlowState) => void
  onTrackingControllerReady: (
    controller: {
      startTracking: (droneId: string) => void
      stopTracking: () => void
      clearTracking: () => void
      saveTrackingRoute: () => Promise<SaveTrackedRouteResponse>
    } | null
  ) => void
  onHoverCandidate: (candidate: OsmCandidate | null) => void
  onSelectCandidate: (candidate: OsmCandidate) => void
  onChangeEditorMode: (mode: EditorMode | null) => void
  onOpenSpatialEditor: () => void
  onCloseOsmPanel: () => void
  onSelectTrackingDrone: (droneId: string) => void
  onStartTracking: () => void
  onStopTracking: () => void
  onSaveTrackingRoute: () => void
  onClearTracking: () => void
  onDismissNotice: () => void
}

function commandStatusLabel(status: CommandDispatchStatus) {
  if (status === 'sending') {
    return 'Sending'
  }

  if (status === 'success') {
    return 'Sent'
  }

  if (status === 'error') {
    return 'Error'
  }

  return 'Ready'
}

export function AppShell({
  dronesById,
  dirtyIds,
  connectedDrones,
  connectedCount,
  averageBattery,
  connectionStatus,
  connectionMessage,
  selectedTarget,
  commandStatus,
  commandMessage,
  sidebarMode,
  locationFetch,
  locationSelectionMessage,
  editorModeOverride,
  isOpeningEditor,
  confirmedLargeArea,
  selectedTrackingDroneId,
  trackingState,
  notice,
  onTargetSelect,
  onFetchLocation,
  onCancelTarget,
  onConfirmTarget,
  onTrackingNotice,
  onTrackingStateChange,
  onTrackingControllerReady,
  onHoverCandidate,
  onSelectCandidate,
  onChangeEditorMode,
  onOpenSpatialEditor,
  onCloseOsmPanel,
  onSelectTrackingDrone,
  onStartTracking,
  onStopTracking,
  onSaveTrackingRoute,
  onClearTracking,
  onDismissNotice,
}: AppShellProps) {
  return (
    <div className="min-h-screen h-dvh bg-slate-100 text-slate-950">
      <div className="flex h-full flex-col lg:flex-row">
        <main className="relative min-h-0 flex-1">
          <DroneMap
            dronesById={dronesById}
            dirtyIds={dirtyIds}
            selectedTarget={selectedTarget}
            connectedCount={connectedCount}
            commandStatus={commandStatus}
            highlightedCandidate={locationFetch.highlightedCandidate}
            selectedBoundaryGeometry={locationFetch.selectedGeometry?.geometry ?? null}
            isFetchingCandidates={locationFetch.status === 'loading_candidates'}
            isFetchingFull={locationFetch.status === 'loading_full'}
            locationFetchMessage={locationFetch.message}
            onTargetSelect={onTargetSelect}
            onFetchLocation={onFetchLocation}
            onCancelTarget={onCancelTarget}
            onConfirmTarget={onConfirmTarget}
            onTrackingNotice={onTrackingNotice}
            selectedTrackingDroneId={selectedTrackingDroneId}
            onTrackingStateChange={onTrackingStateChange}
            onTrackingControllerReady={onTrackingControllerReady}
          />
        </main>

        <aside className="flex max-h-[45dvh] w-full flex-col border-t border-slate-200 bg-slate-50 lg:h-full lg:max-h-none lg:w-[460px] lg:border-l lg:border-t-0">
          {sidebarMode === 'osmEnclosing' ? (
            <OsmEnclosingPanel
              target={selectedTarget}
              candidates={locationFetch.candidates}
              selectedCandidate={locationFetch.selectedCandidate}
              highlightedCandidate={locationFetch.highlightedCandidate}
              selectedGeometry={locationFetch.selectedGeometry as OsmElementGeometryResponse | null}
              selectedEditorMode={editorModeOverride}
              status={locationFetch.message}
              isOpeningEditor={isOpeningEditor}
              confirmedLargeArea={confirmedLargeArea}
              onHoverCandidate={onHoverCandidate}
              onSelectCandidate={onSelectCandidate}
              onChangeEditorMode={onChangeEditorMode}
              onOpenSpatialEditor={onOpenSpatialEditor}
              onClose={onCloseOsmPanel}
            />
          ) : (
            <>
              <div className="border-b border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-sky-700">
                      <MapPinned className="size-4" aria-hidden="true" />
                      Swarm GSC
                    </div>
                    <h1 className="mt-1 text-xl font-semibold text-slate-950">
                      Vietnam Drone Control
                    </h1>
                    <p className="mt-1 text-sm text-slate-500">
                      Flight coordination and field mapping
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">
                    <Activity className="size-5" aria-hidden="true" />
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                <StatusStrip
                  connectionStatus={connectionStatus}
                  connectionMessage={connectionMessage}
                  connectedCount={connectedCount}
                  averageBattery={averageBattery}
                  commandStatus={commandStatus}
                />

                <section aria-labelledby="drone-table-heading">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2
                        id="drone-table-heading"
                        className="text-sm font-semibold text-slate-950"
                      >
                        Connected Drones
                      </h2>
                      <p className="text-sm text-slate-500">
                        Live position and battery telemetry
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      Live
                    </span>
                  </div>

                  <DroneTable
                    drones={connectedDrones}
                    isTelemetryOpen={connectionStatus === 'open'}
                    selectedTrackingDroneId={selectedTrackingDroneId}
                    onSelectTrackingDrone={onSelectTrackingDrone}
                  />
                </section>

                <DroneTrackingControls
                  selectedDroneId={selectedTrackingDroneId}
                  status={trackingState.status}
                  pointsCount={trackingState.pointsCount}
                  maxPoints={trackingState.maxPoints}
                  canSave={trackingState.canSave}
                  isSaving={trackingState.isSaving}
                  onStart={onStartTracking}
                  onStop={onStopTracking}
                  onSave={onSaveTrackingRoute}
                  onClear={onClearTracking}
                />

                <section
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                  aria-live="polite"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-slate-950">
                      Command Status
                    </h2>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600">
                      {commandStatusLabel(commandStatus)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {commandMessage}
                  </p>
                  {locationSelectionMessage ? (
                    <p className="mt-2 text-sm font-medium text-emerald-700">
                      {locationSelectionMessage}
                    </p>
                  ) : null}
                </section>
              </div>
            </>
          )}
        </aside>
      </div>

      <Notice notice={notice} onDismiss={onDismissNotice} />
    </div>
  )
}
