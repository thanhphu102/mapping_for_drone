import {
  Ban,
  Box,
  ChevronDown,
  Circle,
  Hand,
  LassoSelect,
  MousePointer2,
  PenTool,
  Pentagon,
  Route,
  Shapes,
  Triangle,
  Type,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { featureTypeForMode, type DrawMode } from '../hooks/useDrawingEngine'

interface ToolConfig {
  mode: DrawMode
  label: string
  shortcut: string
  icon: typeof MousePointer2
  group: 'cursor' | 'draw' | 'edit'
  /** Override the feature type produced by this tool (defaults to featureTypeForMode). */
  featureType?: string
}

function toolFeatureType(tool: ToolConfig): string {
  return tool.featureType ?? featureTypeForMode(tool.mode)
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
  { mode: 'polygon', label: 'No-Fly Zone', shortcut: 'Z', icon: Ban, group: 'draw', featureType: 'no_fly_zone' },
]

interface EditorToolboxProps {
  mode: DrawMode
  activeFeatureType: string
  toolsEnabled: boolean
  isSaving: boolean
  floorRequired: boolean
  hasFloorSelection: boolean
  onSetMode: (mode: DrawMode, featureType?: string | null) => void
  onClearDraft: () => void
}

export function EditorToolbox({
  mode,
  activeFeatureType,
  toolsEnabled,
  isSaving,
  floorRequired,
  hasFloorSelection,
  onSetMode,
  onClearDraft,
}: EditorToolboxProps) {
  const floorBlocked = floorRequired && !hasFloorSelection
  const isToolActive = (tool: ToolConfig) =>
    tool.group === 'draw'
      ? mode === tool.mode && activeFeatureType === toolFeatureType(tool)
      : mode === tool.mode
  const activeShapeTool = SHAPE_TOOLS.find(isToolActive)
  const activeTool = PRIMARY_TOOLS.find(isToolActive) ?? activeShapeTool

  return (
    <div className="pointer-events-auto absolute bottom-5 left-1/2 z-40 w-fit max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-slate-500">
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 font-medium text-slate-700">
          Tool: {activeTool?.label ?? 'Select'}
        </span>
        <span className="pr-1 text-slate-400">Draw</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PRIMARY_TOOLS.map((tool, index) => {
          const Icon = tool.icon
          const isActive = isToolActive(tool)
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
                  onSetMode(tool.mode, tool.featureType ?? null)
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
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={`flex h-11 items-center gap-1.5 rounded-xl border px-3 transition ${
                activeShapeTool
                  ? 'border-sky-500 bg-sky-500 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950'
              } disabled:cursor-not-allowed disabled:opacity-45`}
              disabled={!toolsEnabled || isSaving || floorBlocked}
              title="Shapes"
              aria-label="Shapes"
            >
              <Shapes className="size-4" aria-hidden="true" />
              <span className="whitespace-nowrap text-xs font-medium">
                {activeShapeTool?.label ?? 'Shapes'}
              </span>
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="end"
              sideOffset={8}
              className="z-50 min-w-[180px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
            >
              {SHAPE_TOOLS.map((tool) => {
                const Icon = tool.icon
                const isActive = isToolActive(tool)
                return (
                  <DropdownMenu.Item
                    key={`${tool.mode}:${tool.featureType ?? ''}`}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition data-[highlighted]:bg-slate-100 ${
                      isActive ? 'font-semibold text-sky-700' : 'text-slate-700'
                    }`}
                    onSelect={() => {
                      onSetMode(tool.mode, tool.featureType ?? null)
                      if (tool.mode !== mode || activeFeatureType !== toolFeatureType(tool)) onClearDraft()
                    }}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span className="flex-1">{tool.label}</span>
                    <span className="text-[11px] text-slate-400">{tool.shortcut}</span>
                  </DropdownMenu.Item>
                )
              })}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {floorBlocked ? (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-center text-[11px] text-amber-700">
          Select a floor before drawing
        </div>
      ) : null}
    </div>
  )
}
