import {
  ArrowLeft,
  Loader2,
  Minus,
  Square,
  Save,
  Send,
  Plus,
} from 'lucide-react'
import type { EditorMode } from '../types/drone'
import type { DrawMode } from '../hooks/useDrawingEngine'

interface EditorToolbarProps {
  toolsEnabled: boolean
  isSaving: boolean
  draftFeature: GeoJSON.FeatureCollection | null
  project: { id: string; editorMode: EditorMode } | null
  canDrawOnFloor: boolean
  onSetMode: (mode: DrawMode) => void
  onClearDraft: () => void
  onSaveDraft: () => void
  onPublish: () => void
  onBack: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  zoomLabel: string
}

export function EditorToolbar({
  toolsEnabled,
  isSaving,
  draftFeature,
  project,
  canDrawOnFloor,
  onSetMode,
  onClearDraft,
  onSaveDraft,
  onPublish,
  onBack,
  onZoomIn,
  onZoomOut,
  zoomLabel,
}: EditorToolbarProps) {
  return (
    <div className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-white/30 bg-white/92 px-3 py-2 shadow-lg backdrop-blur">
      <button
        type="button"
        className="rounded-md p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
        onClick={onBack}
        aria-label="Back to main map"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
      </button>
      <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden="true" />
      <button
        type="button"
        className="rounded-md p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
        onClick={() => {
          onSetMode('select')
          onClearDraft()
        }}
        disabled={!toolsEnabled || isSaving}
        aria-label="Clear draft"
        title="Clear draft"
      >
        <Square className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="rounded-md p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
        onClick={onSaveDraft}
        disabled={!toolsEnabled || !draftFeature || isSaving || !canDrawOnFloor}
        aria-label="Save draft"
        title="Save draft"
      >
        {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      </button>
      <button
        type="button"
        className="rounded-md p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
        onClick={onPublish}
        disabled={!toolsEnabled || !project || isSaving}
        aria-label="Publish"
        title="Publish"
      >
        <Send className="size-4" aria-hidden="true" />
      </button>
      <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden="true" />
      <button
        type="button"
        className="rounded-md p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom out (-)"
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <div className="min-w-12 text-center text-xs font-semibold text-slate-700">{zoomLabel}</div>
      <button
        type="button"
        className="rounded-md p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
        onClick={onZoomIn}
        aria-label="Zoom in"
        title="Zoom in (+)"
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
