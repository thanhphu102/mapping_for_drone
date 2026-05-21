import { useCallback, useState } from 'react'
import type { CommandTarget } from '../../drone/types'
import {
  createDrawingProjectFromOsm,
  fetchDrawingProjects,
  fetchOsmElementGeometry,
} from '../../spatial-editor/services/projects'
import type { EditorMode } from '../../spatial-editor/types'
import { fetchEnclosingOsmElements } from '../services/osm'
import type { OsmCandidate, OsmElementGeometryResponse } from '../types'

type LocationFetchStatus =
  | 'idle'
  | 'loading_candidates'
  | 'loading_full'
  | 'success'
  | 'error'

export type SidebarMode = 'droneControl' | 'osmEnclosing'

export interface LocationFetchState {
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

export function useOsmSelectionFlow() {
  const [locationFetch, setLocationFetch] = useState<LocationFetchState>(
    initialLocationFetchState,
  )
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('droneControl')
  const [locationSelectionMessage, setLocationSelectionMessage] =
    useState<string | null>(null)
  const [isOpeningEditor, setIsOpeningEditor] = useState(false)
  const [editorModeOverride, setEditorModeOverride] = useState<EditorMode | null>(null)
  const [confirmedLargeArea, setConfirmedLargeArea] = useState(false)

  const resetLocationPanel = useCallback(() => {
    setLocationFetch(initialLocationFetchState)
    setSidebarMode('droneControl')
    setLocationSelectionMessage(null)
  }, [])

  const resetForTargetSelection = useCallback(() => {
    resetLocationPanel()
    setEditorModeOverride(null)
    setConfirmedLargeArea(false)
  }, [resetLocationPanel])

  const handleFetchLocation = useCallback(async (selectedTarget: CommandTarget | null) => {
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
  }, [])

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
      const selectedGeometry = await fetchOsmElementGeometry(candidate.type, candidate.id)
      const nextEditorMode = selectedGeometry?.editorMode
      if (!nextEditorMode) {
        throw new Error('OSM geometry response is incomplete')
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
      setEditorModeOverride(nextEditorMode)
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
    resetLocationPanel()
    setEditorModeOverride(null)
    setConfirmedLargeArea(false)
  }, [resetLocationPanel])

  return {
    locationFetch,
    sidebarMode,
    locationSelectionMessage,
    isOpeningEditor,
    editorModeOverride,
    confirmedLargeArea,
    selectedBoundaryGeometry: locationFetch.selectedGeometry?.geometry ?? null,
    isFetchingCandidates: locationFetch.status === 'loading_candidates',
    isFetchingFull: locationFetch.status === 'loading_full',
    resetLocationPanel,
    resetForTargetSelection,
    handleFetchLocation,
    handleCandidateHover,
    handleCandidateSelect,
    handleOpenSpatialEditor,
    handleCloseOsmPanel,
    setEditorModeOverride,
  }
}
