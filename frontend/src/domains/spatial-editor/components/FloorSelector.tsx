import type { SpatialFloor } from '../types'

interface FloorSelectorProps {
  floors: SpatialFloor[]
  selectedFloorId: string | null
  onSelectFloor: (floorId: string) => void
  onCreateFloor?: () => void
  isRequired?: boolean
}

export function FloorSelector({
  floors,
  selectedFloorId,
  onSelectFloor,
  onCreateFloor,
  isRequired = false,
}: FloorSelectorProps) {
  if (floors.length === 0) {
    return (
      <div className="floor-selector absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col rounded-xl border border-slate-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur-sm">
        <div className="font-semibold text-slate-800">No floors yet</div>
        <p className="mt-1 text-slate-500">
          {isRequired ? 'Select or create a floor to draw indoor features.' : 'Create a floor to start drawing.'}
        </p>
        <button
          type="button"
          className="mt-3 rounded-md bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-700"
          onClick={onCreateFloor}
          disabled={!onCreateFloor}
        >
          Create floor
        </button>
      </div>
    )
  }

  const sortedFloors = [...floors].sort((a, b) => b.level - a.level)

  return (
    <div className="floor-selector absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col rounded-xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur-sm">
      {sortedFloors.map((floor) => {
        const isSelected = floor.id === selectedFloorId
        return (
          <button
            key={floor.id}
            type="button"
            className={`floor-selector-btn relative flex h-10 w-12 items-center justify-center text-sm font-semibold transition-all first:rounded-t-xl last:rounded-b-xl ${
              isSelected
                ? 'bg-sky-600 text-white shadow-inner'
                : 'bg-white text-slate-800 hover:bg-sky-50 hover:text-sky-700'
            }`}
            onClick={() => onSelectFloor(floor.id)}
            aria-label={`Floor ${floor.label}`}
            title={`Floor ${floor.code} (level ${floor.level})`}
          >
            {floor.label}
            {isSelected ? (
              <span className="floor-indicator absolute -left-1 h-5 w-1 rounded-r-full bg-sky-600" />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
