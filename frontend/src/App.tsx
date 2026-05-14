import { useCallback, useMemo, useState } from 'react'
import { Activity, MapPinned } from 'lucide-react'
import { DroneMap } from './components/DroneMap'
import { DroneTable } from './components/DroneTable'
import { Notice, type NoticeState } from './components/Notice'
import { StatusStrip } from './components/StatusStrip'
import { useCommandDispatch } from './hooks/useCommandDispatch'
import { useDroneTelemetry } from './hooks/useDroneTelemetry'
import type { CommandTarget, DroneState, MapTargetDraft } from './types/drone'
import { formatDroneList } from './utils/format'

function App() {
  const { snapshot, connectionStatus, connectionMessage } = useDroneTelemetry()
  const commandDispatch = useCommandDispatch()
  const [selectedTarget, setSelectedTarget] = useState<CommandTarget | null>(null)
  const [notice, setNotice] = useState<NoticeState | null>(null)

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

  const handleTargetSelect = useCallback(
    (target: MapTargetDraft) => {
      if (connectedCount === 0) {
        setNotice({
          tone: 'error',
          title: 'No drones connected',
          detail: 'Start or reconnect a drone before sending a target.',
        })
        return
      }

      commandDispatch.reset()
      setSelectedTarget({
        lat: Number(target.lat.toFixed(6)),
        lon: Number(target.lon.toFixed(6)),
      })
    },
    [commandDispatch, connectedCount],
  )

  const handleConfirmTarget = useCallback(async () => {
    if (!selectedTarget) {
      return
    }

    try {
      const response = await commandDispatch.sendTarget(selectedTarget)
      setNotice({
        tone: 'success',
        title: 'Command sent',
        detail: `Command sent to: ${formatDroneList(response.sent)}`,
      })
      setSelectedTarget(null)
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Command failed',
        detail:
          error instanceof Error ? error.message : 'Unable to send command',
      })
    }
  }, [commandDispatch, selectedTarget])

  return (
    <div className="h-dvh bg-slate-100 text-slate-950">
      <div className="flex h-full flex-col lg:flex-row">
        <main className="min-h-0 flex-1">
          <DroneMap
            dronesById={snapshot.dronesById}
            dirtyIds={snapshot.dirtyIds}
            selectedTarget={selectedTarget}
            connectedCount={connectedCount}
            commandStatus={commandDispatch.state.status}
            onTargetSelect={handleTargetSelect}
            onCancelTarget={() => setSelectedTarget(null)}
            onConfirmTarget={handleConfirmTarget}
          />
        </main>

        <aside className="flex max-h-[45dvh] w-full flex-col border-t border-slate-200 bg-slate-100 lg:h-full lg:max-h-none lg:w-[460px] lg:border-l lg:border-t-0">
          <div className="border-b border-slate-200 bg-white px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-sky-700">
                  <MapPinned className="size-4" aria-hidden="true" />
                  Swarm GSC
                </div>
                <h1 className="mt-1 text-xl font-semibold text-slate-950">
                  Drone Mapping Control
                </h1>
              </div>
              <div className="rounded-lg bg-sky-50 p-2 text-sky-700">
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
              commandStatus={commandDispatch.state.status}
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
                <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700">
                  Live
                </span>
              </div>

              <DroneTable
                drones={connectedDrones}
                isTelemetryOpen={connectionStatus === 'open'}
              />
            </section>

            <section
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              aria-live="polite"
            >
              <h2 className="text-sm font-semibold text-slate-950">
                Command Status
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                {commandDispatch.state.message}
              </p>
            </section>
          </div>
        </aside>
      </div>

      <Notice notice={notice} onDismiss={() => setNotice(null)} />
    </div>
  )
}

export default App
