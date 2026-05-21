import { Layers3 } from 'lucide-react'
import type { SpatialFloor } from '../types'

interface FloorPanelProps {
  floors: SpatialFloor[]
  selectedFloorId: string | null
  onCreateFloor: () => void
  isCreatingFloor: boolean
}

export function FloorPanel({
  floors,
  selectedFloorId,
  onCreateFloor,
  isCreatingFloor,
}: FloorPanelProps) {
  const selectedFloor = floors.find((floor) => floor.id === selectedFloorId)

  return (
    <section className="border-b border-slate-200 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Layers3 className="size-3.5" />
        Floors
      </div>
      <button
        type="button"
        className="mb-1 w-full rounded-md border border-sky-300 bg-sky-100 px-2 py-1.5 text-left text-xs font-semibold text-sky-900 shadow-sm transition hover:border-sky-400 hover:bg-sky-200 disabled:opacity-50"
        onClick={onCreateFloor}
        disabled={isCreatingFloor}
      >
        {isCreatingFloor ? 'Creating floor...' : 'Add floor'}
      </button>
      <div className="text-xs text-slate-500">
        {selectedFloor ? `Selected ${selectedFloor.label}` : `${floors.length} floor(s)`}
      </div>
    </section>
  )
}

