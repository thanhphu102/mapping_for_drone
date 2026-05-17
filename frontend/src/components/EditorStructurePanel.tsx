import { Building2, Layers3, Search } from 'lucide-react'
import type { Feature } from 'geojson'
import type { DrawingProject, SpatialFloor } from '../types/drone'
import { useState } from 'react'

interface EditorStructurePanelProps {
  project: DrawingProject | null
  floors: SpatialFloor[]
  selectedFloorId: string | null
  onSelectFloor: (floorId: string) => void
  selectedFeatureIds: string[]
  onSelectFeatureIds: (ids: string[]) => void
  visibleFeatures: Feature[]
  tagFilter: string
  onTagFilterChange: (value: string) => void
  onCreateFloor: () => void
  isCreatingFloor: boolean
  onUpdateFloor: (floor: SpatialFloor, updates: Partial<Pick<SpatialFloor, 'label' | 'code'>>) => void
  onDeleteFloor: (floor: SpatialFloor) => void
  isUpdatingFloor: boolean
}

function featureTitle(feature: Feature) {
  const props = (feature.properties ?? {}) as Record<string, unknown>
  return String(props.name || props.tag || props.featureType || 'Unnamed object')
}

function featureTag(feature: Feature) {
  const props = (feature.properties ?? {}) as Record<string, unknown>
  return typeof props.tag === 'string' ? props.tag : ''
}

export function EditorStructurePanel({
  project,
  floors,
  selectedFloorId,
  onSelectFloor,
  selectedFeatureIds,
  onSelectFeatureIds,
  visibleFeatures,
  tagFilter,
  onTagFilterChange,
  onCreateFloor,
  isCreatingFloor,
  onUpdateFloor,
  onDeleteFloor,
  isUpdatingFloor,
}: EditorStructurePanelProps) {
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editCode, setEditCode] = useState('')
  const normalizedFilter = tagFilter.trim().toLowerCase()
  const filteredFeatures = visibleFeatures.filter((feature) => {
    if (!normalizedFilter) return true
    const tag = featureTag(feature).toLowerCase()
    const title = featureTitle(feature).toLowerCase()
    return tag.includes(normalizedFilter) || title.includes(normalizedFilter)
  })

  return (
    <aside className="flex h-full w-[320px] max-w-[34vw] flex-col border-r border-slate-200 bg-white text-slate-900">
      <header className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <Building2 className="size-4 text-sky-600" aria-hidden="true" />
          Structure
        </div>
        <h2 className="mt-1 truncate text-base font-semibold text-slate-900">{project?.name ?? 'Loading project...'}</h2>
      </header>

      <section className="border-b border-slate-200 px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Layers3 className="size-3.5" />
          Floors
        </div>
        <div className="space-y-1">
          <button
            type="button"
            className="mb-1 w-full rounded-md border border-sky-300 bg-sky-100 px-2 py-1.5 text-left text-xs font-semibold text-sky-900 shadow-sm transition hover:border-sky-400 hover:bg-sky-200 disabled:opacity-50"
            onClick={onCreateFloor}
            disabled={isCreatingFloor}
          >
            {isCreatingFloor ? 'Creating floor...' : 'Add floor'}
          </button>
          {floors.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-500">No floors</div>
          ) : (
            [...floors].sort((a, b) => b.level - a.level).map((floor) => {
              const isActive = floor.id === selectedFloorId
              const isEditing = editingFloorId === floor.id
              return (
                <div
                  key={floor.id}
                  className={`rounded-md border px-2 py-1.5 text-sm ${
                    isActive ? 'border-sky-300 bg-sky-50 shadow-sm' : 'border-slate-200 bg-white'
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectFloor(floor.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelectFloor(floor.id)
                    }
                  }}
                >
                  {isEditing ? (
                    <div
                      className="space-y-1.5"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <input
                        value={editLabel}
                        onChange={(event) => setEditLabel(event.target.value)}
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900"
                      />
                      <input
                        value={editCode}
                        onChange={(event) => setEditCode(event.target.value)}
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900"
                      />
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="rounded border border-sky-300 bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900 shadow-sm transition hover:border-sky-400 hover:bg-sky-200"
                          disabled={isUpdatingFloor}
                          onClick={() => {
                            onUpdateFloor(floor, { label: editLabel.trim(), code: editCode.trim() })
                            setEditingFloorId(null)
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300"
                          onClick={() => setEditingFloorId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`flex w-full items-center justify-between text-left transition ${
                          isActive ? 'text-slate-950' : 'text-slate-700 hover:text-slate-950'
                        }`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="font-semibold">{floor.label}</span>
                        <span className={`${isActive ? 'text-sky-700' : 'text-slate-500'} text-xs font-medium`}>{floor.code}</span>
                      </button>
                      <div className="mt-1 flex gap-1">
                        <button
                          type="button"
                          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 hover:text-slate-950"
                          onClick={(event) => {
                            event.stopPropagation()
                            setEditingFloorId(floor.id)
                            setEditLabel(floor.label)
                            setEditCode(floor.code)
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 shadow-sm transition hover:border-rose-400 hover:bg-rose-100"
                          disabled={isUpdatingFloor}
                          onClick={(event) => {
                            event.stopPropagation()
                            onDeleteFloor(floor)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>
      </section>

      <section className="min-h-0 flex-1 p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Objects
        </div>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-slate-400" />
          <input
            value={tagFilter}
            onChange={(event) => onTagFilterChange(event.target.value)}
            placeholder="Filter by tag or name"
            className="w-full rounded-md border border-slate-200 bg-white py-2 pl-8 pr-2 text-sm text-slate-900 outline-none ring-sky-400 focus:ring"
          />
        </div>
        <div className="h-full space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
          {filteredFeatures.length === 0 ? (
            <div className="px-2 py-3 text-xs text-slate-500">No objects in this view</div>
          ) : (
            filteredFeatures.map((feature) => {
              const id = String(feature.id ?? feature.properties?.id ?? '')
              const isSelected = selectedFeatureIds.includes(id)
              const tag = featureTag(feature)
              return (
                <button
                  key={id}
                  type="button"
                  className={`w-full rounded-md border px-2 py-1.5 text-left transition ${
                    isSelected
                      ? 'border-sky-300 bg-sky-50 text-slate-950 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950'
                  }`}
                  onClick={() => onSelectFeatureIds([id])}
                >
                  <div className="truncate text-sm font-semibold text-slate-950">{featureTitle(feature)}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-600">{tag || 'No tag'} · {feature.geometry.type}</div>
                </button>
              )
            })
          )}
        </div>
      </section>
    </aside>
  )
}
