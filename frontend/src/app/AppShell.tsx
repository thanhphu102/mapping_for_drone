import { ChevronLeft, ChevronRight, MapPinned, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useState } from 'react'
import { DroneMap } from '../domains/map/components/DroneMap'
import { Notice, type NoticeState } from '../shared/components/Notice'
import { OsmEnclosingPanel } from '../domains/osm/components/OsmEnclosingPanel'
import { DroneControlPanel } from './components/DroneControlPanel'
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
import type { Geometry } from 'geojson'
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
  isOpeningEditor: boolean
  confirmedLargeArea: boolean
  selectedBoundaryGeometry: Geometry | null
  selectedTrackingDroneId: string | null
  trackingState: TrackingFlowState
  notice: NoticeState | null
  onTargetSelect: (target: MapTargetDraft) => void
  onFetchLocation: () => void
  onCancelTarget: () => void
  onConfirmTarget: () => void
  onTrackingNotice: (notice: NoticeState) => void
  onGeofenceBreach: (notice: NoticeState) => void
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
  onOpenSpatialEditor: () => void
  onCloseOsmPanel: () => void
  onSelectTrackingDrone: (droneId: string) => void
  onStartTracking: () => void
  onStopTracking: () => void
  onSaveTrackingRoute: () => void
  onClearTracking: () => void
  onDismissNotice: () => void
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
  isOpeningEditor,
  confirmedLargeArea,
  selectedBoundaryGeometry,
  selectedTrackingDroneId,
  trackingState,
  notice,
  onTargetSelect,
  onFetchLocation,
  onCancelTarget,
  onConfirmTarget,
  onTrackingNotice,
  onGeofenceBreach,
  onTrackingStateChange,
  onTrackingControllerReady,
  onHoverCandidate,
  onSelectCandidate,
  onOpenSpatialEditor,
  onCloseOsmPanel,
  onSelectTrackingDrone,
  onStartTracking,
  onStopTracking,
  onSaveTrackingRoute,
  onClearTracking,
  onDismissNotice,
}: AppShellProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false)

  const isDesktopCollapsed = sidebarMode === 'osmEnclosing' ? false : desktopSidebarCollapsed
  const isMobileDrawerOpen = sidebarMode === 'osmEnclosing' ? true : mobileSidebarOpen

  const sidebarContent = sidebarMode === 'osmEnclosing' ? (
    <OsmEnclosingPanel
      target={selectedTarget}
      candidates={locationFetch.candidates}
      selectedCandidate={locationFetch.selectedCandidate}
      highlightedCandidate={locationFetch.highlightedCandidate}
      selectedGeometry={locationFetch.selectedGeometry as OsmElementGeometryResponse | null}
      status={locationFetch.message}
      isOpeningEditor={isOpeningEditor}
      confirmedLargeArea={confirmedLargeArea}
      onHoverCandidate={onHoverCandidate}
      onSelectCandidate={onSelectCandidate}
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
              Drone map
            </div>
            <h1 className="mt-1 text-xl font-semibold text-slate-950">
              Flight control
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Choose a drone, pick a point on the map, then fetch or edit an area.
            </p>
          </div>
        </div>
      </div>

      <DroneControlPanel
        connectedDrones={connectedDrones}
        connectedCount={connectedCount}
        averageBattery={averageBattery}
        connectionStatus={connectionStatus}
        connectionMessage={connectionMessage}
        commandStatus={commandStatus}
        commandMessage={commandMessage}
        locationSelectionMessage={locationSelectionMessage}
        selectedTrackingDroneId={selectedTrackingDroneId}
        trackingState={trackingState}
        onSelectTrackingDrone={onSelectTrackingDrone}
        onStartTracking={onStartTracking}
        onStopTracking={onStopTracking}
        onSaveTrackingRoute={onSaveTrackingRoute}
        onClearTracking={onClearTracking}
      />
    </>
  )

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
            selectedBoundaryGeometry={selectedBoundaryGeometry}
            isFetchingCandidates={locationFetch.status === 'loading_candidates'}
            isFetchingFull={locationFetch.status === 'loading_full'}
            locationFetchMessage={locationFetch.message}
            onTargetSelect={onTargetSelect}
            onFetchLocation={onFetchLocation}
            onCancelTarget={onCancelTarget}
            onConfirmTarget={onConfirmTarget}
            onTrackingNotice={onTrackingNotice}
            onGeofenceBreach={onGeofenceBreach}
            selectedTrackingDroneId={selectedTrackingDroneId}
            onTrackingStateChange={onTrackingStateChange}
            onTrackingControllerReady={onTrackingControllerReady}
            hideTargetPopover={sidebarMode === 'osmEnclosing'}
          />
          <button
            type="button"
            className="absolute right-4 top-4 z-30 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-lg lg:hidden"
            onClick={() => setMobileSidebarOpen(true)}
          >
            <PanelRightOpen className="size-3.5" />
            Panel
          </button>
        </main>

        <aside
          className={`relative hidden border-l border-slate-200 bg-slate-50 transition-[width] duration-200 ease-out lg:block ${
            isDesktopCollapsed ? 'w-[22px]' : 'w-[380px] xl:w-[400px]'
          }`}
        >
          <button
            type="button"
            className="absolute left-0 top-1/2 z-20 flex h-14 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-sky-300 hover:text-sky-700"
            onClick={() => setDesktopSidebarCollapsed((current) => !current)}
            aria-label={isDesktopCollapsed ? 'Open panel' : 'Collapse panel'}
          >
            {isDesktopCollapsed ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          {isDesktopCollapsed ? null : (
            <div className="h-full overflow-hidden">{sidebarContent}</div>
          )}
        </aside>
      </div>

      {isMobileDrawerOpen ? (
        <div className="fixed inset-0 z-40 bg-slate-900/35 lg:hidden" onClick={() => setMobileSidebarOpen(false)}>
          <aside
            className="absolute right-0 top-0 flex h-full w-[92vw] max-w-[420px] flex-col border-l border-slate-200 bg-slate-50 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-200 bg-white px-3 py-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                onClick={() => setMobileSidebarOpen(false)}
              >
                <PanelRightClose className="size-3.5" />
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{sidebarContent}</div>
          </aside>
        </div>
      ) : null}

      <Notice notice={notice} onDismiss={onDismissNotice} />
    </div>
  )
}
