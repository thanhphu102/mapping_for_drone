import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Geometry } from 'geojson'
import { AlertTriangle, Ban, Check, Loader2, Navigation, Search, X } from 'lucide-react'
import {
  fitVietnamOverview,
  useBaseMap,
} from '../hooks/useBaseMap'
import { PUBLISHED_OVERLAY_FLOOR_PANEL_MIN_ZOOM } from '../layers/overlayLayers'
import { useOsmPreviewLayers } from '../hooks/useOsmPreviewLayers'
import { useOverlaySelection } from '../hooks/useOverlaySelection'
import { usePublishedOverlays } from '../hooks/usePublishedOverlays'
import { useDroneMarkers } from '../hooks/useDroneMarkers'
import { useDroneTracking } from '../../tracking/hooks/useDroneTracking'
import { useProjectedTarget } from '../hooks/useProjectedTarget'
import {
  parseCoordinateQuery,
  searchLocations,
  type LocationSearchResult,
} from '../services/locationSearch'
import type {
  CommandDispatchStatus,
  CommandTarget,
  DroneRegistry,
  MapTargetDraft,
} from '../../drone/types'
import type { OsmCandidate } from '../../osm/types'
import type { SaveTrackedRouteResponse } from '../../tracking/types'
import { TargetCommandPopover } from '../../drone/components/TargetCommandPopover'
import { useNoFlyZoneMonitor } from '../../drone/hooks/useNoFlyZoneMonitor'
import {
  collectNoFlyZones,
  isPointInNoFlyZones,
  type NoFlyZone,
} from '../noFlyZones'
import { createNoFlyZone } from '../services/noFlyZones'
import type { NoticeState } from '../../../shared/components/Notice'

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tagName = target.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true
  }
  return Boolean(target.closest('[contenteditable="true"]'))
}

interface DroneMapProps {
  dronesById: DroneRegistry
  dirtyIds: string[]
  selectedTarget: CommandTarget | null
  connectedCount: number
  commandStatus: CommandDispatchStatus
  highlightedCandidate: OsmCandidate | null
  selectedBoundaryGeometry: Geometry | null
  calibrationDragEnabled?: boolean
  onCalibrationDragDelta?: (deltaLon: number, deltaLat: number) => void
  onCalibrationRotateDelta?: (deltaDeg: number) => void
  previewCalibration?: {
    offsetLon: number
    offsetLat: number
    rotationDeg: number
  } | null
  isFetchingCandidates: boolean
  isFetchingFull: boolean
  locationFetchMessage: { tone: 'success' | 'error' | 'info'; text: string } | null
  onTargetSelect: (target: MapTargetDraft) => void
  onFetchLocation: () => void
  onCancelTarget: () => void
  onConfirmTarget: () => void
  onTrackingNotice: (notice: { tone: 'success' | 'error' | 'info'; title: string; detail?: string }) => void
  onGeofenceBreach: (notice: NoticeState) => void
  selectedTrackingDroneId: string | null
  onTrackingStateChange: (state: {
    status: 'idle' | 'tracking' | 'paused' | 'completed'
    pointsCount: number
    maxPoints: number
    canSave: boolean
    isSaving: boolean
    activeDroneId: string | null
  }) => void
  onTrackingControllerReady: (controller: {
    startTracking: (droneId: string) => void
    stopTracking: () => void
    clearTracking: () => void
    saveTrackingRoute: () => Promise<SaveTrackedRouteResponse>
  } | null) => void
  disableTargetSelect?: boolean
  hideTargetPopover?: boolean
}

export function DroneMap({
  dronesById,
  dirtyIds,
  selectedTarget,
  connectedCount,
  commandStatus,
  highlightedCandidate,
  selectedBoundaryGeometry,
  calibrationDragEnabled = false,
  onCalibrationDragDelta,
  onCalibrationRotateDelta,
  previewCalibration = null,
  isFetchingCandidates,
  isFetchingFull,
  locationFetchMessage,
  onTargetSelect,
  onFetchLocation,
  onCancelTarget,
  onConfirmTarget,
  onTrackingNotice,
  onGeofenceBreach,
  selectedTrackingDroneId,
  onTrackingStateChange,
  onTrackingControllerReady,
  disableTargetSelect = false,
  hideTargetPopover = false,
}: DroneMapProps) {
  const isTrackingRef = useRef(false)
  const stopTrackingRef = useRef<() => void>(() => {})
  const searchAbortRef = useRef<AbortController | null>(null)
  const searchPanelRef = useRef<HTMLDivElement | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [isDrawingZone, setIsDrawingZone] = useState(false)
  const [zonePoints, setZonePoints] = useState<[number, number][]>([])
  const [isSavingZone, setIsSavingZone] = useState(false)
  const isDrawingZoneRef = useRef(false)
  const noFlyZonesRef = useRef<NoFlyZone[]>([])
  const handleMapTargetSelect = useCallback((target: MapTargetDraft) => {
    // While drawing a no-fly zone, map clicks add polygon vertices instead.
    if (isDrawingZoneRef.current) {
      setZonePoints((points) => [...points, [target.lon, target.lat]])
      return
    }
    if (disableTargetSelect) {
      return
    }
    if (isTrackingRef.current) {
      stopTrackingRef.current()
      onTrackingNotice({
        tone: 'info',
        title: 'Tracking stopped',
        detail: 'Left click stops route tracking quickly.',
      })
      return
    }
    // Block commanding a drone into a restricted area.
    if (isPointInNoFlyZones([target.lon, target.lat], noFlyZonesRef.current)) {
      onGeofenceBreach({
        tone: 'error',
        title: 'Command blocked',
        detail: 'Target is inside a No-Fly Zone.',
      })
      return
    }
    onTargetSelect(target)
  }, [disableTargetSelect, onGeofenceBreach, onTargetSelect, onTrackingNotice])
	  const {
    containerRef,
    map,
    mapStatus,
  } = useBaseMap(handleMapTargetSelect)
  const tracking = useDroneTracking({
    map,
    onNotice: onTrackingNotice,
  })
  useEffect(() => {
    stopTrackingRef.current = tracking.stopTracking
  }, [tracking.stopTracking])
  useEffect(() => {
    onTrackingControllerReady({
      startTracking: tracking.startTracking,
      stopTracking: tracking.stopTracking,
      clearTracking: tracking.clearTracking,
      saveTrackingRoute: tracking.saveTrackingRoute,
    })
    return () => onTrackingControllerReady(null)
  }, [
    onTrackingControllerReady,
    tracking.clearTracking,
    tracking.saveTrackingRoute,
    tracking.startTracking,
    tracking.stopTracking,
  ])
  useEffect(() => {
    onTrackingStateChange({
      status: tracking.status,
      pointsCount: tracking.points.length,
      maxPoints: tracking.maxPoints,
      canSave: tracking.canSave,
      isSaving: tracking.isSaving,
      activeDroneId: tracking.droneId,
    })
  }, [
    onTrackingStateChange,
    tracking.canSave,
    tracking.droneId,
    tracking.isSaving,
    tracking.maxPoints,
    tracking.points.length,
    tracking.status,
  ])
  useEffect(() => {
    isTrackingRef.current = tracking.status === 'tracking'
  }, [tracking.status])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!searchPanelRef.current?.contains(event.target as Node)) {
        setSearchOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const handleQuickStop = (event: KeyboardEvent) => {
      if (tracking.status !== 'tracking') {
        return
      }
      if (isEditableEventTarget(event.target)) {
        return
      }
      if (event.key !== 'Enter' && event.key !== '/') {
        return
      }
      event.preventDefault()
      tracking.stopTracking()
      onTrackingNotice({
        tone: 'info',
        title: 'Tracking stopped',
        detail: 'Quick stop via keyboard.',
      })
    }
    window.addEventListener('keydown', handleQuickStop)
    return () => window.removeEventListener('keydown', handleQuickStop)
  }, [onTrackingNotice, tracking])
  const targetPoint = useProjectedTarget(map, selectedTarget)
  const {
    overlayProjects,
    setOverlayProjects,
    selectedOverlayProjectId,
    setSelectedOverlayProjectId,
    selectedOverlayFloorId,
    setSelectedOverlayFloorId,
    overlayZoom,
    setOverlayZoom,
    setOverlayCenter,
    isDeletingOverlayProject,
    setIsDeletingOverlayProject,
    overlayProjectsRef,
    selectedOverlayProjectIdRef,
    selectedOverlayFloorIdRef,
    scheduleOverlayRefreshRef,
    selectedOverlayProject,
    overlayFloors,
    nearestOverlayProjects,
	  } = useOverlaySelection()
  useNoFlyZoneMonitor({
    dronesById,
    overlayProjects,
    selectedOverlayFloorId,
    onBreach: onGeofenceBreach,
  })

  // Active no-fly zones, shared by the breach monitor and the command block.
  const noFlyZones = useMemo(
    () => collectNoFlyZones(overlayProjects, selectedOverlayFloorId),
    [overlayProjects, selectedOverlayFloorId],
  )
  useEffect(() => {
    noFlyZonesRef.current = noFlyZones
  }, [noFlyZones])
  useEffect(() => {
    isDrawingZoneRef.current = isDrawingZone
  }, [isDrawingZone])

  const startDrawingZone = useCallback(() => {
    onCancelTarget()
    setZonePoints([])
    setIsDrawingZone(true)
  }, [onCancelTarget])

  const cancelDrawingZone = useCallback(() => {
    setIsDrawingZone(false)
    setZonePoints([])
  }, [])

  const finishDrawingZone = useCallback(async () => {
    if (zonePoints.length < 3) {
      onGeofenceBreach({
        tone: 'error',
        title: 'Need more points',
        detail: 'A no-fly zone needs at least 3 points.',
      })
      return
    }
    setIsSavingZone(true)
    try {
      await createNoFlyZone(zonePoints, 'No-Fly Zone')
      onGeofenceBreach({
        tone: 'success',
        title: 'No-Fly Zone saved',
        detail: 'The restricted area is now active.',
      })
      setIsDrawingZone(false)
      setZonePoints([])
      scheduleOverlayRefreshRef.current?.()
    } catch (error) {
      onGeofenceBreach({
        tone: 'error',
        title: 'Could not save zone',
        detail: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setIsSavingZone(false)
    }
  }, [onGeofenceBreach, scheduleOverlayRefreshRef, zonePoints])

  // Render the in-progress no-fly polygon on the map.
  useEffect(() => {
    if (!map) return
    const sourceId = 'nfz-draft'
    const fillId = 'nfz-draft-fill'
    const lineId = 'nfz-draft-line'
    const pointId = 'nfz-draft-point'

    const ensureLayers = () => {
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      }
      if (!map.getLayer(fillId)) {
        map.addLayer({ id: fillId, type: 'fill', source: sourceId, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.2 } })
      }
      if (!map.getLayer(lineId)) {
        map.addLayer({ id: lineId, type: 'line', source: sourceId, paint: { 'line-color': '#ef4444', 'line-width': 2, 'line-dasharray': [2, 1] } })
      }
      if (!map.getLayer(pointId)) {
        map.addLayer({ id: pointId, type: 'circle', source: sourceId, filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#ef4444' } })
      }
    }

    const updateData = () => {
      const source = map.getSource(sourceId) as { setData?: (data: unknown) => void } | undefined
      if (!source?.setData) return
      const features: Record<string, unknown>[] = []
      zonePoints.forEach((p) => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }))
      if (zonePoints.length >= 2) {
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: zonePoints }, properties: {} })
      }
      if (zonePoints.length >= 3) {
        features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...zonePoints, zonePoints[0]]] }, properties: {} })
      }
      source.setData({ type: 'FeatureCollection', features })
    }

    const apply = () => {
      ensureLayers()
      updateData()
    }
    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('load', apply)
    }
    return () => {
      map.off('load', apply)
    }
  }, [map, zonePoints])

  const handleFocusVietnam = useCallback(() => {
    if (!map) return
    fitVietnamOverview(map)
  }, [map])

  const focusTarget = useCallback((target: MapTargetDraft) => {
    onTargetSelect(target)
    if (!map) {
      return
    }
    map.easeTo({
      center: [target.lon, target.lat],
      zoom: Math.max(map.getZoom(), 16),
      duration: 700,
      essential: true,
    })
  }, [map, onTargetSelect])

  const handleSearchSubmit = useCallback(async () => {
    const trimmedQuery = searchQuery.trim()
    if (!trimmedQuery) {
      setSearchError('Enter a place name or coordinates.')
      setSearchResults([])
      setSearchOpen(true)
      return
    }

    const coordinateTarget = parseCoordinateQuery(trimmedQuery)
    if (coordinateTarget) {
      setSearchError(null)
      setSearchResults([])
      setSearchOpen(false)
      focusTarget(coordinateTarget)
      return
    }

    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    setSearchLoading(true)
    setSearchError(null)
    setSearchOpen(true)

    try {
      const results = await searchLocations(trimmedQuery, controller.signal)
      setSearchResults(results)
      if (results.length === 0) {
        setSearchError('No place matched that search.')
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }
      setSearchResults([])
      setSearchError(
        error instanceof Error ? error.message : 'Unable to search this place right now.',
      )
    } finally {
      if (!controller.signal.aborted) {
        setSearchLoading(false)
      }
    }
  }, [focusTarget, searchQuery])

  const handleSelectSearchResult = useCallback((result: LocationSearchResult) => {
    setSearchQuery(result.label)
    setSearchResults([])
    setSearchError(null)
    setSearchOpen(false)
    focusTarget({
      lat: result.lat,
      lon: result.lon,
    })
  }, [focusTarget])

  useDroneMarkers({
    map,
    dronesById,
    dirtyIds,
  })

  const { handleDeleteOverlayProject } = usePublishedOverlays({
    map,
    overlayProjects,
    setOverlayProjects,
    selectedOverlayProjectId,
    selectedOverlayFloorId,
    selectedOverlayProject,
    setSelectedOverlayProjectId,
    setSelectedOverlayFloorId,
    setOverlayZoom,
    setOverlayCenter,
    setIsDeletingOverlayProject,
    overlayProjectsRef,
    selectedOverlayProjectIdRef,
    selectedOverlayFloorIdRef,
    scheduleOverlayRefreshRef,
  })

  useOsmPreviewLayers({
    map,
    highlightedCandidate,
    selectedBoundaryGeometry,
    calibrationDragEnabled,
    onCalibrationDragDelta,
    onCalibrationRotateDelta,
    previewCalibration,
  })

  useEffect(() => {
    if (
      tracking.status === 'tracking' &&
      selectedTrackingDroneId &&
      tracking.droneId &&
      selectedTrackingDroneId !== tracking.droneId
    ) {
      onTrackingNotice({
        tone: 'info',
        title: 'Drone selection changed',
        detail: `Tracking continues for ${tracking.droneId}. Stop tracking before switching active route.`,
      })
    }
  }, [onTrackingNotice, selectedTrackingDroneId, tracking.droneId, tracking.status])

  return (
    <div className="drone-map relative h-full min-h-[420px] overflow-hidden bg-slate-100 lg:min-h-0">
      <div ref={containerRef} className="absolute inset-0" aria-label="Drone map" />
      {mapStatus !== 'ready' ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-white/30 backdrop-blur-[1px]">
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-sm text-slate-800 shadow-xl">
            {mapStatus === 'loading' ? (
              <Loader2 className="size-4 animate-spin text-sky-600" aria-hidden="true" />
            ) : (
              <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />
            )}
            <span>{mapStatus === 'loading' ? 'Loading Vietnam map...' : 'Unable to load map'}</span>
          </div>
        </div>
      ) : null}
      <div ref={searchPanelRef} className="absolute left-4 right-4 top-4 z-20 mx-auto max-w-xl sm:left-20 sm:right-auto sm:w-[28rem]">
        <div className="rounded-2xl border border-slate-200 bg-white/96 p-2 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2">
            <Search className="ml-2 size-4 shrink-0 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
                setSearchError(null)
              }}
              onFocus={() => {
                if (searchResults.length > 0 || searchError) {
                  setSearchOpen(true)
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleSearchSubmit()
                }
              }}
              placeholder="Search place or lat, lon"
              className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              aria-label="Search place or coordinates"
            />
            <button
              type="button"
              onClick={() => void handleSearchSubmit()}
              disabled={searchLoading}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-sky-300"
            >
              {searchLoading ? 'Searching...' : 'Go'}
            </button>
          </div>
          {searchOpen && (searchResults.length > 0 || searchError) ? (
            <div className="mt-2 border-t border-slate-200 pt-2">
              {searchError ? (
                <div className="px-2 py-2 text-sm text-rose-700">{searchError}</div>
              ) : null}
              {searchResults.length > 0 ? (
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => handleSelectSearchResult(result)}
                      className="block w-full rounded-xl px-3 py-2 text-left transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <div className="line-clamp-2 text-sm font-medium text-slate-900">
                        {result.label}
                      </div>
                      <div className="mt-1 font-mono text-xs text-slate-500">
                        {result.lat.toFixed(6)}, {result.lon.toFixed(6)}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="absolute left-4 top-24 z-20 inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-900 shadow-lg backdrop-blur transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-900 focus:outline-none focus:ring-2 focus:ring-sky-500 sm:left-auto sm:right-4 sm:top-4"
        onClick={handleFocusVietnam}
      >
        <Navigation className="size-3.5" aria-hidden="true" />
        Reset view
      </button>
      <div className="absolute bottom-4 left-4 z-20">
        {isDrawingZone ? (
          <div className="flex flex-col gap-2 rounded-lg border border-rose-200 bg-white/95 p-2 text-xs font-semibold text-slate-800 shadow-lg backdrop-blur">
            <span className="px-1 text-rose-700">
              Click the map to add points · {zonePoints.length} placed
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1.5 text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={finishDrawingZone}
                disabled={isSavingZone || zonePoints.length < 3}
              >
                {isSavingZone ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
                Finish
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                onClick={cancelDrawingZone}
                disabled={isSavingZone}
              >
                <X className="size-3.5" aria-hidden="true" />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-800 shadow-lg backdrop-blur transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
            onClick={startDrawingZone}
          >
            <Ban className="size-3.5" aria-hidden="true" />
            Draw No-Fly Zone
          </button>
        )}
      </div>
      {overlayZoom >= PUBLISHED_OVERLAY_FLOOR_PANEL_MIN_ZOOM && nearestOverlayProjects.length > 0 ? (
        <div className="absolute left-4 top-16 z-20 w-72 rounded-lg border border-slate-200 bg-white/95 p-2 text-xs text-slate-700 shadow-lg backdrop-blur">
          <div className="mb-2 font-semibold text-slate-900">Saved maps nearby</div>
          <div className="max-h-36 space-y-1 overflow-y-auto border-b border-slate-200 pb-2">
            {nearestOverlayProjects.map((project) => {
              const active = project.id === selectedOverlayProjectId
              return (
                <button
                  key={project.id}
                  type="button"
                  className={`w-full rounded border px-2 py-1 text-left ${
                    active
                      ? 'border-sky-300 bg-sky-50 text-sky-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                  onClick={() => {
                    setSelectedOverlayProjectId(project.id)
                    setSelectedOverlayFloorId(project.floors[0]?.id ?? null)
                  }}
                >
                  {project.name}
                </button>
              )
            })}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            {selectedOverlayProject ? selectedOverlayProject.name : 'Select a map'}
          </div>
          {selectedOverlayProject ? (
            <button
              type="button"
              className="mt-1 w-full rounded border border-rose-300 bg-rose-50 px-2 py-1 text-left text-[11px] text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              onClick={handleDeleteOverlayProject}
              disabled={isDeletingOverlayProject}
            >
              {isDeletingOverlayProject ? 'Deleting...' : 'Delete map'}
            </button>
          ) : null}
          <div className="mt-1 max-h-44 space-y-1 overflow-y-auto">
            {selectedOverlayProject && overlayFloors.length > 0 ? (
              overlayFloors.map((floor) => (
                <button
                  key={floor.id}
                  type="button"
                  className={`w-full rounded border px-2 py-1 text-left ${
                    selectedOverlayFloorId === floor.id
                      ? 'border-sky-300 bg-sky-50 text-sky-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                  onClick={() => setSelectedOverlayFloorId(floor.id)}
                >
                  {floor.label}
                </button>
              ))
            ) : (
              <div className="rounded border border-slate-200 px-2 py-1 text-slate-500">No floor selected</div>
            )}
          </div>
        </div>
      ) : null}
      {selectedTarget && tracking.status !== 'tracking' && !hideTargetPopover ? (
        <TargetCommandPopover
          target={selectedTarget}
          point={targetPoint}
          connectedCount={connectedCount}
          status={commandStatus}
          onFetchLocation={onFetchLocation}
          isFetchingCandidates={isFetchingCandidates}
          isFetchingFull={isFetchingFull}
          locationFetchMessage={locationFetchMessage}
          onCancel={onCancelTarget}
          onConfirm={onConfirmTarget}
        />
      ) : null}
    </div>
  )
}
