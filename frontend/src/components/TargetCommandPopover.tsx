import type { CSSProperties } from 'react'
import { LocateFixed, Send, X } from 'lucide-react'
import type {
  CommandDispatchStatus,
  CommandTarget,
  OsmCandidate,
} from '../types/drone'
import type { ProjectedPoint } from '../hooks/useProjectedTarget'

interface LocationFetchMessage {
  tone: 'success' | 'error'
  text: string
}

interface TargetCommandPopoverProps {
  target: CommandTarget
  point: ProjectedPoint | null
  connectedCount: number
  status: CommandDispatchStatus
  onFetchLocation: () => void
  candidates: OsmCandidate[]
  selectedCandidate: OsmCandidate | null
  onCandidateHover: (candidate: OsmCandidate | null) => void
  onCandidateSelect: (candidate: OsmCandidate) => void
  isFetchingCandidates: boolean
  isFetchingFull: boolean
  locationFetchMessage?: LocationFetchMessage | null
  onCancel: () => void
  onConfirm: () => void
}

export function TargetCommandPopover({
  target,
  point,
  connectedCount,
  status,
  onFetchLocation,
  candidates,
  selectedCandidate,
  onCandidateHover,
  onCandidateSelect,
  isFetchingCandidates,
  isFetchingFull,
  locationFetchMessage,
  onCancel,
  onConfirm,
}: TargetCommandPopoverProps) {
  const style = {
    '--target-left': `${point?.x ?? 24}px`,
    '--target-top': `${point?.y ?? 24}px`,
  } as CSSProperties

  return (
    <div className="target-popover" style={style}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-sky-700">
            Target coordinate
          </p>
          <div className="mt-2 space-y-1 font-mono text-xs text-slate-700">
            <div>Lat: {target.lat.toFixed(6)}</div>
            <div>Lon: {target.lon.toFixed(6)}</div>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-500"
          onClick={onCancel}
          aria-label="Cancel target command"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-sky-300"
        onClick={onConfirm}
        disabled={status === 'sending' || isFetchingCandidates || isFetchingFull}
      >
        <Send className="size-4" aria-hidden="true" />
        {status === 'sending'
          ? 'Sending command'
          : `Send to ${connectedCount} drone(s)`}
      </button>

      <button
        type="button"
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        onClick={onFetchLocation}
        disabled={isFetchingCandidates || isFetchingFull || status === 'sending'}
      >
        <LocateFixed className="size-4" aria-hidden="true" />
        {isFetchingCandidates ? 'Fetching...' : 'Fetch location'}
      </button>

      {candidates.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase text-slate-500">
            OSM candidates
          </p>
          <ul className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1">
            {candidates.map((candidate) => {
              const isSelected =
                selectedCandidate?.id === candidate.id &&
                selectedCandidate.type === candidate.type

              return (
                <li key={`${candidate.type}-${candidate.id}`}>
                  <button
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                      isSelected
                        ? 'border-orange-300 bg-orange-50'
                        : 'border-slate-200 bg-white hover:border-orange-200 hover:bg-orange-50/40'
                    }`}
                    onMouseEnter={() => onCandidateHover(candidate)}
                    onMouseLeave={() => onCandidateHover(selectedCandidate)}
                    onClick={() => onCandidateSelect(candidate)}
                    disabled={isFetchingFull}
                  >
                    <div className="font-semibold text-slate-900">
                      {candidate.label}
                    </div>
                    <div className="mt-1 text-slate-600">
                      {candidate.type} {candidate.id}
                    </div>
                    <div className="text-slate-500">{candidate.category}</div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {locationFetchMessage ? (
        <p
          className={`mt-2 text-xs font-medium ${
            locationFetchMessage.tone === 'success'
              ? 'text-emerald-700'
              : 'text-rose-700'
          }`}
          role="status"
          aria-live="polite"
        >
          {locationFetchMessage.text}
        </p>
      ) : null}
    </div>
  )
}
