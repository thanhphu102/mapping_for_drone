import { Check, ChevronLeft, ChevronRight, MapPinned } from 'lucide-react'
import type { Feature, Position } from 'geojson'
import type { DrawingProject, ProjectCanvasConfig, SpatialLayer } from '../types/drone'
import type { SnapPreview } from '../hooks/useSnapEngine'
import { featureMeasurement, localCoordinates } from '../hooks/useDrawingEngine'

interface EditorSidebarProps {
  project: DrawingProject | null
  projectConfig: ProjectCanvasConfig
  layers: SpatialLayer[]
  activeLayer: SpatialLayer | null
  mapZoom: number
  mapReady: boolean
  boundaryRendered: boolean
  visibleFeatures: Feature[]
  draftFeature: GeoJSON.FeatureCollection | null
  hoverCoordinate: Position | null
  snapPreview: SnapPreview | null
  message: string
  onSelectLayer: (layerId: string) => void
  onClearDraft: () => void
  isCollapsed: boolean
  onToggleCollapsed: () => void
}

const modeSummary = {
  region: 'Region tools for routes, zones, waypoints, and obstacles.',
  agriculture: 'Agriculture tools for crop areas, survey paths, and flight planning.',
  campus: 'Campus tools for buildings, gates, roads, and outdoor drone routes.',
  parking: 'Parking tools for slots, entrances, exits, and circulation routes.',
  building: 'Indoor building tools with room, wall, door, and route workflows.',
  indoor: 'Indoor tools with floor-aware geometry and navigation features.',
  custom: 'Generic polygon, line, and point editing for custom spaces.',
} as const

export function EditorSidebar({
  project,
  projectConfig,
  layers,
  activeLayer,
  mapZoom,
  mapReady,
  boundaryRendered,
  visibleFeatures,
  draftFeature,
  hoverCoordinate,
  snapPreview,
  message,
  onSelectLayer,
  onClearDraft,
  isCollapsed,
  onToggleCollapsed,
}: EditorSidebarProps) {
  const localOrigin: Position | null = project ? [project.bbox[0], project.bbox[1]] : null
  const hoverLocal = hoverCoordinate && localOrigin ? localCoordinates(hoverCoordinate, localOrigin) : null
  const ToggleIcon = isCollapsed ? ChevronLeft : ChevronRight

  return (
    <aside className={`relative flex h-full border-l border-slate-200 bg-white ${isCollapsed ? 'w-10' : 'w-[380px] max-w-[42vw]'}`}>
      <button
        type="button"
        className="absolute -left-3 top-6 z-30 flex size-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md transition hover:bg-slate-50"
        onClick={onToggleCollapsed}
        aria-label={isCollapsed ? 'Expand side panel' : 'Collapse side panel'}
      >
        <ToggleIcon className="size-4" aria-hidden="true" />
      </button>

      {isCollapsed ? (
        <div className="flex h-full w-full flex-col items-center justify-center text-[10px] uppercase tracking-wide text-slate-400">
          Info
        </div>
      ) : (
        <div className="flex h-full w-full flex-col">
          <header className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-sky-700">
          <MapPinned className="size-4" aria-hidden="true" />
          Spatial Editor
        </div>
        <h1 className="mt-1 text-lg font-semibold text-slate-950">
          {project?.name ?? 'Loading project'}
        </h1>
        {project ? (
          <p className="mt-1 text-sm capitalize text-slate-500">
            {project.editorMode} · {project.status} · {project.source}
          </p>
        ) : null}
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <h2 className="text-sm font-semibold text-slate-950">Mode</h2>
          <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {project ? modeSummary[project.editorMode] : 'Loading project mode...'}
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-950">Layers</h2>
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {layers.map((layer) => (
              <li key={layer.id}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between px-3 py-2 text-sm ${activeLayer?.id === layer.id ? 'bg-sky-50' : 'bg-white'
                    }`}
                  onClick={() => {
                    if (!layer.locked) {
                      onSelectLayer(layer.id)
                      onClearDraft()
                    }
                  }}
                  disabled={layer.locked}
                >
                  <span>
                    {layer.name}
                    <span className="ml-2 text-xs text-slate-500">
                      z{layer.minZoom ?? 0}-{layer.maxZoom ?? 24}
                    </span>
                  </span>
                  {layer.locked ? (
                    <span className="text-xs font-medium text-slate-500">Locked</span>
                  ) : activeLayer?.id === layer.id ? (
                    <span className="text-xs font-medium text-sky-700">Active</span>
                  ) : (
                    <Check className="size-4 text-emerald-600" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-950">Workspace</h2>
          <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Active layer: {activeLayer?.name ?? 'None'} · Zoom {mapZoom.toFixed(1)} ·
            {mapZoom >= projectConfig.precisionZoom
              ? ' Precision scale'
              : mapZoom >= projectConfig.detailZoom
                ? ' Object scale'
                : ' Region scale'}
          </p>
        </section>

        {project && project.floors.length > 1 ? (
          <section>
            <h2 className="text-sm font-semibold text-slate-950">Floors</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {project.floors.map((floor) => (
                <button
                  key={floor.id}
                  type="button"
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700"
                  disabled
                >
                  {floor.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <h2 className="text-sm font-semibold text-slate-950">Inspector</h2>
          <dl className="mt-2 space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
            <div>
              <dt className="text-slate-500">Cursor</dt>
              <dd className="font-mono text-xs text-slate-950">
                {hoverCoordinate
                  ? `${hoverCoordinate[1].toFixed(6)}, ${hoverCoordinate[0].toFixed(6)}`
                  : '-'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Local</dt>
              <dd className="font-mono text-xs text-slate-950">
                {hoverLocal
                  ? `X ${hoverLocal.x.toFixed(2)}m · Y ${hoverLocal.y.toFixed(2)}m`
                  : '-'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Measurement</dt>
              <dd className="text-slate-950">{featureMeasurement(draftFeature)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Visible features</dt>
              <dd className="text-slate-950">{visibleFeatures.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Map ready</dt>
              <dd className="text-slate-950">{mapReady ? 'yes' : 'no'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Boundary ready</dt>
              <dd className="text-slate-950">{boundaryRendered ? 'yes' : 'no'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Snapping</dt>
              <dd className="text-slate-950">
                {projectConfig.snapping.enabled
                  ? snapPreview
                    ? `Locked to ${snapPreview.kind}`
                    : 'Enabled'
                  : 'Disabled'}
              </dd>
            </div>
          </dl>
        </section>

        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {message}
        </p>
          </div>
        </div>
      )}
    </aside>
  )
}
