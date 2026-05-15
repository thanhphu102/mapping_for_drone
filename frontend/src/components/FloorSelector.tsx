import type { SpatialFloor } from '../types/drone'

interface FloorSelectorProps {
  floors: SpatialFloor[]
  selectedFloorId: string | null
  onSelectFloor: (floorId: string) => void
}

export function FloorSelector({
  floors,
  selectedFloorId,
  onSelectFloor,
}: FloorSelectorProps) {
  if (floors.length === 0) {
    return null
  }

  // Sort floors top-to-bottom: highest level first
  const sortedFloors = [...floors].sort((a, b) => b.level - a.level)

  return (
    <div className="floor-selector absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col rounded-xl border border-slate-200/80 bg-white/95 shadow-lg backdrop-blur-sm">
      {sortedFloors.map((floor) => {
        const isSelected = floor.id === selectedFloorId
        return (
          <button
            key={floor.id}
            type="button"
            className={`floor-selector-btn relative flex h-10 w-12 items-center justify-center text-sm font-semibold transition-all first:rounded-t-xl last:rounded-b-xl ${
              isSelected
                ? 'bg-sky-600 text-white shadow-inner'
                : 'text-slate-700 hover:bg-sky-50 hover:text-sky-700'
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
