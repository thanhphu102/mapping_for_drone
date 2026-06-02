import type { TrackingStatus } from '../types'

interface DroneTrackingControlsProps {
  selectedDroneId: string | null
  status: TrackingStatus
  pointsCount: number
  maxPoints: number
  canSave: boolean
  isSaving: boolean
  onStart: () => void
  onStop: () => void
  onSave: () => void
  onClear: () => void
}

export function DroneTrackingControls({
  selectedDroneId,
  status,
  pointsCount,
  maxPoints,
  canSave,
  isSaving,
  onStart,
  onStop,
  onSave,
  onClear,
}: DroneTrackingControlsProps) {
  const hasDrone = Boolean(selectedDroneId)

  const baseButtonClass =
    'rounded-lg px-4 py-2.5 text-sm font-semibold transition focus:outline-none disabled:cursor-not-allowed disabled:opacity-50'

  const startButtonClass =
    'border border-sky-300 bg-sky-100 text-sky-900 hover:border-sky-400 hover:bg-sky-200 focus:ring-2 focus:ring-sky-300'

  const stopButtonClass =
    'border border-rose-300 bg-rose-50 text-rose-700 hover:border-rose-400 hover:bg-rose-100 focus:ring-2 focus:ring-rose-300'

  const saveButtonClass =
    'border border-emerald-300 bg-emerald-100 text-emerald-900 hover:border-emerald-400 hover:bg-emerald-200 focus:ring-2 focus:ring-emerald-300'

  const clearButtonClass =
    'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 focus:ring-2 focus:ring-slate-300'

  const statusPillClassMap: Record<TrackingStatus, string> = {
    idle: 'bg-slate-100 text-slate-700',
    tracking: 'bg-sky-100 text-sky-700',
    paused: 'bg-amber-100 text-amber-700',
    completed: 'bg-emerald-100 text-emerald-700',
  }

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      aria-live="polite"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">Route tracking</h2>
          <p className="mt-1 text-sm text-slate-600">
            {hasDrone ? (
              <>
                Drone <span className="font-semibold text-slate-900">{selectedDroneId}</span>
              </>
            ) : (
              'Select a drone from the list, or start and use the first connected drone.'
            )}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusPillClassMap[status]}`}
        >
          {status}
        </span>
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {status === 'tracking'
          ? `Recording route points: ${pointsCount.toLocaleString()} / ${maxPoints.toLocaleString()}`
          : `Saved points: ${pointsCount.toLocaleString()} / ${maxPoints.toLocaleString()}`}
      </div>

      <div className="space-y-2">
        {status === 'tracking' ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
            Quick stop: press <span className="font-semibold">Enter</span>, <span className="font-semibold">/</span>, or left-click map.
          </div>
        ) : null}
        {status === 'tracking' ? (
          <button
            type="button"
            className={`w-full ${baseButtonClass} ${stopButtonClass}`}
            onClick={onStop}
          >
            Stop Tracking
          </button>
        ) : (
          <button
            type="button"
            className={`w-full ${baseButtonClass} ${startButtonClass}`}
            onClick={onStart}
          >
            Start Tracking
          </button>
        )}

        {status === 'completed' ? (
          <>
            <button
              type="button"
              className={`w-full ${baseButtonClass} ${saveButtonClass}`}
              onClick={onSave}
              disabled={!canSave || isSaving}
            >
              {isSaving ? 'Saving route...' : 'Save Route'}
            </button>
            <button
              type="button"
              className={`w-full ${baseButtonClass} ${clearButtonClass}`}
              onClick={onClear}
            >
              Clear Route
            </button>
          </>
        ) : null}
      </div>
    </section>
  )
}
