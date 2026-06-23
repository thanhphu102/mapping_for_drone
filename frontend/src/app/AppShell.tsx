import { ChevronLeft, ChevronRight, MapPinned, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useState } from 'react'
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
import type { Geometry } from 'geojson'
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
  selectedBoundaryGeometry: Geometry | null
  calibration: {
    cityKey: string | null
    cityLabel: string | null
    offsetLon: number
    offsetLat: number
    rotationDeg: number
    isDirty: boolean
  }
  previewCalibration: {
    offsetLon: number
    offsetLat: number
    rotationDeg: number
  } | null
  calibrationDragEnabled: boolean
  isSavingCalibration: boolean
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
  onChangeEditorMode: (mode: EditorMode | null) => void
  onCalibrationOffsetChange: (field: 'offsetLon' | 'offsetLat' | 'rotationDeg', value: number) => void
  onCalibrationNudge: (deltaLon: number, deltaLat: number) => void
  onCalibrationRotateNudge: (deltaDeg: number) => void
  onResetCalibration: () => void
  onSaveCalibrationForCity: () => void
  onToggleCalibrationDrag: () => void
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
  selectedBoundaryGeometry,
  calibration,
  previewCalibration,
  calibrationDragEnabled,
  isSavingCalibration,
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
  onChangeEditorMode,
  onCalibrationOffsetChange,
  onCalibrationNudge,
  onCalibrationRotateNudge,
  onResetCalibration,
  onSaveCalibrationForCity,
  onToggleCalibrationDrag,
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
      selectedEditorMode={editorModeOverride}
      status={locationFetch.message}
      isOpeningEditor={isOpeningEditor}
      confirmedLargeArea={confirmedLargeArea}
      calibration={calibration}
      calibrationDragEnabled={calibrationDragEnabled}
      isSavingCalibration={isSavingCalibration}
      onHoverCandidate={onHoverCandidate}
      onSelectCandidate={onSelectCandidate}
      onChangeEditorMode={onChangeEditorMode}
      onCalibrationOffsetChange={onCalibrationOffsetChange}
      onResetCalibration={onResetCalibration}
      onSaveCalibrationForCity={onSaveCalibrationForCity}
      onToggleCalibrationDrag={onToggleCalibrationDrag}
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
                Drones
              </h2>
              <p className="text-sm text-slate-500">
                Select a drone to track or review.
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

        <details className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            Status details
          </summary>
          <section
            className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-950">
                Command
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
        </details>
      </div>
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
            calibrationDragEnabled={calibrationDragEnabled}
            onCalibrationDragDelta={onCalibrationNudge}
            onCalibrationRotateDelta={onCalibrationRotateNudge}
            previewCalibration={previewCalibration}
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
            disableTargetSelect={calibrationDragEnabled}
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
