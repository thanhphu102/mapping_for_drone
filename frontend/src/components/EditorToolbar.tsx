import {
  ArrowLeft,
  Circle,
  Loader2,
  Minus,
  MousePointer2,
  MoveHorizontal,
  Pentagon,
  Route,
  Save,
  Send,
  Square,
  Trash2,
  DoorOpen,
} from 'lucide-react'
import type { Feature } from 'geojson'
import type { EditorMode, SpatialLayer } from '../types/drone'
import type { DrawMode } from '../hooks/useDrawingEngine'
import { layerSupportsMode } from '../hooks/useDrawingEngine'

interface EditorToolbarProps {
  mode: DrawMode
  activeLayer: SpatialLayer | null
  layers: SpatialLayer[]
  toolsEnabled: boolean
  isSaving: boolean
  draftFeature: Feature | null
  project: { id: string; editorMode: EditorMode } | null
  onSetMode: (mode: DrawMode) => void
  onClearDraft: () => void
  onSaveDraft: () => void
  onPublish: () => void
  onBack: () => void
}

const baseTools: Array<{ mode: DrawMode; label: string; icon: typeof MousePointer2 }> = [
  { mode: 'select', label: 'Select', icon: MousePointer2 },
  { mode: 'point', label: 'Draw Point', icon: Circle },
  { mode: 'line', label: 'Draw LineString', icon: Route },
  { mode: 'polygon', label: 'Draw Polygon', icon: Pentagon },
]

const indoorTools: Array<{ mode: DrawMode; label: string; icon: typeof MousePointer2 }> = [
  { mode: 'room', label: 'Draw Room', icon: Square },
  { mode: 'wall', label: 'Draw Wall', icon: Minus },
  { mode: 'door', label: 'Place Door', icon: DoorOpen },
  { mode: 'corridor', label: 'Draw Corridor', icon: MoveHorizontal },
  { mode: 'indoor_route', label: 'Draw Indoor Route', icon: Route },
]

const deleteTools: Array<{ mode: DrawMode; label: string; icon: typeof MousePointer2 }> = [
  { mode: 'delete', label: 'Delete', icon: Trash2 },
]

export function EditorToolbar({
  mode,
  activeLayer,
  layers,
  toolsEnabled,
  isSaving,
  draftFeature,
  project,
  onSetMode,
  onClearDraft,
  onSaveDraft,
  onPublish,
  onBack,
}: EditorToolbarProps) {
  const isIndoor = project?.editorMode === 'building' || project?.editorMode === 'indoor'
  const tools = isIndoor ? [...baseTools, ...indoorTools, ...deleteTools] : [...baseTools, ...deleteTools]

  return (
    <div className="absolute left-4 top-4 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-white/30 bg-white/92 p-2 shadow-lg backdrop-blur">
      <button
        type="button"
        className="rounded-md p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
        onClick={onBack}
        aria-label="Back to main map"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
      </button>
      {isIndoor ? (
        <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden="true" />
      ) : null}
      {tools.map((tool) => {
        const Icon = tool.icon
        const supported =
          layerSupportsMode(activeLayer, tool.mode) ||
          layers.some((layer) => !layer.locked && layerSupportsMode(layer, tool.mode))
        return (
          <button
            key={tool.mode}
            type="button"
            className={`rounded-md p-2 transition ${
              mode === tool.mode
                ? 'bg-slate-950 text-white'
                : tool.mode === 'delete'
                  ? 'text-rose-500 hover:bg-rose-50 hover:text-rose-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
            } disabled:cursor-not-allowed disabled:opacity-45`}
            onClick={() => {
              onSetMode(tool.mode)
              if (tool.mode !== mode) {
                onClearDraft()
              }
            }}
            aria-label={tool.label}
            title={tool.label}
            disabled={!toolsEnabled || isSaving || !supported}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        )
      })}
      <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden="true" />
      <button
        type="button"
        className="rounded-md p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
        onClick={onSaveDraft}
        disabled={!toolsEnabled || !draftFeature || isSaving}
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
    </div>
  )
}

