import { Layers3, Loader2, MapPin, X } from 'lucide-react'
import type { CommandTarget, OsmCandidate } from '../types/drone'

interface OsmPanelStatus {
  tone: 'success' | 'error' | 'info'
  text: string
}

interface OsmEnclosingPanelProps {
  target: CommandTarget | null
  candidates: OsmCandidate[]
  selectedCandidate?: OsmCandidate | null
  highlightedCandidate?: OsmCandidate | null
  status?: OsmPanelStatus | null
  onHoverCandidate: (candidate: OsmCandidate | null) => void
  onSelectCandidate: (candidate: OsmCandidate) => void
  onClose: () => void
}

const toneClassName: Record<OsmPanelStatus['tone'], string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
}

export function OsmEnclosingPanel({
  target,
  candidates,
  selectedCandidate = null,
  highlightedCandidate = null,
  status = null,
  onHoverCandidate,
  onSelectCandidate,
  onClose,
}: OsmEnclosingPanelProps) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Layers3 className="size-4 text-sky-600" aria-hidden="true" />
            OSM Enclosing Elements
          </h2>
          {target ? (
            <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-slate-500">
              <MapPin className="size-3.5 text-slate-400" aria-hidden="true" />
              {target.lat.toFixed(6)}, {target.lon.toFixed(6)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
          onClick={onClose}
          aria-label="Close OSM enclosing elements panel"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {status ? (
          <p
            className={`rounded-lg border px-3 py-2 text-xs font-medium ${toneClassName[status.tone]}`}
          >
            {status.text}
          </p>
        ) : null}

        {candidates.length > 0 ? (
          <ul className="space-y-2 pr-1">
            {candidates.map((candidate) => {
              const isSelected =
                selectedCandidate?.id === candidate.id &&
                selectedCandidate.type === candidate.type
              const isHighlighted =
                highlightedCandidate?.id === candidate.id &&
                highlightedCandidate.type === candidate.type

              return (
                <li key={`${candidate.type}-${candidate.id}`}>
                  <button
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                      isSelected
                        ? 'border-orange-300 bg-orange-50'
                        : isHighlighted
                          ? 'border-orange-200 bg-orange-50/60'
                          : 'border-slate-200 bg-white hover:border-orange-200 hover:bg-orange-50/30'
                    }`}
                    onMouseEnter={() => onHoverCandidate(candidate)}
                    onMouseLeave={() => onHoverCandidate(selectedCandidate)}
                    onClick={() => onSelectCandidate(candidate)}
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
        ) : status?.tone === 'info' ? (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Waiting for enclosing elements...
          </p>
        ) : null}
      </div>
    </section>
  )
}
