import {
  Box,
  Circle,
  Hand,
  LassoSelect,
  MousePointer2,
  PenTool,
  Pentagon,
  Route,
  Triangle,
  Type,
} from 'lucide-react'
import type { DrawMode } from '../hooks/useDrawingEngine'

interface ToolConfig {
  mode: DrawMode
  label: string
  shortcut: string
  icon: typeof MousePointer2
  group: 'cursor' | 'draw' | 'edit'
}

const PRIMARY_TOOLS: ToolConfig[] = [
  { mode: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2, group: 'cursor' },
  { mode: 'move', label: 'Pan', shortcut: 'M', icon: Hand, group: 'cursor' },
  { mode: 'text', label: 'Text', shortcut: 'T', icon: Type, group: 'draw' },
  { mode: 'pen', label: 'Pen', shortcut: 'N', icon: PenTool, group: 'draw' },
  { mode: 'line', label: 'Line', shortcut: 'L', icon: Route, group: 'draw' },
  { mode: 'delete_lasso', label: 'Lasso', shortcut: 'Shift+L', icon: LassoSelect, group: 'edit' },
]

const SHAPE_TOOLS: ToolConfig[] = [
  { mode: 'polygon', label: 'Polygon', shortcut: 'R', icon: Pentagon, group: 'draw' },
  { mode: 'rectangle', label: 'Rectangle', shortcut: 'B', icon: Box, group: 'draw' },
  { mode: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: Circle, group: 'draw' },
  { mode: 'triangle', label: 'Triangle', shortcut: 'Shift+R', icon: Triangle, group: 'draw' },
]

interface EditorToolboxProps {
  mode: DrawMode
  toolsEnabled: boolean
  isSaving: boolean
  floorRequired: boolean
  hasFloorSelection: boolean
  onSetMode: (mode: DrawMode) => void
  onClearDraft: () => void
}

export function EditorToolbox({
  mode,
  toolsEnabled,
  isSaving,
  floorRequired,
  hasFloorSelection,
  onSetMode,
  onClearDraft,
}: EditorToolboxProps) {
  const floorBlocked = floorRequired && !hasFloorSelection
  const activeTool =
    PRIMARY_TOOLS.find((tool) => tool.mode === mode) ??
    SHAPE_TOOLS.find((tool) => tool.mode === mode)

  return (
    <div className="pointer-events-auto absolute bottom-5 left-1/2 z-40 w-fit max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-slate-500">
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 font-medium text-slate-700">
          Tool: {activeTool?.label ?? 'Select'}
        </span>
        <span className="pr-1 text-slate-400">Draw</span>
      </div>
      <div className="max-w-full overflow-x-auto overflow-y-visible">
        <div className="flex w-max min-w-full items-center gap-2">
        {PRIMARY_TOOLS.map((tool, index) => {
          const Icon = tool.icon
          const isActive = mode === tool.mode
          const isFloorBlocked = floorBlocked && !['select', 'move'].includes(tool.mode)
          const isDisabled = !toolsEnabled || isSaving || isFloorBlocked
          const showSeparator = index > 0 && PRIMARY_TOOLS[index - 1].group !== tool.group

          return (
            <div key={tool.mode} className="flex items-center gap-1.5">
              {showSeparator ? <span className="mx-0.5 h-7 w-px bg-slate-200" aria-hidden="true" /> : null}
              <button
                type="button"
                className={`group relative flex h-11 min-w-11 items-center justify-center rounded-xl border transition ${
                  isActive
                    ? 'border-sky-500 bg-sky-500 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950'
                } disabled:cursor-not-allowed disabled:opacity-45`}
                onClick={() => {
                  onSetMode(tool.mode)
                  if (tool.mode !== mode) onClearDraft()
                }}
                disabled={isDisabled}
                title={`${tool.label} (${tool.shortcut})`}
                aria-label={tool.label}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="pointer-events-none absolute -top-11 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 shadow-lg group-hover:block">
                  {tool.label} · {tool.shortcut}
                </span>
              </button>
            </div>
          )
        })}
          <span className="mx-0.5 h-7 w-px bg-slate-200" aria-hidden="true" />
          {SHAPE_TOOLS.map((tool) => {
            const Icon = tool.icon
            const isActive = mode === tool.mode
            const isDisabled = !toolsEnabled || isSaving || floorBlocked
            return (
              <button
                key={tool.mode}
                type="button"
                className={`group relative flex h-11 min-w-11 items-center justify-center rounded-xl border transition ${
                  isActive
                    ? 'border-sky-500 bg-sky-500 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950'
                } disabled:cursor-not-allowed disabled:opacity-45`}
                onClick={() => {
                  onSetMode(tool.mode)
                  if (tool.mode !== mode) onClearDraft()
                }}
                disabled={isDisabled}
                title={`${tool.label} (${tool.shortcut})`}
                aria-label={tool.label}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="pointer-events-none absolute -top-11 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 shadow-lg group-hover:block">
                  {tool.label} · {tool.shortcut}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      {floorBlocked ? (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-center text-[11px] text-amber-700">
          Select a floor before drawing
        </div>
      ) : null}
    </div>
  )
}
