import {
  ArrowLeft,
  Loader2,
  Minus,
  Save,
  Send,
  Plus,
} from 'lucide-react'
import type { EditorMode } from '../types'
import type { DrawMode } from '../hooks/useDrawingEngine'

interface EditorToolbarProps {
  toolsEnabled: boolean
  isSaving: boolean
  hasPendingChanges: boolean
  hasSavableDraft: boolean
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
  hasPendingChanges,
  hasSavableDraft,
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
  const saveReady = Boolean(toolsEnabled && !isSaving && canDrawOnFloor && (hasSavableDraft || hasPendingChanges))

  return (
    <div className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
      <button
        type="button"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        <span>Main map</span>
      </button>
      <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
      <button
        type="button"
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 transition ${
          saveReady
            ? 'border-sky-500 bg-sky-500 text-white hover:bg-sky-600'
            : 'border-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-950'
        } disabled:cursor-not-allowed disabled:opacity-45`}
        onClick={onSaveDraft}
        disabled={!saveReady}
        aria-label="Save draft"
        title="Save draft"
      >
        {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        <span className="text-xs font-semibold">Save</span>
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-slate-700 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
        onClick={onPublish}
        disabled={!toolsEnabled || !project || isSaving}
        aria-label="Publish"
        title="Publish"
      >
        <Send className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="flex h-9 items-center rounded-lg border border-transparent px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
        onClick={() => {
          onSetMode('select')
          onClearDraft()
        }}
        disabled={!toolsEnabled || isSaving}
      >
        Clear
      </button>
      <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom out (-)"
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <div className="min-w-12 text-center text-sm font-semibold text-slate-800">{zoomLabel}</div>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
        onClick={onZoomIn}
        aria-label="Zoom in"
        title="Zoom in (+)"
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
