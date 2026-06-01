import { Map as MapIcon, Satellite } from 'lucide-react'
import type { GoogleBaseMapMode } from '../baseMapModes'

interface GoogleBaseMapPickerProps {
  mode: GoogleBaseMapMode
  onChange: (mode: GoogleBaseMapMode) => void
  className?: string
}

const options: Array<{
  mode: GoogleBaseMapMode
  label: string
  Icon: typeof MapIcon
}> = [
  {
    mode: 'map',
    label: 'Map',
    Icon: MapIcon,
  },
  {
    mode: 'satellite',
    label: 'Satellite',
    Icon: Satellite,
  },
]

export function GoogleBaseMapPicker({
  mode,
  onChange,
  className = '',
}: GoogleBaseMapPickerProps) {
  return (
    <div
      className={`inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white/95 p-1 text-xs font-semibold text-slate-700 shadow-lg backdrop-blur ${className}`}
      role="radiogroup"
      aria-label="Google map layer"
    >
      {options.map(({ mode: optionMode, label, Icon }) => {
        const active = mode === optionMode
        return (
          <button
            key={optionMode}
            type="button"
            role="radio"
            aria-checked={active}
            className={`inline-flex h-8 min-w-24 items-center justify-center gap-1.5 rounded-md px-2.5 transition focus:outline-none focus:ring-2 focus:ring-sky-500 ${
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
