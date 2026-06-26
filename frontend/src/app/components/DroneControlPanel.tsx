import { DroneTable } from '../../domains/drone/components/DroneTable'
import { DroneTrackingControls } from '../../domains/tracking/components/DroneTrackingControls'
import { StatusStrip } from '../../domains/drone/components/StatusStrip'
import type {
  CommandDispatchStatus,
  ConnectionStatus,
  DroneState,
} from '../../domains/drone/types'
import type { TrackingFlowState } from '../../domains/tracking/hooks/useTrackingFlow'

interface DroneControlPanelProps {
  connectedDrones: DroneState[]
  connectedCount: number
  averageBattery: string
  connectionStatus: ConnectionStatus
  connectionMessage: string
  commandStatus: CommandDispatchStatus
  commandMessage: string
  locationSelectionMessage: string | null
  selectedTrackingDroneId: string | null
  trackingState: TrackingFlowState
  onSelectTrackingDrone: (droneId: string) => void
  onStartTracking: () => void
  onStopTracking: () => void
  onSaveTrackingRoute: () => void
  onClearTracking: () => void
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

export function DroneControlPanel({
  connectedDrones,
  connectedCount,
  averageBattery,
  connectionStatus,
  connectionMessage,
  commandStatus,
  commandMessage,
  locationSelectionMessage,
  selectedTrackingDroneId,
  trackingState,
  onSelectTrackingDrone,
  onStartTracking,
  onStopTracking,
  onSaveTrackingRoute,
  onClearTracking,
}: DroneControlPanelProps) {
  return (
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
  )
}
