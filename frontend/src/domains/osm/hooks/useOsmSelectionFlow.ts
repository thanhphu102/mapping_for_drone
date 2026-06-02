import { useCallback, useRef, useState } from 'react'
import type { MultiPolygon } from 'geojson'
import type { CommandTarget } from '../../drone/types'
import {
  createDrawingProjectFromOsm,
  fetchDrawingProjects,
  fetchOsmCityCalibration,
  fetchOsmElementGeometry,
  saveOsmCityCalibration,
} from '../../spatial-editor/services/projects'
import type { EditorMode } from '../../spatial-editor/types'
import { fetchEnclosingOsmElements } from '../services/osm'
import type { OsmCandidate, OsmElementGeometryResponse } from '../types'
import { openSpatialEditorRoute } from '../../../app/routes'

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

export interface CalibrationState {
  cityKey: string | null
  cityLabel: string | null
  offsetLon: number
  offsetLat: number
  rotationDeg: number
  isDirty: boolean
}

interface TargetCoordinate {
  lat: number
  lon: number
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

function deriveCityCalibrationFromCandidate(
  candidate: OsmCandidate,
): { cityKey: string | null; cityLabel: string | null } {
  const tags = candidate.tags ?? {}
  const adminLevel = tags.admin_level
  const boundary = tags.boundary
  const name = tags.name
  if (boundary === 'administrative' && ['6', '7', '8'].includes(adminLevel ?? '') && name) {
    return {
      cityKey: `admin:${adminLevel}:${name.trim().toLowerCase()}`,
      cityLabel: name,
    }
  }
  for (const key of ['addr:city', 'is_in:city', 'addr:state', 'is_in:state'] as const) {
    const value = tags[key]
    if (value) {
      return {
        cityKey: `${key}:${value.trim().toLowerCase()}`,
        cityLabel: value,
      }
    }
  }
  return { cityKey: null, cityLabel: null }
}

function deriveCityCalibrationFromCandidates(
  candidates: OsmCandidate[],
): { cityKey: string | null; cityLabel: string | null } {
  const adminCandidates = candidates
    .map((candidate) => ({ candidate, derived: deriveCityCalibrationFromCandidate(candidate) }))
    .filter(({ derived }) => derived.cityKey?.startsWith('admin:'))
    .sort((left, right) => {
      const leftLevel = Number(left.candidate.tags.admin_level ?? 99)
      const rightLevel = Number(right.candidate.tags.admin_level ?? 99)
      return leftLevel - rightLevel
    })
  for (const item of adminCandidates) {
    if (item.derived.cityKey) return item.derived
  }
  for (const candidate of candidates) {
    const derived = deriveCityCalibrationFromCandidate(candidate)
    if (derived.cityKey) {
      return derived
    }
  }
  return { cityKey: null, cityLabel: null }
}

function deriveCityCalibrationFromCoordinate(
  target: TargetCoordinate | null,
): { cityKey: string | null; cityLabel: string | null } {
  if (!target) return { cityKey: null, cityLabel: null }
  const latBucket = target.lat.toFixed(2)
  const lonBucket = target.lon.toFixed(2)
  return {
    cityKey: `coord:${latBucket}:${lonBucket}`,
    cityLabel: `Area ${latBucket}, ${lonBucket}`,
  }
}

function translateGeometry(
  geometry: MultiPolygon,
  offsetLon: number,
  offsetLat: number,
): MultiPolygon {
  if (offsetLon === 0 && offsetLat === 0) return geometry
  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) =>
        ring.map(([lon, lat]) => [lon + offsetLon, lat + offsetLat]),
      ),
    ),
  }
}

function geometryCentroid(geometry: MultiPolygon): [number, number] {
  let lonSum = 0
  let latSum = 0
  let count = 0
  geometry.coordinates.forEach((polygon) => {
    polygon.forEach((ring) => {
      ring.forEach(([lon, lat]) => {
        lonSum += lon
        latSum += lat
        count += 1
      })
    })
  })
  if (count === 0) return [0, 0]
  return [lonSum / count, latSum / count]
}

function rotateGeometry(geometry: MultiPolygon, rotationDeg: number): MultiPolygon {
  if (rotationDeg === 0) return geometry
  const [centerLon, centerLat] = geometryCentroid(geometry)
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) =>
        ring.map(([lon, lat]) => {
          const dx = lon - centerLon
          const dy = lat - centerLat
          return [
            (dx * cos) - (dy * sin) + centerLon,
            (dx * sin) + (dy * cos) + centerLat,
          ]
        }),
      ),
    ),
  }
}

export function useOsmSelectionFlow() {
  const [locationFetch, setLocationFetch] = useState<LocationFetchState>(
    initialLocationFetchState,
  )
  const [rawSelectedGeometry, setRawSelectedGeometry] =
    useState<OsmElementGeometryResponse | null>(null)
  const [calibration, setCalibration] = useState<CalibrationState>({
    cityKey: null,
    cityLabel: null,
    offsetLon: 0,
    offsetLat: 0,
    rotationDeg: 0,
    isDirty: false,
  })
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('droneControl')
  const [calibrationDragEnabled, setCalibrationDragEnabled] = useState(false)
  const [locationSelectionMessage, setLocationSelectionMessage] =
    useState<string | null>(null)
  const [fetchedTargetCoordinate, setFetchedTargetCoordinate] = useState<TargetCoordinate | null>(null)
  const [lastFetchedCoordinate, setLastFetchedCoordinate] = useState<TargetCoordinate | null>(null)
  const [isOpeningEditor, setIsOpeningEditor] = useState(false)
  const [editorModeOverride, setEditorModeOverride] = useState<EditorMode | null>(null)
  const [confirmedLargeArea, setConfirmedLargeArea] = useState(false)
  const [isSavingCalibration, setIsSavingCalibration] = useState(false)
  const fetchCandidatesAbortRef = useRef<AbortController | null>(null)
  const fetchCandidatesRequestIdRef = useRef(0)

  const resetCalibration = useCallback(() => {
    setRawSelectedGeometry(null)
    setCalibration({
      cityKey: null,
      cityLabel: null,
      offsetLon: 0,
      offsetLat: 0,
      rotationDeg: 0,
      isDirty: false,
    })
    setCalibrationDragEnabled(false)
  }, [])

  const resetLocationPanel = useCallback(() => {
    fetchCandidatesAbortRef.current?.abort()
    setLocationFetch(initialLocationFetchState)
    setSidebarMode('droneControl')
    setLocationSelectionMessage(null)
    setFetchedTargetCoordinate(null)
    resetCalibration()
  }, [resetCalibration])

  const resetForTargetSelection = useCallback(() => {
    resetLocationPanel()
    setEditorModeOverride(null)
    setConfirmedLargeArea(false)
  }, [resetLocationPanel])

  const handleFetchLocation = useCallback(async (selectedTarget: CommandTarget | null) => {
    if (!selectedTarget) {
      return
    }

    const nextTargetCoordinate = {
      lat: selectedTarget.lat,
      lon: selectedTarget.lon,
    }
    setSidebarMode('osmEnclosing')
    setFetchedTargetCoordinate(nextTargetCoordinate)
    setLocationSelectionMessage(null)
    setEditorModeOverride(null)
    setConfirmedLargeArea(false)
    resetCalibration()

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
    fetchCandidatesRequestIdRef.current += 1
    const requestId = fetchCandidatesRequestIdRef.current
    fetchCandidatesAbortRef.current?.abort()
    const controller = new AbortController()
    fetchCandidatesAbortRef.current = controller

    try {
      const candidates = await fetchEnclosingOsmElements(
        selectedTarget.lat,
        selectedTarget.lon,
        { signal: controller.signal },
      )
      if (requestId !== fetchCandidatesRequestIdRef.current) {
        return
      }

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
      setLastFetchedCoordinate(nextTargetCoordinate)
      const derivedFromCandidates = deriveCityCalibrationFromCandidates(candidates)
      const derivedFromCoordinate = deriveCityCalibrationFromCoordinate({
        lat: selectedTarget.lat,
        lon: selectedTarget.lon,
      })
      const previewCityKey = derivedFromCandidates.cityKey ?? derivedFromCoordinate.cityKey
      const previewCityLabel = derivedFromCandidates.cityLabel ?? derivedFromCoordinate.cityLabel
      if (previewCityKey) {
        try {
          const existingCalibration = await fetchOsmCityCalibration(previewCityKey)
          setCalibration((current) => ({
            ...current,
            cityKey: previewCityKey,
            cityLabel: previewCityLabel,
            offsetLon: existingCalibration?.offsetLon ?? 0,
            offsetLat: existingCalibration?.offsetLat ?? 0,
            rotationDeg: existingCalibration?.rotationDeg ?? 0,
            isDirty: false,
          }))
        } catch {
          setCalibration((current) => ({
            ...current,
            cityKey: previewCityKey,
            cityLabel: previewCityLabel,
          }))
        }
      }
    } catch (error) {
      if (
        error instanceof Error
        && (error.name === 'AbortError' || requestId !== fetchCandidatesRequestIdRef.current)
      ) {
        return
      }
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
    } finally {
      if (requestId === fetchCandidatesRequestIdRef.current) {
        fetchCandidatesAbortRef.current = null
      }
    }
  }, [lastFetchedCoordinate, resetCalibration])

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
      const fromCandidates = deriveCityCalibrationFromCandidates(locationFetch.candidates)
      const fromCoordinate = deriveCityCalibrationFromCoordinate(fetchedTargetCoordinate)
      const requestCityKey = calibration.cityKey ?? fromCandidates.cityKey ?? fromCoordinate.cityKey ?? undefined
      const selectedGeometry = await fetchOsmElementGeometry(candidate.type, candidate.id, {
        calibrationCityKey: requestCityKey,
      })
      const nextEditorMode = selectedGeometry?.editorMode
      if (!nextEditorMode) {
        throw new Error('OSM geometry response is incomplete')
      }

      setRawSelectedGeometry({
        ...selectedGeometry,
        geometry: selectedGeometry.rawGeometry ?? selectedGeometry.geometry,
      })
      const derived = deriveCityCalibrationFromCandidate(candidate)
      setCalibration({
        cityKey: selectedGeometry.cityCalibrationKey ?? derived.cityKey ?? fromCandidates.cityKey ?? fromCoordinate.cityKey,
        cityLabel: selectedGeometry.cityLabel ?? derived.cityLabel ?? fromCandidates.cityLabel ?? fromCoordinate.cityLabel,
        offsetLon: selectedGeometry.appliedCalibration?.offsetLon ?? 0,
        offsetLat: selectedGeometry.appliedCalibration?.offsetLat ?? 0,
        rotationDeg: selectedGeometry.appliedCalibration?.rotationDeg ?? 0,
        isDirty: false,
      })
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
  }, [fetchedTargetCoordinate, locationFetch.candidates])

  const setCalibrationOffset = useCallback((field: 'offsetLon' | 'offsetLat' | 'rotationDeg', value: number) => {
    setCalibration((current) => ({
      ...current,
      [field]: Number.isFinite(value) ? value : 0,
      isDirty: true,
    }))
  }, [])

  const resetCalibrationOffset = useCallback(() => {
    setCalibration((current) => ({
      ...current,
      offsetLon: rawSelectedGeometry?.appliedCalibration?.offsetLon ?? 0,
      offsetLat: rawSelectedGeometry?.appliedCalibration?.offsetLat ?? 0,
      rotationDeg: rawSelectedGeometry?.appliedCalibration?.rotationDeg ?? 0,
      isDirty: false,
    }))
  }, [rawSelectedGeometry])

  const saveCalibrationForCity = useCallback(async () => {
    const candidate = locationFetch.selectedCandidate
    if (!candidate) {
      setLocationFetch((current) => ({
        ...current,
        message: {
          tone: 'error',
          text: 'Select a boundary first.',
        },
      }))
      return
    }
    const derived = deriveCityCalibrationFromCandidate(candidate)
    const fromCandidates = deriveCityCalibrationFromCandidates(locationFetch.candidates)
    const fromCoordinate = deriveCityCalibrationFromCoordinate(fetchedTargetCoordinate)
    const cityKey = calibration.cityKey ?? derived.cityKey ?? fromCandidates.cityKey ?? fromCoordinate.cityKey
    const cityLabel = calibration.cityLabel ?? derived.cityLabel ?? fromCandidates.cityLabel ?? fromCoordinate.cityLabel
    if (!cityKey) {
      setLocationFetch((current) => ({
        ...current,
        message: {
          tone: 'error',
          text: 'Cannot determine city key from this boundary. Please choose an administrative/city boundary.',
        },
      }))
      return
    }
    setIsSavingCalibration(true)
    try {
      await saveOsmCityCalibration({
        cityKey,
        cityLabel,
        offsetLon: calibration.offsetLon,
        offsetLat: calibration.offsetLat,
        rotationDeg: calibration.rotationDeg,
        sourceOsmType: candidate.type,
        sourceOsmId: candidate.id,
      })
      setCalibration((current) => ({
        ...current,
        cityKey,
        cityLabel,
        isDirty: false,
      }))
      setLocationFetch((current) => ({
        ...current,
        message: {
          tone: 'success',
          text: 'Calibration saved for this city.',
        },
      }))
    } catch (error) {
      setLocationFetch((current) => ({
        ...current,
        message: {
          tone: 'error',
          text: error instanceof Error ? error.message : 'Failed to save calibration.',
        },
      }))
    } finally {
      setIsSavingCalibration(false)
    }
  }, [calibration.cityKey, calibration.cityLabel, calibration.offsetLat, calibration.offsetLon, calibration.rotationDeg, fetchedTargetCoordinate, locationFetch.candidates, locationFetch.selectedCandidate])

  const nudgeCalibrationByDelta = useCallback((deltaLon: number, deltaLat: number) => {
    setCalibration((current) => ({
      ...current,
      offsetLon: current.offsetLon + deltaLon,
      offsetLat: current.offsetLat + deltaLat,
      isDirty: true,
    }))
  }, [])

  const nudgeCalibrationRotation = useCallback((deltaDeg: number) => {
    setCalibration((current) => ({
      ...current,
      rotationDeg: current.rotationDeg + deltaDeg,
      isDirty: true,
    }))
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
        openSpatialEditorRoute(existing.id)
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
          calibrationCityKey: calibration.cityKey ?? undefined,
          editorModeOverride: editorModeOverride ?? undefined,
          confirmedLargeArea,
          calibrationOffsetLon: calibration.offsetLon,
          calibrationOffsetLat: calibration.offsetLat,
          calibrationRotationDeg: calibration.rotationDeg,
        },
      )
      openSpatialEditorRoute(response.projectId)
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
  }, [calibration.offsetLat, calibration.offsetLon, calibration.rotationDeg, confirmedLargeArea, editorModeOverride, locationFetch.selectedCandidate])

  const handleCloseOsmPanel = useCallback(() => {
    resetLocationPanel()
    setEditorModeOverride(null)
    setConfirmedLargeArea(false)
  }, [resetLocationPanel])

  const selectedBoundaryGeometry =
    rawSelectedGeometry
      ? rotateGeometry(
        translateGeometry(rawSelectedGeometry.geometry, calibration.offsetLon, calibration.offsetLat),
        calibration.rotationDeg,
      )
      : locationFetch.selectedGeometry?.geometry ?? null

  return {
    locationFetch,
    sidebarMode,
    locationSelectionMessage,
    isOpeningEditor,
    editorModeOverride,
    confirmedLargeArea,
    calibration,
    calibrationDragEnabled,
    isSavingCalibration,
    selectedBoundaryGeometry,
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
    setCalibrationOffset,
    resetCalibrationOffset,
    saveCalibrationForCity,
    nudgeCalibrationByDelta,
    nudgeCalibrationRotation,
    toggleCalibrationDrag: () => setCalibrationDragEnabled((current) => !current),
  }
}
