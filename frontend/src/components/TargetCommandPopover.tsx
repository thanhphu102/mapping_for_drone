import type { CSSProperties } from 'react'
import { Send, X } from 'lucide-react'
import type { CommandDispatchStatus, CommandTarget } from '../types/drone'
import type { ProjectedPoint } from '../hooks/useProjectedTarget'

interface TargetCommandPopoverProps {
  target: CommandTarget
  point: ProjectedPoint | null
  connectedCount: number
  status: CommandDispatchStatus
  onCancel: () => void
  onConfirm: () => void
}

export function TargetCommandPopover({
  target,
  point,
  connectedCount,
  status,
  onCancel,
  onConfirm,
}: TargetCommandPopoverProps) {
  const style = {
    '--target-left': `${point?.x ?? 24}px`,
    '--target-top': `${point?.y ?? 24}px`,
  } as CSSProperties

  return (
    <div className="target-popover" style={style}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-sky-700">
            Target coordinate
          </p>
          <div className="mt-2 space-y-1 font-mono text-xs text-slate-700">
            <div>Lat: {target.lat.toFixed(6)}</div>
            <div>Lon: {target.lon.toFixed(6)}</div>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-500"
          onClick={onCancel}
          aria-label="Cancel target command"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-sky-300"
        onClick={onConfirm}
        disabled={status === 'sending'}
      >
        <Send className="size-4" aria-hidden="true" />
        {status === 'sending'
          ? 'Sending command'
          : `Send to ${connectedCount} drone(s)`}
      </button>
    </div>
  )
}

