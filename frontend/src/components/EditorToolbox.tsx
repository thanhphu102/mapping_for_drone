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
  { mode: 'move', label: 'Hand', shortcut: 'M', icon: Hand, group: 'cursor' },
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
    <div className="pointer-events-auto absolute bottom-5 left-1/2 z-40 w-fit max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-2xl border border-slate-700/70 bg-slate-900/95 p-2 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-slate-300">
        <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5">
          Tool: {activeTool?.label ?? 'Select'}
        </span>
        <span className="text-slate-400">Hold Shift: Square/Circle</span>
      </div>
      <div className="max-w-full overflow-x-auto overflow-y-visible">
        <div className="flex w-max min-w-full items-center gap-1.5">
        {PRIMARY_TOOLS.map((tool, index) => {
          const Icon = tool.icon
          const isActive = mode === tool.mode
          const isFloorBlocked = floorBlocked && !['select', 'move'].includes(tool.mode)
          const isDisabled = !toolsEnabled || isSaving || isFloorBlocked
          const showSeparator = index > 0 && PRIMARY_TOOLS[index - 1].group !== tool.group

          return (
            <div key={tool.mode} className="flex items-center gap-1.5">
              {showSeparator ? <span className="mx-0.5 h-7 w-px bg-slate-700" aria-hidden="true" /> : null}
              <button
                type="button"
                className={`group relative flex h-10 min-w-10 items-center justify-center rounded-lg border px-2 transition ${
                  isActive
                    ? 'border-sky-400/80 bg-sky-500 text-white shadow-[0_0_0_1px_rgba(56,189,248,0.3)]'
                    : 'border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500 hover:bg-slate-700'
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
                <span className="pointer-events-none absolute -top-11 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 shadow-lg group-hover:block">
                  {tool.label} · {tool.shortcut}
                </span>
              </button>
            </div>
          )
        })}
          <span className="mx-0.5 h-7 w-px bg-slate-700" aria-hidden="true" />
          {SHAPE_TOOLS.map((tool) => {
            const Icon = tool.icon
            const isActive = mode === tool.mode
            const isDisabled = !toolsEnabled || isSaving || floorBlocked
            return (
              <button
                key={tool.mode}
                type="button"
                className={`group relative flex h-10 min-w-10 items-center justify-center rounded-lg border px-2 transition ${
                  isActive
                    ? 'border-sky-400/80 bg-sky-500 text-white shadow-[0_0_0_1px_rgba(56,189,248,0.3)]'
                    : 'border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500 hover:bg-slate-700'
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
                <span className="pointer-events-none absolute -top-11 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 shadow-lg group-hover:block">
                  {tool.label} · {tool.shortcut}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      {floorBlocked ? (
        <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-center text-[11px] text-amber-200">
          Select a floor before drawing
        </div>
      ) : null}
    </div>
  )
}
