import { Building2, Layers3, Search } from 'lucide-react'
import type { Feature } from 'geojson'
import type { DrawingProject, SpatialFloor } from '../types'
import { useState } from 'react'
import { ImportScanJsonPanel } from './ImportScanJsonPanel'
import type { ImportPolygonPayload, ImportScanPreviewResponse } from '../services/imports'

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
  floorsEnabled: boolean
  onToggleFloorsEnabled: (enabled: boolean) => void
  isTogglingFloors: boolean
  onCreateFloor: () => void
  isCreatingFloor: boolean
  onUpdateFloor: (floor: SpatialFloor, updates: Partial<Pick<SpatialFloor, 'label' | 'code'>>) => void
  onDeleteFloor: (floor: SpatialFloor) => void
  isUpdatingFloor: boolean
  importPreview: ImportScanPreviewResponse | null
  importError: string | null
  importLoading: boolean
  onPreviewImport: (polygons: ImportPolygonPayload[]) => Promise<void>
  onCommitImport: (polygons: ImportPolygonPayload[]) => Promise<void>
  onUnpreviewImport: () => void
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
  floorsEnabled,
  onToggleFloorsEnabled,
  isTogglingFloors,
  onCreateFloor,
  isCreatingFloor,
  onUpdateFloor,
  onDeleteFloor,
  isUpdatingFloor,
  importPreview,
  importError,
  importLoading,
  onPreviewImport,
  onCommitImport,
  onUnpreviewImport,
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
    <aside className="flex h-full w-full flex-col bg-white text-slate-900">
      <header className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          <Building2 className="size-4 text-sky-600" aria-hidden="true" />
          Project
        </div>
        <h2 className="mt-2 truncate text-lg font-semibold text-slate-950">{project?.name ?? 'Loading project...'}</h2>
      </header>

      <section className="border-b border-slate-200 px-5 py-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <Layers3 className="size-3.5" />
            Floors
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={floorsEnabled}
            disabled={!project || isTogglingFloors}
            onClick={() => onToggleFloorsEnabled(!floorsEnabled)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
              floorsEnabled ? 'bg-sky-500' : 'bg-slate-300'
            }`}
            title={floorsEnabled ? 'Disable floors' : 'Enable floors'}
          >
            <span
              className={`inline-block size-4 transform rounded-full bg-white shadow transition ${
                floorsEnabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        {!floorsEnabled ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-500">
            Floors are off. Enable to manage multiple levels for this project.
          </p>
        ) : (
        <div className="space-y-1">
          <button
            type="button"
            className="mb-2 w-full rounded-lg border border-sky-500 bg-sky-500 px-3 py-2 text-left text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50"
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
                  className={`rounded-xl border px-3 py-2.5 text-sm transition ${
                    isActive ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white'
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
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                      />
                      <input
                        value={editCode}
                        onChange={(event) => setEditCode(event.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                      />
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="rounded-lg border border-sky-500 bg-sky-500 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-sky-600"
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
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500"
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
                          isActive ? 'text-slate-950' : 'text-slate-700'
                        }`}
                        onClick={(event) => {
                          event.stopPropagation()
                          onSelectFloor(floor.id)
                        }}
                      >
                        <span className="font-semibold">{floor.label}</span>
                        <span className={`${isActive ? 'text-sky-700' : 'text-slate-500'} text-xs font-medium`}>{floor.code}</span>
                      </button>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
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
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
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
        )}
      </section>

      <details className="border-b border-slate-200 px-5 py-4">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Import
        </summary>
        <div className="mt-3">
          <ImportScanJsonPanel
            disabled={!project}
            preview={importPreview}
            error={importError}
            loading={importLoading}
            onPreview={onPreviewImport}
            onCommit={onCommitImport}
            onUnpreview={onUnpreviewImport}
          />
        </div>
      </details>

      <section className="min-h-0 flex-1 p-5">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Objects</div>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-slate-400" />
          <input
            value={tagFilter}
            onChange={(event) => onTagFilterChange(event.target.value)}
            placeholder="Filter by tag or name"
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none ring-sky-400 focus:ring"
          />
        </div>
        <div className="h-full space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
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
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                    isSelected
                      ? 'border-sky-300 bg-sky-50 text-slate-950'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950'
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
