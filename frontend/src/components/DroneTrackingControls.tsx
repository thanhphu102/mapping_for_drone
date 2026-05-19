import type { TrackingStatus } from '../types/drone'

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
    'w-full rounded-2xl px-6 py-4 text-lg font-semibold backdrop-blur transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50'

  const startButtonClass =
    'border border-sky-300/70 bg-gradient-to-r from-sky-50/80 via-sky-100/70 to-blue-50/80 text-sky-700 shadow-[0_12px_30px_rgba(14,165,233,0.16)] hover:border-sky-400/80 hover:from-sky-100/90 hover:via-sky-100/90 hover:to-blue-100/90 hover:shadow-[0_16px_36px_rgba(14,165,233,0.22)] focus:ring-4 focus:ring-sky-200/70'

  const stopButtonClass =
    'border border-rose-300/70 bg-gradient-to-r from-rose-50/80 via-pink-100/70 to-rose-50/80 text-rose-600 shadow-[0_12px_30px_rgba(244,63,94,0.16)] hover:border-rose-400/80 hover:from-rose-100/90 hover:via-pink-100/90 hover:to-rose-100/90 hover:shadow-[0_16px_36px_rgba(244,63,94,0.22)] focus:ring-4 focus:ring-rose-200/70'

  const saveButtonClass =
    'border border-emerald-300/70 bg-gradient-to-r from-emerald-50/80 via-teal-100/60 to-emerald-50/80 text-emerald-700 shadow-[0_12px_30px_rgba(16,185,129,0.16)] hover:border-emerald-400/80 hover:from-emerald-100/90 hover:via-teal-100/80 hover:to-emerald-100/90 hover:shadow-[0_16px_36px_rgba(16,185,129,0.22)] focus:ring-4 focus:ring-emerald-200/70'

  const clearButtonClass =
    'border border-slate-200/80 bg-white/65 text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.08)] hover:border-slate-300/90 hover:bg-slate-50/80 hover:text-slate-800 hover:shadow-[0_14px_30px_rgba(15,23,42,0.12)] focus:ring-4 focus:ring-slate-200/70'

  const statusPillClassMap: Record<TrackingStatus, string> = {
    idle: 'bg-slate-100 text-slate-700',
    tracking: 'bg-sky-100 text-sky-700',
    paused: 'bg-amber-100 text-amber-700',
    completed: 'bg-emerald-100 text-emerald-700',
  }

  return (
    <section
      className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur"
      aria-live="polite"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">Drone Tracking</h2>
          <p className="mt-1 text-sm text-slate-600">
            {hasDrone ? (
              <>
                Selected: <span className="font-semibold text-slate-900">{selectedDroneId}</span>
              </>
            ) : (
              'Select a drone to start tracking'
            )}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusPillClassMap[status]}`}
        >
          {status}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-slate-200/60 bg-slate-50/80 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</div>
          <div className="mt-1 font-semibold capitalize text-slate-900">{status}</div>
        </div>
        <div className="rounded-xl border border-slate-200/60 bg-slate-50/80 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Points</div>
          <div className="mt-1 font-semibold text-slate-900">
            {pointsCount.toLocaleString()} / {maxPoints.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {status === 'tracking' ? (
          <button
            type="button"
            className={`${baseButtonClass} ${stopButtonClass}`}
            onClick={onStop}
          >
            Stop Tracking
          </button>
        ) : (
          <button
            type="button"
            className={`${baseButtonClass} ${startButtonClass}`}
            onClick={onStart}
            disabled={!hasDrone}
          >
            Start Tracking
          </button>
        )}

        {status === 'completed' ? (
          <>
            <button
              type="button"
              className={`${baseButtonClass} ${saveButtonClass}`}
              onClick={onSave}
              disabled={!canSave || isSaving}
            >
              {isSaving ? 'Saving route...' : 'Save Route'}
            </button>
            <button
              type="button"
              className={`${baseButtonClass} ${clearButtonClass}`}
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
