import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { AppShell } from './AppShell'
import { matchSpatialEditorProjectId, openRootRoute } from './routes'
import { useCommandFlow } from '../domains/drone/hooks/useCommandFlow'
import { useDroneTelemetry } from '../domains/drone/hooks/useDroneTelemetry'
import { useOsmSelectionFlow } from '../domains/osm/hooks/useOsmSelectionFlow'
import { useTrackingFlow } from '../domains/tracking/hooks/useTrackingFlow'
import type { DroneState } from '../domains/drone/types'
import type { NoticeState } from '../shared/components/Notice'

const SpatialEditorPage = lazy(
  () => import('../domains/spatial-editor/SpatialEditorPage'),
)

function App() {
  const { snapshot, connectionStatus, connectionMessage } = useDroneTelemetry()
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [currentPath, setCurrentPath] = useState(window.location.pathname)
  const osmFlow = useOsmSelectionFlow()
  const commandFlow = useCommandFlow({
    onNotice: setNotice,
    onTargetSelected: osmFlow.resetForTargetSelection,
    onTargetCleared: osmFlow.resetLocationPanel,
  })
  const spatialEditorProjectId = matchSpatialEditorProjectId(currentPath)

  useEffect(() => {
    const handleRouteChange = () => {
      setCurrentPath(window.location.pathname)
    }
    window.addEventListener('popstate', handleRouteChange)
    return () => window.removeEventListener('popstate', handleRouteChange)
  }, [])

  const connectedDrones = useMemo<DroneState[]>(() => {
    return Object.values(snapshot.dronesById)
      .filter((drone) => drone.status === 'connected')
      .sort((left, right) => left.id.localeCompare(right.id))
  }, [snapshot.dronesById])

  const connectedCount = connectedDrones.length

  const averageBattery = useMemo(() => {
    const numericValues = connectedDrones
      .map((drone) => Number(drone.battery))
      .filter((value) => Number.isFinite(value))

    if (numericValues.length === 0) {
      return '-'
    }

    const total = numericValues.reduce((sum, value) => sum + value, 0)
    return `${(total / numericValues.length).toFixed(1)}%`
  }, [connectedDrones])

  const trackingFlow = useTrackingFlow({
    connectedDrones,
    hasSelectedTarget: commandFlow.selectedTarget !== null,
    onCancelTarget: commandFlow.handleCancelTarget,
    onNotice: setNotice,
  })

  if (spatialEditorProjectId) {
    return (
      <Suspense fallback={<div className="p-4">Loading spatial editor...</div>}>
        <SpatialEditorPage
          projectId={spatialEditorProjectId}
          onBack={openRootRoute}
        />
      </Suspense>
    )
  }

  return (
    <AppShell
      dronesById={snapshot.dronesById}
      dirtyIds={snapshot.dirtyIds}
      connectedDrones={connectedDrones}
      connectedCount={connectedCount}
      averageBattery={averageBattery}
      connectionStatus={connectionStatus}
      connectionMessage={connectionMessage}
      selectedTarget={commandFlow.selectedTarget}
      commandStatus={commandFlow.commandState.status}
      commandMessage={commandFlow.commandState.message}
      sidebarMode={osmFlow.sidebarMode}
      locationFetch={osmFlow.locationFetch}
      locationSelectionMessage={osmFlow.locationSelectionMessage}
      editorModeOverride={osmFlow.editorModeOverride}
      isOpeningEditor={osmFlow.isOpeningEditor}
      confirmedLargeArea={osmFlow.confirmedLargeArea}
      selectedBoundaryGeometry={osmFlow.selectedBoundaryGeometry}
      calibration={osmFlow.calibration}
      previewCalibration={{
        offsetLon: osmFlow.calibration.offsetLon,
        offsetLat: osmFlow.calibration.offsetLat,
        rotationDeg: osmFlow.calibration.rotationDeg,
      }}
      calibrationDragEnabled={osmFlow.calibrationDragEnabled}
      isSavingCalibration={osmFlow.isSavingCalibration}
      selectedTrackingDroneId={trackingFlow.selectedTrackingDroneId}
      trackingState={trackingFlow.trackingState}
      notice={notice}
      onTargetSelect={commandFlow.handleTargetSelect}
      onFetchLocation={() => osmFlow.handleFetchLocation(commandFlow.selectedTarget)}
      onCancelTarget={commandFlow.handleCancelTarget}
      onConfirmTarget={commandFlow.handleConfirmTarget}
      onTrackingNotice={setNotice}
      onTrackingStateChange={trackingFlow.handleTrackingStateChange}
      onTrackingControllerReady={trackingFlow.handleTrackingControllerReady}
      onHoverCandidate={osmFlow.handleCandidateHover}
      onSelectCandidate={osmFlow.handleCandidateSelect}
      onChangeEditorMode={osmFlow.setEditorModeOverride}
      onCalibrationOffsetChange={osmFlow.setCalibrationOffset}
      onCalibrationNudge={osmFlow.nudgeCalibrationByDelta}
      onCalibrationRotateNudge={osmFlow.nudgeCalibrationRotation}
      onResetCalibration={osmFlow.resetCalibrationOffset}
      onSaveCalibrationForCity={osmFlow.saveCalibrationForCity}
      onToggleCalibrationDrag={osmFlow.toggleCalibrationDrag}
      onOpenSpatialEditor={osmFlow.handleOpenSpatialEditor}
      onCloseOsmPanel={osmFlow.handleCloseOsmPanel}
      onSelectTrackingDrone={trackingFlow.handleSelectDroneForTracking}
      onStartTracking={trackingFlow.handleStartTracking}
      onStopTracking={trackingFlow.handleStopTracking}
      onSaveTrackingRoute={trackingFlow.handleSaveTrackingRoute}
      onClearTracking={trackingFlow.handleClearTracking}
      onDismissNotice={() => setNotice(null)}
    />
  )
}

export default App
