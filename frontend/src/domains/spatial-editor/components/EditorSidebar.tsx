import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Info, Save } from 'lucide-react'
import type { Feature, Position } from 'geojson'
import type { DrawingProject, ProjectCanvasConfig, SpatialFloor } from '../types'
import type { SnapPreview } from '../hooks/useSnapEngine'
import { featureMeasurement, localCoordinates } from '../hooks/useDrawingEngine'
import type { InspectorDraft } from '../hooks/useInspectorFormState'
import { GoogleBaseMapPicker } from '../../map/components/GoogleBaseMapPicker'
import type { GoogleBaseMapMode } from '../../map/baseMapModes'
import { EditorBackdropPicker } from './EditorBackdropPicker'
import type { EditorBackdropMode } from '../editorBackdropMode'

interface EditorSidebarProps {
  project: DrawingProject | null
  projectConfig: ProjectCanvasConfig
  floors: SpatialFloor[]
  selectedFloorId: string | null
  mapZoom: number
  mapReady: boolean
  boundaryRendered: boolean
  baseMapMode: GoogleBaseMapMode
  backdropMode: EditorBackdropMode
  visibleFeatures: Feature[]
  draftFeature: GeoJSON.FeatureCollection | null
  hoverCoordinate: Position | null
  snapPreview: SnapPreview | null
  message: string
  selectedFeatures: Feature[]
  inspectorDraft: InspectorDraft
  onInspectorNameChange: (value: string) => void
  onInspectorTagChange: (value: string) => void
  onInspectorNoteChange: (value: string) => void
  onBaseMapModeChange: (mode: GoogleBaseMapMode) => void
  onBackdropModeChange: (mode: EditorBackdropMode) => void
  onSaveInspector: () => void
  isSavingInspector: boolean
}

export function EditorSidebar({
  project,
  projectConfig,
  floors,
  selectedFloorId,
  mapZoom,
  mapReady,
  boundaryRendered,
  baseMapMode,
  backdropMode,
  visibleFeatures,
  draftFeature,
  hoverCoordinate,
  snapPreview,
  message,
  selectedFeatures,
  inspectorDraft,
  onInspectorNameChange,
  onInspectorTagChange,
  onInspectorNoteChange,
  onBaseMapModeChange,
  onBackdropModeChange,
  onSaveInspector,
  isSavingInspector,
}: EditorSidebarProps) {
  const localOrigin: Position | null = project ? [project.bbox[0], project.bbox[1]] : null
  const hoverLocal = hoverCoordinate && localOrigin ? localCoordinates(hoverCoordinate, localOrigin) : null
  const activeFloor = floors.find((floor) => floor.id === selectedFloorId)
  const isMultiSelect = selectedFeatures.length > 1
  const stopEditorShortcutPropagation = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    event.stopPropagation()
  }

  return (
    <aside className="flex h-full w-full flex-col border-l border-slate-200 bg-white text-slate-900">
      <header className="border-b border-slate-200 px-4 py-3">
        <div className="text-sm font-semibold text-slate-950">Inspector</div>
        <div className="mt-1 text-xs text-slate-500">
          {selectedFeatures.length === 0
            ? 'Select an object to edit metadata'
            : isMultiSelect
              ? `${selectedFeatures.length} objects selected`
              : `1 object selected`}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div>Floor: {activeFloor?.label ?? 'None selected'}</div>
          <div className="mt-1">Objects in view: {visibleFeatures.length}</div>
          <div className="mt-1">Zoom: {mapZoom.toFixed(1)}</div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">View</h3>
          <div className="mt-2 space-y-2">
            <div>
              <div className="mb-1 text-xs text-slate-500">Backdrop</div>
              <EditorBackdropPicker mode={backdropMode} onChange={onBackdropModeChange} />
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-500">Base map</div>
              <GoogleBaseMapPicker mode={baseMapMode} onChange={onBaseMapModeChange} />
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Properties</h3>
          <div className="mt-2 space-y-2">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Name</span>
              <input
                name="inspector-name"
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none ring-sky-400 focus:ring disabled:bg-slate-100 disabled:text-slate-400"
                value={inspectorDraft.name}
                onChange={(event) => onInspectorNameChange(event.target.value)}
                onKeyDown={stopEditorShortcutPropagation}
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={selectedFeatures.length === 0 || isMultiSelect}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Tag</span>
              <input
                name="inspector-tag"
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none ring-sky-400 focus:ring disabled:bg-slate-100 disabled:text-slate-400"
                value={inspectorDraft.tag}
                onChange={(event) => onInspectorTagChange(event.target.value)}
                onKeyDown={stopEditorShortcutPropagation}
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={selectedFeatures.length === 0}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Note</span>
              <textarea
                name="inspector-note"
                rows={4}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none ring-sky-400 focus:ring disabled:bg-slate-100 disabled:text-slate-400"
                value={inspectorDraft.noteText}
                onChange={(event) => onInspectorNoteChange(event.target.value)}
                onKeyDown={stopEditorShortcutPropagation}
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={selectedFeatures.length === 0}
              />
            </label>
            <button
              type="button"
              onClick={onSaveInspector}
              disabled={selectedFeatures.length === 0 || isSavingInspector}
              className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-100 px-2.5 py-1.5 text-sm font-semibold text-sky-900 shadow-sm transition hover:border-sky-400 hover:bg-sky-200 disabled:opacity-50"
            >
              <Save className="size-3.5" /> Save
            </button>
          </div>
        </section>

        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 text-sky-500" />
            <span>{message}</span>
          </div>
        </div>

        <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
            Advanced
          </summary>
          <div className="mt-3 space-y-1 rounded-md border border-slate-200 bg-white p-3">
            <div>Project mode: {project?.editorMode ?? '-'}</div>
            <div>Floors: {floors.length}</div>
            <div>Map ready: {mapReady ? 'yes' : 'no'}</div>
            <div>Boundary ready: {boundaryRendered ? 'yes' : 'no'}</div>
            <div>Snap: {projectConfig.snapping.enabled ? (snapPreview ? `locked ${snapPreview.kind}` : 'enabled') : 'disabled'}</div>
            <div className="font-mono text-xs text-slate-500">Cursor: {hoverCoordinate ? `${hoverCoordinate[1].toFixed(6)}, ${hoverCoordinate[0].toFixed(6)}` : '-'}</div>
            <div className="font-mono text-xs text-slate-500">Local: {hoverLocal ? `X ${hoverLocal.x.toFixed(2)}m · Y ${hoverLocal.y.toFixed(2)}m` : '-'}</div>
            <div>{featureMeasurement(draftFeature)}</div>
          </div>
        </details>
      </div>
    </aside>
  )
}
