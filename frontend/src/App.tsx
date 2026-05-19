import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, MapPinned } from 'lucide-react'
import { DroneMap } from './components/DroneMap'
import { OsmEnclosingPanel } from './components/OsmEnclosingPanel'
import { SpatialEditor } from './components/SpatialEditor'
import { DroneTable } from './components/DroneTable'
import { DroneTrackingControls } from './components/DroneTrackingControls'
import { Notice, type NoticeState } from './components/Notice'
import { StatusStrip } from './components/StatusStrip'
import { useCommandDispatch } from './hooks/useCommandDispatch'
import { useDroneTelemetry } from './hooks/useDroneTelemetry'
import {
  fetchEnclosingOsmElements,
  fetchOsmElementFull,
} from './services/osm'
import {
  createDrawingProjectFromOsm,
  fetchDrawingProjects,
  fetchOsmElementGeometry,
} from './services/spatial'
import type {
  CommandTarget,
  EditorMode,
  DroneState,
  MapTargetDraft,
  OsmCandidate,
  OsmElementGeometryResponse,
  SaveTrackedRouteResponse,
} from './types/drone'
import { formatDroneList } from './utils/format'

type LocationFetchStatus =
  | 'idle'
  | 'loading_candidates'
  | 'loading_full'
  | 'success'
  | 'error'

type SidebarMode = 'droneControl' | 'osmEnclosing'

interface LocationFetchState {
  status: LocationFetchStatus
  candidates: OsmCandidate[]
  selectedCandidate: OsmCandidate | null
  highlightedCandidate: OsmCandidate | null
  selectedGeometry: OsmElementGeometryResponse | null
  message: {
    tone: 'success' | 'error' | 'info'
    text: string
  } | null
}

const initialLocationFetchState: LocationFetchState = {
  status: 'idle',
  candidates: [],
  selectedCandidate: null,
  highlightedCandidate: null,
  selectedGeometry: null,
  message: null,
}

function canHighlightCandidate(candidate: OsmCandidate): boolean {
  const directGeometryCount = candidate.geometry.geometry?.length ?? 0
  if (candidate.type === 'way') {
    return directGeometryCount >= 2
  }

  const memberGeometryCount =
    candidate.geometry.members?.filter(
      (member) => member.type === 'way' && (member.geometry?.length ?? 0) >= 2,
    ).length ?? 0

  return memberGeometryCount > 0 || directGeometryCount >= 2
}

function App() {
  const { snapshot, connectionStatus, connectionMessage } = useDroneTelemetry()
  const commandDispatch = useCommandDispatch()
  const [selectedTarget, setSelectedTarget] = useState<CommandTarget | null>(null)
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [locationFetch, setLocationFetch] = useState<LocationFetchState>(
    initialLocationFetchState,
  )
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('droneControl')
  const [locationSelectionMessage, setLocationSelectionMessage] =
    useState<string | null>(null)
  const [isOpeningEditor, setIsOpeningEditor] = useState(false)
  const [editorModeOverride, setEditorModeOverride] = useState<EditorMode | null>(null)
  const [confirmedLargeArea, setConfirmedLargeArea] = useState(false)
  const [currentPath, setCurrentPath] = useState(window.location.pathname)
  const [selectedTrackingDroneId, setSelectedTrackingDroneId] = useState<string | null>(null)
  const [trackingState, setTrackingState] = useState<{
    status: 'idle' | 'tracking' | 'paused' | 'completed'
    pointsCount: number
    maxPoints: number
    canSave: boolean
    isSaving: boolean
    activeDroneId: string | null
  }>({
    status: 'idle',
    pointsCount: 0,
    maxPoints: 10_000,
    canSave: false,
    isSaving: false,
    activeDroneId: null,
  })
  const trackingControllerRef = useRef<{
    startTracking: (droneId: string) => void
    stopTracking: () => void
    clearTracking: () => void
    saveTrackingRoute: () => Promise<SaveTrackedRouteResponse>
  } | null>(null)
  const spatialEditorMatch = currentPath.match(/^\/spatial-editor\/([^/]+)$/)

  useEffect(() => {
    const handleRouteChange = () => {
      setCurrentPath(window.location.pathname)
    }
    window.addEventListener('popstate', handleRouteChange)
    return () => window.removeEventListener('popstate', handleRouteChange)
  }, [])

  const connectedDrones = useMemo<DroneState[]>(() => {
    return Object.values(snapshot.dronesById)
      .filter((drone) => drone.status === 'connected')
      .sort((left, right) => left.id.localeCompare(right.id))
  }, [snapshot.dronesById])

  const connectedCount = connectedDrones.length

  const averageBattery = useMemo(() => {
    const numericValues = connectedDrones
      .map((drone) => Number(drone.battery))
      .filter((value) => Number.isFinite(value))

    if (numericValues.length === 0) {
      return '-'
    }

    const total = numericValues.reduce((sum, value) => sum + value, 0)
    return `${(total / numericValues.length).toFixed(1)}%`
  }, [connectedDrones])

  const handleTargetSelect = useCallback(
    (target: MapTargetDraft) => {
      commandDispatch.reset()
      setLocationFetch(initialLocationFetchState)
      setSidebarMode('droneControl')
      setLocationSelectionMessage(null)
      setEditorModeOverride(null)
      setConfirmedLargeArea(false)
      setSelectedTarget({
        lat: Number(target.lat.toFixed(6)),
        lon: Number(target.lon.toFixed(6)),
      })
    },
    [commandDispatch],
  )

  const handleConfirmTarget = useCallback(async () => {
    if (!selectedTarget) {
      return
    }

    try {
      const response = await commandDispatch.sendTarget(selectedTarget)
      setNotice({
        tone: 'success',
        title: 'Command sent',
        detail: `Command sent to: ${formatDroneList(response.sent)}`,
      })
      setLocationFetch(initialLocationFetchState)
      setSidebarMode('droneControl')
      setLocationSelectionMessage(null)
      setSelectedTarget(null)
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Command failed',
        detail:
          error instanceof Error ? error.message : 'Unable to send command',
      })
    }
  }, [commandDispatch, selectedTarget])

  const handleCancelTarget = useCallback(() => {
    setLocationFetch(initialLocationFetchState)
    setSidebarMode('droneControl')
    setLocationSelectionMessage(null)
    setSelectedTarget(null)
  }, [])

  const handleFetchLocation = useCallback(async () => {
    if (!selectedTarget) {
      return
    }

    setSidebarMode('osmEnclosing')
    setLocationSelectionMessage(null)
    setEditorModeOverride(null)
    setConfirmedLargeArea(false)
    setLocationFetch((current) => ({
      ...current,
      status: 'loading_candidates',
      candidates: [],
      selectedCandidate: null,
      highlightedCandidate: null,
      selectedGeometry: null,
      message: {
        tone: 'info',
        text: 'Fetching enclosing OSM elements...',
      },
    }))

    try {
      const candidates = await fetchEnclosingOsmElements(
        selectedTarget.lat,
        selectedTarget.lon,
      )

      if (candidates.length === 0) {
        setLocationFetch((current) => ({
          ...current,
          status: 'error',
          message: {
            tone: 'error',
            text: 'No enclosing OSM elements found for this coordinate',
          },
        }))
        return
      }

      setLocationFetch((current) => ({
        ...current,
        status: 'idle',
        candidates,
        message: {
          tone: 'info',
          text: 'Enclosing elements loaded.',
        },
      }))
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to fetch enclosing OSM elements'

      setLocationFetch((current) => ({
        ...current,
        status: 'error',
        message: {
          tone: 'error',
          text: message,
        },
      }))
    }
  }, [selectedTarget])

  const handleTrackingStateChange = useCallback((nextState: {
    status: 'idle' | 'tracking' | 'paused' | 'completed'
    pointsCount: number
    maxPoints: number
    canSave: boolean
    isSaving: boolean
    activeDroneId: string | null
  }) => {
    setTrackingState(nextState)
  }, [])

  const handleTrackingControllerReady = useCallback((controller: {
    startTracking: (droneId: string) => void
    stopTracking: () => void
    clearTracking: () => void
    saveTrackingRoute: () => Promise<SaveTrackedRouteResponse>
  } | null) => {
    trackingControllerRef.current = controller
  }, [])

  const handleSelectDroneForTracking = useCallback((droneId: string) => {
    if (selectedTrackingDroneId === droneId) return
    if (trackingState.status === 'tracking') {
      const ok = window.confirm('Tracking is active. Stop current tracking and switch drone?')
      if (!ok) return
      trackingControllerRef.current?.stopTracking()
    }
    setSelectedTrackingDroneId(droneId)
  }, [selectedTrackingDroneId, trackingState.status])

  const handleStartTracking = useCallback(() => {
    if (!selectedTrackingDroneId) {
      setNotice({
        tone: 'info',
        title: 'Select a drone first',
        detail: 'Click a drone row in Connected Drones table before starting tracking.',
      })
      return
    }
    if (selectedTarget) {
      handleCancelTarget()
    }
    trackingControllerRef.current?.startTracking(selectedTrackingDroneId)
  }, [handleCancelTarget, selectedTarget, selectedTrackingDroneId])

  const handleStopTracking = useCallback(() => {
    trackingControllerRef.current?.stopTracking()
  }, [])

  const handleClearTracking = useCallback(() => {
    trackingControllerRef.current?.clearTracking()
  }, [])

  const handleSaveTrackingRoute = useCallback(async () => {
    const controller = trackingControllerRef.current
    if (!controller) return
    try {
      const response = await controller.saveTrackingRoute()
      setNotice({
        tone: 'success',
        title: 'Route saved',
        detail: `Saved ${response.route.pointCount.toLocaleString()} points to ${response.route.path}`,
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Save route failed',
        detail: error instanceof Error ? error.message : 'Unable to save route',
      })
    }
  }, [])

  useEffect(() => {
    if (!selectedTrackingDroneId) return
    const stillConnected = connectedDrones.some((drone) => drone.id === selectedTrackingDroneId)
    if (!stillConnected) {
      setNotice({
        tone: 'info',
        title: 'Selected drone disconnected',
        detail: `Tracking data is kept. "${selectedTrackingDroneId}" is no longer connected.`,
      })
    }
  }, [connectedDrones, selectedTrackingDroneId])

  const handleCandidateHover = useCallback((candidate: OsmCandidate | null) => {
    setLocationFetch((current) => ({
      ...current,
      highlightedCandidate:
        candidate && canHighlightCandidate(candidate) ? candidate : null,
    }))
  }, [])

  const handleCandidateSelect = useCallback(async (candidate: OsmCandidate) => {
    const canHighlight = canHighlightCandidate(candidate)

    setLocationFetch((current) => ({
      ...current,
      status: 'loading_full',
      selectedCandidate: candidate,
      highlightedCandidate: canHighlight ? candidate : null,
      selectedGeometry: null,
      message: {
        tone: 'info',
        text: `Building ${candidate.type} ${candidate.id} boundary...`,
      },
    }))

    try {
      const [fullData, selectedGeometry] = await Promise.all([
        fetchOsmElementFull(candidate.type, candidate.id),
        fetchOsmElementGeometry(candidate.type, candidate.id),
      ])
      console.log('OSM element type:', candidate.type)
      console.log('OSM element id:', candidate.id)
      console.log('OSM full JSON:', fullData)

      try {
        const debugResponse = await fetch('/debug/osm-selection', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: candidate.type,
            id: candidate.id,
            full: fullData,
          }),
        })

        if (!debugResponse.ok) {
          console.warn(
            `Debug OSM selection log failed with HTTP ${debugResponse.status}`,
          )
        }
      } catch (debugError) {
        console.warn('Debug OSM selection log failed:', debugError)
      }

      setLocationFetch((current) => ({
        ...current,
        status: 'success',
        selectedGeometry,
        highlightedCandidate: canHighlight ? candidate : null,
        message: {
          tone: 'success',
          text: `Selected ${candidate.type} ${candidate.id}. Boundary preview is ready.`,
        },
      }))
      setEditorModeOverride(selectedGeometry.editorMode)
      setConfirmedLargeArea(false)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'OSM API request failed'
      setLocationFetch((current) => ({
        ...current,
        status: 'error',
        message: {
          tone: 'error',
          text: message,
        },
      }))
    }
  }, [])

  const handleOpenSpatialEditor = useCallback(async () => {
    const candidate = locationFetch.selectedCandidate
    if (!candidate) {
      return
    }
    window.dispatchEvent(new Event('drone:flush-main-map-camera'))

    setIsOpeningEditor(true)
    setLocationFetch((current) => ({
      ...current,
      message: {
        tone: 'info',
        text: 'Checking existing drawing project...',
      },
    }))

    try {
      const existingProjects = await fetchDrawingProjects({
        osmType: candidate.type,
        osmId: candidate.id,
      })
      if (existingProjects.length > 0) {
        const existing = existingProjects[0]
        window.location.assign(`/spatial-editor/${existing.id}`)
        return
      }

      setLocationFetch((current) => ({
        ...current,
        message: {
          tone: 'info',
          text: 'Creating drawing project...',
        },
      }))
      const response = await createDrawingProjectFromOsm(
        candidate.type,
        candidate.id,
        {
          editorModeOverride: editorModeOverride ?? undefined,
          confirmedLargeArea,
        },
      )
      window.location.assign(`/spatial-editor/${response.projectId}`)
    } catch (error) {
      const requiresConfirmation =
        typeof error === 'object' &&
        error !== null &&
        'requiresConfirmation' in error &&
        Boolean((error as { requiresConfirmation?: unknown }).requiresConfirmation)
      if (requiresConfirmation) {
        setConfirmedLargeArea(true)
      }
      setLocationFetch((current) => ({
        ...current,
        message: {
          tone: requiresConfirmation ? 'info' : 'error',
          text:
            error instanceof Error
              ? error.message
              : 'Unable to create drawing project',
        },
      }))
    } finally {
      setIsOpeningEditor(false)
    }
  }, [confirmedLargeArea, editorModeOverride, locationFetch.selectedCandidate])

  const handleCloseOsmPanel = useCallback(() => {
    setLocationFetch(initialLocationFetchState)
    setSidebarMode('droneControl')
    setEditorModeOverride(null)
    setConfirmedLargeArea(false)
  }, [])

  if (spatialEditorMatch) {
    return (
      <SpatialEditor
        projectId={spatialEditorMatch[1]}
        onBack={() => {
          window.location.assign('/')
        }}
      />
    )
  }

  return (
    <div className="min-h-screen h-dvh bg-slate-100 text-slate-950">
      <div className="flex h-full flex-col lg:flex-row">
        <main className="relative min-h-0 flex-1">
          <DroneMap
            dronesById={snapshot.dronesById}
            dirtyIds={snapshot.dirtyIds}
            selectedTarget={selectedTarget}
            connectedCount={connectedCount}
            commandStatus={commandDispatch.state.status}
            highlightedCandidate={locationFetch.highlightedCandidate}
            selectedBoundaryGeometry={locationFetch.selectedGeometry?.geometry ?? null}
            isFetchingCandidates={locationFetch.status === 'loading_candidates'}
            isFetchingFull={locationFetch.status === 'loading_full'}
            locationFetchMessage={locationFetch.message}
            onTargetSelect={handleTargetSelect}
            onFetchLocation={handleFetchLocation}
            onCancelTarget={handleCancelTarget}
            onConfirmTarget={handleConfirmTarget}
            onTrackingNotice={setNotice}
            selectedTrackingDroneId={selectedTrackingDroneId}
            onTrackingStateChange={handleTrackingStateChange}
            onTrackingControllerReady={handleTrackingControllerReady}
          />
        </main>

        <aside className="flex max-h-[45dvh] w-full flex-col border-t border-slate-200 bg-slate-100 lg:h-full lg:max-h-none lg:w-[460px] lg:border-l lg:border-t-0">
          {sidebarMode === 'osmEnclosing' ? (
            <OsmEnclosingPanel
              target={selectedTarget}
              candidates={locationFetch.candidates}
              selectedCandidate={locationFetch.selectedCandidate}
              highlightedCandidate={locationFetch.highlightedCandidate}
              selectedGeometry={locationFetch.selectedGeometry}
              selectedEditorMode={editorModeOverride}
              status={locationFetch.message}
              isOpeningEditor={isOpeningEditor}
              confirmedLargeArea={confirmedLargeArea}
              onHoverCandidate={handleCandidateHover}
              onSelectCandidate={handleCandidateSelect}
              onChangeEditorMode={setEditorModeOverride}
              onOpenSpatialEditor={handleOpenSpatialEditor}
              onClose={handleCloseOsmPanel}
            />
          ) : (
            <>
              <div className="border-b border-slate-200 bg-white px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-sky-700">
                      <MapPinned className="size-4" aria-hidden="true" />
                      Swarm GSC
                    </div>
                    <h1 className="mt-1 text-xl font-semibold text-slate-950">
                      Drone Mapping Control
                    </h1>
                  </div>
                  <div className="rounded-lg bg-sky-50 p-2 text-sky-700">
                    <Activity className="size-5" aria-hidden="true" />
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                <StatusStrip
                  connectionStatus={connectionStatus}
                  connectionMessage={connectionMessage}
                  connectedCount={connectedCount}
                  averageBattery={averageBattery}
                  commandStatus={commandDispatch.state.status}
                />

                <section aria-labelledby="drone-table-heading">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2
                        id="drone-table-heading"
                        className="text-sm font-semibold text-slate-950"
                      >
                        Connected Drones
                      </h2>
                      <p className="text-sm text-slate-500">
                        Live position and battery telemetry
                      </p>
                    </div>
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700">
                      Live
                    </span>
                  </div>

                  <DroneTable
                    drones={connectedDrones}
                    isTelemetryOpen={connectionStatus === 'open'}
                    selectedTrackingDroneId={selectedTrackingDroneId}
                    onSelectTrackingDrone={handleSelectDroneForTracking}
                  />
                </section>

                <DroneTrackingControls
                  selectedDroneId={selectedTrackingDroneId}
                  status={trackingState.status}
                  pointsCount={trackingState.pointsCount}
                  maxPoints={trackingState.maxPoints}
                  canSave={trackingState.canSave}
                  isSaving={trackingState.isSaving}
                  onStart={handleStartTracking}
                  onStop={handleStopTracking}
                  onSave={handleSaveTrackingRoute}
                  onClear={handleClearTracking}
                />

                <section
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                  aria-live="polite"
                >
                  <h2 className="text-sm font-semibold text-slate-950">
                    Command Status
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    {commandDispatch.state.message}
                  </p>
                  {locationSelectionMessage ? (
                    <p className="mt-2 text-sm font-medium text-emerald-700">
                      {locationSelectionMessage}
                    </p>
                  ) : null}
                </section>
              </div>
            </>
          )}
        </aside>
      </div>

      <Notice notice={notice} onDismiss={() => setNotice(null)} />
    </div>
  )
}

export default App
