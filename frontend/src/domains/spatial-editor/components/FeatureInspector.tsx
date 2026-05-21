import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Save } from 'lucide-react'
import type { Feature } from 'geojson'

export interface InspectorDraft {
  name: string
  tag: string
  noteText: string
}

interface FeatureInspectorProps {
  selectedFeatures: Feature[]
  inspectorDraft: InspectorDraft
  onInspectorDraftChange: (next: InspectorDraft) => void
  onSaveInspector: () => void
  isSavingInspector: boolean
}

export function FeatureInspector({
  selectedFeatures,
  inspectorDraft,
  onInspectorDraftChange,
  onSaveInspector,
  isSavingInspector,
}: FeatureInspectorProps) {
  const isMultiSelect = selectedFeatures.length > 1
  const stopEditorShortcutPropagation = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    event.stopPropagation()
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Properties</h3>
      <div className="mt-2 space-y-2">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">Name</span>
          <input
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none ring-sky-400 focus:ring disabled:bg-slate-100 disabled:text-slate-400"
            value={inspectorDraft.name}
            onChange={(event) => onInspectorDraftChange({ ...inspectorDraft, name: event.target.value })}
            onKeyDown={stopEditorShortcutPropagation}
            disabled={selectedFeatures.length === 0 || isMultiSelect}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">Tag</span>
          <input
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none ring-sky-400 focus:ring disabled:bg-slate-100 disabled:text-slate-400"
            value={inspectorDraft.tag}
            onChange={(event) => onInspectorDraftChange({ ...inspectorDraft, tag: event.target.value })}
            onKeyDown={stopEditorShortcutPropagation}
            disabled={selectedFeatures.length === 0}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">Note</span>
          <textarea
            rows={4}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none ring-sky-400 focus:ring disabled:bg-slate-100 disabled:text-slate-400"
            value={inspectorDraft.noteText}
            onChange={(event) => onInspectorDraftChange({ ...inspectorDraft, noteText: event.target.value })}
            onKeyDown={stopEditorShortcutPropagation}
            disabled={selectedFeatures.length === 0}
          />
        </label>
        <button
          type="button"
          onClick={onSaveInspector}
          disabled={selectedFeatures.length === 0 || isSavingInspector}
          className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-100 px-2.5 py-1.5 text-sm font-semibold text-sky-900 shadow-sm transition hover:border-sky-400 hover:bg-sky-200 disabled:opacity-50"
        >
          <Save className="size-3.5" /> Save metadata
        </button>
      </div>
    </section>
  )
}

