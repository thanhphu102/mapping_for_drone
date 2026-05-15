import {
  ChevronLeft,
  ChevronRight,
  Circle,
  DoorOpen,
  LassoSelect,
  Minus,
  MousePointer2,
  MoveHorizontal,
  Pentagon,
  Route,
  Square,
  Trash2,
} from 'lucide-react'
import type { DrawMode } from '../hooks/useDrawingEngine'
import { layerSupportsMode } from '../hooks/useDrawingEngine'
import type { SpatialLayer } from '../types/drone'

interface ToolConfig {
  mode: DrawMode
  label: string
  description: string
  icon: typeof MousePointer2
  group: 'core' | 'indoor' | 'delete'
}

const TOOL_GROUPS: Array<{ id: ToolConfig['group']; label: string }> = [
  { id: 'core', label: 'Core' },
  { id: 'indoor', label: 'Indoor' },
  { id: 'delete', label: 'Delete' },
]

const TOOLS: ToolConfig[] = [
  { mode: 'select', label: 'Select', description: 'Inspect and move around', icon: MousePointer2, group: 'core' },
  { mode: 'point', label: 'Point', description: 'Place a point feature', icon: Circle, group: 'core' },
  { mode: 'line', label: 'Line', description: 'Draw a line feature', icon: Route, group: 'core' },
  { mode: 'polygon', label: 'Polygon', description: 'Draw a polygon feature', icon: Pentagon, group: 'core' },
  { mode: 'room', label: 'Room', description: 'Sketch indoor rooms', icon: Square, group: 'indoor' },
  { mode: 'wall', label: 'Wall', description: 'Draw walls', icon: Minus, group: 'indoor' },
  { mode: 'door', label: 'Door', description: 'Place a door', icon: DoorOpen, group: 'indoor' },
  { mode: 'corridor', label: 'Corridor', description: 'Draw corridors', icon: MoveHorizontal, group: 'indoor' },
  { mode: 'indoor_route', label: 'Indoor route', description: 'Draw indoor routes', icon: Route, group: 'indoor' },
  { mode: 'delete', label: 'Delete (click)', description: 'Click a feature to delete', icon: Trash2, group: 'delete' },
  { mode: 'delete_lasso', label: 'Delete (lasso)', description: 'Draw an area to delete features', icon: LassoSelect, group: 'delete' },
]

interface EditorToolboxProps {
  mode: DrawMode
  layers: SpatialLayer[]
  toolsEnabled: boolean
  isSaving: boolean
  floorRequired: boolean
  hasFloorSelection: boolean
  isCollapsed: boolean
  onToggleCollapsed: () => void
  onSetMode: (mode: DrawMode) => void
  onClearDraft: () => void
}

export function EditorToolbox({
  mode,
  layers,
  toolsEnabled,
  isSaving,
  floorRequired,
  hasFloorSelection,
  isCollapsed,
  onToggleCollapsed,
  onSetMode,
  onClearDraft,
}: EditorToolboxProps) {
  const floorBlocked = floorRequired && !hasFloorSelection
  const groupedTools = TOOL_GROUPS.map((group) => ({
    ...group,
    tools: TOOLS.filter((tool) => tool.group === group.id),
  }))

  return (
    <aside
      className={`pointer-events-auto absolute left-4 top-4 z-30 flex max-h-[calc(100%-2rem)] flex-col rounded-2xl border border-white/40 bg-white/95 shadow-xl backdrop-blur ${
        isCollapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className={`flex items-center justify-between ${isCollapsed ? 'px-2' : 'px-3'} py-2`}>
        <div className={`text-xs font-semibold uppercase tracking-wide text-slate-500 ${isCollapsed ? 'sr-only' : ''}`}>
          Toolbox
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          onClick={onToggleCollapsed}
          aria-label={isCollapsed ? 'Expand toolbox' : 'Collapse toolbox'}
        >
          {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3">
        {groupedTools.map((group) => (
          <div key={group.id} className="space-y-2">
            <div className={`text-[11px] font-semibold uppercase tracking-wide text-slate-400 ${isCollapsed ? 'sr-only' : ''}`}>
              {group.label}
            </div>
            <div className={`grid gap-2 ${isCollapsed ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {group.tools.map((tool) => {
                const supported =
                  tool.mode === 'select' || tool.mode === 'delete' || tool.mode === 'delete_lasso'
                    ? true
                    : layers.some((layer) => layerSupportsMode(layer, tool.mode))
                const isActive = mode === tool.mode
                const isFloorBlocked = floorBlocked && tool.mode !== 'select'
                const isDisabled = !toolsEnabled || isSaving || !supported || isFloorBlocked
                const Icon = tool.icon
                let reason = tool.description
                if (!toolsEnabled) reason = 'Map is still loading'
                else if (isSaving) reason = 'Saving in progress'
                else if (!supported) reason = 'Not supported by current layer'
                else if (isFloorBlocked) reason = 'Select a floor to draw'

                return (
                  <button
                    key={tool.mode}
                    type="button"
                    className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-left text-xs font-medium transition ${
                      isActive
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : tool.group === 'delete'
                          ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                    } ${isCollapsed ? 'justify-center' : ''} disabled:cursor-not-allowed disabled:opacity-50`}
                    onClick={() => {
                      onSetMode(tool.mode)
                      if (tool.mode !== mode) {
                        onClearDraft()
                      }
                    }}
                    aria-label={tool.label}
                    title={reason}
                    disabled={isDisabled}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span className={isCollapsed ? 'sr-only' : ''}>{tool.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {floorBlocked ? (
        <div className={`border-t border-slate-200/70 px-3 py-2 text-xs text-amber-700 ${isCollapsed ? 'sr-only' : ''}`}>
          Floor required before drawing.
        </div>
      ) : null}
    </aside>
  )
}
