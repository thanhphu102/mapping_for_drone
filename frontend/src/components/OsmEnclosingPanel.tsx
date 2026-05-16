import { Layers3, Loader2, MapPin, PencilRuler, X } from 'lucide-react'
import type {
  CommandTarget,
  EditorMode,
  OsmCandidate,
  OsmElementGeometryResponse,
} from '../types/drone'

interface OsmPanelStatus {
  tone: 'success' | 'error' | 'info'
  text: string
}

interface OsmEnclosingPanelProps {
  target: CommandTarget | null
  candidates: OsmCandidate[]
  selectedCandidate?: OsmCandidate | null
  highlightedCandidate?: OsmCandidate | null
  selectedGeometry?: OsmElementGeometryResponse | null
  selectedEditorMode?: EditorMode | null
  status?: OsmPanelStatus | null
  isOpeningEditor?: boolean
  confirmedLargeArea?: boolean
  onHoverCandidate: (candidate: OsmCandidate | null) => void
  onSelectCandidate: (candidate: OsmCandidate) => void
  onChangeEditorMode: (mode: EditorMode) => void
  onOpenSpatialEditor: () => void
  onClose: () => void
}

const toneClassName: Record<OsmPanelStatus['tone'], string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
}

const editorModes: EditorMode[] = [
  'region',
  'campus',
  'agriculture',
  'building',
  'indoor',
  'parking',
  'custom',
]

export function OsmEnclosingPanel({
  target,
  candidates,
  selectedCandidate = null,
  highlightedCandidate = null,
  selectedGeometry = null,
  selectedEditorMode = null,
  status = null,
  isOpeningEditor = false,
  confirmedLargeArea = false,
  onHoverCandidate,
  onSelectCandidate,
  onChangeEditorMode,
  onOpenSpatialEditor,
  onClose,
}: OsmEnclosingPanelProps) {
  const selectedKey = selectedCandidate ? `${selectedCandidate.type}-${selectedCandidate.id}` : null
  const isSelectedLoading = selectedCandidate && status?.tone === 'info' && !selectedGeometry
  const isSelectedError = selectedCandidate && status?.tone === 'error' && !selectedGeometry

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
              const candidateKey = `${candidate.type}-${candidate.id}`
              const isSelected =
                selectedCandidate?.id === candidate.id &&
                selectedCandidate.type === candidate.type
              const isHighlighted =
                highlightedCandidate?.id === candidate.id &&
                highlightedCandidate.type === candidate.type

              return (
                <li key={candidateKey}>
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
                  {isSelected ? (
                    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      {isSelectedLoading ? (
                        <p className="flex items-center gap-2 text-xs text-slate-500">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          Building boundary...
                        </p>
                      ) : null}
                      {isSelectedError ? (
                        <p className={`rounded-md border px-2 py-1.5 text-xs ${toneClassName.error}`}>
                          {status?.text ?? 'Unable to load boundary'}
                        </p>
                      ) : null}
                      {selectedKey === candidateKey && selectedGeometry ? (
                        <>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold uppercase text-slate-500">
                                Detected mode
                              </div>
                              <div className="mt-1 text-sm font-semibold capitalize text-slate-950">
                                {selectedEditorMode ?? selectedGeometry.editorMode}
                              </div>
                            </div>
                            <div className="rounded-md bg-white px-2 py-1 text-xs font-medium text-slate-600">
                              {selectedGeometry.areaSquareKm.toFixed(3)} km2
                            </div>
                          </div>
                          <div className="mt-2 space-y-1 text-xs text-slate-600">
                            <div>
                              <span className="font-semibold text-slate-700">Reason:</span>{' '}
                              {selectedGeometry.classification.reason}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-700">Boundary:</span>{' '}
                              {candidate.type} {candidate.id}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-700">Perimeter:</span>{' '}
                              {(selectedGeometry.perimeterM / 1000).toFixed(2)} km
                            </div>
                          </div>
                          {selectedGeometry.warnings.length > 0 ? (
                            <div className="mt-2 space-y-2">
                              {selectedGeometry.warnings.map((warning) => (
                                <p
                                  key={warning}
                                  className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800"
                                >
                                  {warning}
                                </p>
                              ))}
                            </div>
                          ) : null}
                          <div className="mt-3">
                            <div className="text-xs font-semibold uppercase text-slate-500">
                              Change mode
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {editorModes.map((mode) => (
                                <button
                                  key={mode}
                                  type="button"
                                  className={`rounded-md border px-2.5 py-1 text-xs font-medium capitalize transition ${
                                    (selectedEditorMode ?? selectedGeometry.editorMode) === mode
                                      ? 'border-slate-950 bg-slate-950 text-white'
                                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                                  }`}
                                  onClick={() => onChangeEditorMode(mode)}
                                >
                                  {mode}
                                </button>
                              ))}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                            onClick={onOpenSpatialEditor}
                            disabled={isOpeningEditor}
                          >
                            {isOpeningEditor ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <PencilRuler className="size-4" aria-hidden="true" />
                            )}
                            {confirmedLargeArea ? 'Confirm Large Area And Open Editor' : 'Open Spatial Editor'}
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
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
