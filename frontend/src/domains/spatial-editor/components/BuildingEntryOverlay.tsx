import { Building2 } from 'lucide-react'

interface BuildingEntryOverlayProps {
  buildingName: string | null
  hasChildProject: boolean
  onOpenIndoorMap: () => void
  onCreateIndoorMap: () => void
}

export function BuildingEntryOverlay({
  buildingName,
  hasChildProject,
  onOpenIndoorMap,
  onCreateIndoorMap,
}: BuildingEntryOverlayProps) {
  return (
    <div className="building-entry-overlay absolute bottom-6 left-1/2 z-20 w-[320px] -translate-x-1/2 rounded-xl border border-slate-200/80 bg-white/95 p-4 shadow-xl backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-sky-50">
          <Building2 className="size-5 text-sky-600" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-950">
            {buildingName ?? 'Building'}
          </h3>
          <p className="text-xs text-slate-500">
            {hasChildProject ? 'Indoor map available' : 'No indoor map yet'}
          </p>
        </div>
      </div>
      <div className="mt-3">
        {hasChildProject ? (
          <button
            type="button"
            className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700 active:bg-sky-800"
            onClick={onOpenIndoorMap}
          >
            Open Indoor Map
          </button>
        ) : (
          <button
            type="button"
            className="w-full rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-100 active:bg-sky-200"
            onClick={onCreateIndoorMap}
          >
            Create Indoor Map
          </button>
        )}
      </div>
    </div>
  )
}
