import { Map as MapIcon, Square } from 'lucide-react'
import type { EditorBackdropMode } from '../editorBackdropMode'

interface EditorBackdropPickerProps {
  mode: EditorBackdropMode
  onChange: (mode: EditorBackdropMode) => void
  className?: string
}

const options: Array<{
  mode: EditorBackdropMode
  label: string
  Icon: typeof Square
}> = [
  {
    mode: 'white',
    label: 'White',
    Icon: Square,
  },
  {
    mode: 'map',
    label: 'Map',
    Icon: MapIcon,
  },
]

export function EditorBackdropPicker({
  mode,
  onChange,
  className = '',
}: EditorBackdropPickerProps) {
  return (
    <div
      className={`inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white/95 p-1 text-xs font-semibold text-slate-700 shadow-lg backdrop-blur ${className}`}
      role="radiogroup"
      aria-label="Editor backdrop mode"
    >
      {options.map(({ mode: optionMode, label, Icon }) => {
        const active = mode === optionMode
        return (
          <button
            key={optionMode}
            type="button"
            role="radio"
            aria-checked={active}
            className={`inline-flex h-8 min-w-20 items-center justify-center gap-1.5 rounded-md px-2.5 transition focus:outline-none focus:ring-2 focus:ring-sky-500 ${
              active
                ? 'bg-slate-950 text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
            }`}
            onClick={() => onChange(optionMode)}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
