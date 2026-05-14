import { useDroneMap } from '../hooks/useDroneMap'
import { useDroneMarkers } from '../hooks/useDroneMarkers'
import { useProjectedTarget } from '../hooks/useProjectedTarget'
import type {
  CommandDispatchStatus,
  CommandTarget,
  DroneRegistry,
  MapTargetDraft,
} from '../types/drone'
import { TargetCommandPopover } from './TargetCommandPopover'

interface DroneMapProps {
  dronesById: DroneRegistry
  dirtyIds: string[]
  selectedTarget: CommandTarget | null
  connectedCount: number
  commandStatus: CommandDispatchStatus
  onTargetSelect: (target: MapTargetDraft) => void
  onCancelTarget: () => void
  onConfirmTarget: () => void
}

export function DroneMap({
  dronesById,
  dirtyIds,
  selectedTarget,
  connectedCount,
  commandStatus,
  onTargetSelect,
  onCancelTarget,
  onConfirmTarget,
}: DroneMapProps) {
  const { containerRef, map } = useDroneMap(onTargetSelect)
  const targetPoint = useProjectedTarget(map, selectedTarget)

  useDroneMarkers({
    map,
    dronesById,
    dirtyIds,
  })

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden bg-slate-900 lg:min-h-0">
      <div ref={containerRef} className="absolute inset-0" aria-label="Drone map" />
      <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border border-white/20 bg-slate-950/80 px-3 py-2 text-sm text-white shadow-lg backdrop-blur">
        Click map to set target for connected drones
      </div>
      {selectedTarget ? (
        <TargetCommandPopover
          target={selectedTarget}
          point={targetPoint}
          connectedCount={connectedCount}
          status={commandStatus}
          onCancel={onCancelTarget}
          onConfirm={onConfirmTarget}
        />
      ) : null}
    </div>
  )
}

