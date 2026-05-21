import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawingProject } from '../../spatial-editor/types'
import {
  PUBLISHED_OVERLAY_FLOOR_PANEL_MIN_ZOOM,
  PUBLISHED_OVERLAY_MAX_NEARBY_BUILDINGS,
} from '../layers/overlayLayers'

function bboxCenter(bbox: [number, number, number, number]): [number, number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
}

function approxDistanceSq(a: [number, number], b: [number, number]) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

export function useOverlaySelection() {
  const [overlayProjects, setOverlayProjects] = useState<DrawingProject[]>([])
  const [selectedOverlayProjectId, setSelectedOverlayProjectId] = useState<string | null>(null)
  const [selectedOverlayFloorId, setSelectedOverlayFloorId] = useState<string | null>(null)
  const [overlayZoom, setOverlayZoom] = useState(2)
  const [overlayCenter, setOverlayCenter] = useState<[number, number]>([0, 0])
  const [isDeletingOverlayProject, setIsDeletingOverlayProject] = useState(false)
  const overlayProjectsRef = useRef<DrawingProject[]>([])
  const selectedOverlayProjectIdRef = useRef<string | null>(null)
  const selectedOverlayFloorIdRef = useRef<string | null>(null)
  const scheduleOverlayRefreshRef = useRef<(() => void) | null>(null)

  const selectedOverlayProject = useMemo(
    () => overlayProjects.find((project) => project.id === selectedOverlayProjectId) ?? null,
    [overlayProjects, selectedOverlayProjectId],
  )
  const overlayFloors = useMemo(
    () => [...(selectedOverlayProject?.floors ?? [])].sort((a, b) => b.level - a.level),
    [selectedOverlayProject],
  )
  const nearestOverlayProjects = useMemo(() => {
    return overlayProjects
      .slice()
      .sort((left, right) => {
        const leftDistance = approxDistanceSq(bboxCenter(left.bbox), overlayCenter)
        const rightDistance = approxDistanceSq(bboxCenter(right.bbox), overlayCenter)
        return leftDistance - rightDistance
      })
      .slice(0, PUBLISHED_OVERLAY_MAX_NEARBY_BUILDINGS)
  }, [overlayCenter, overlayProjects])

  useEffect(() => {
    overlayProjectsRef.current = overlayProjects
  }, [overlayProjects])
  useEffect(() => {
    selectedOverlayProjectIdRef.current = selectedOverlayProjectId
  }, [selectedOverlayProjectId])
  useEffect(() => {
    selectedOverlayFloorIdRef.current = selectedOverlayFloorId
  }, [selectedOverlayFloorId])

  useEffect(() => {
    if (overlayZoom < PUBLISHED_OVERLAY_FLOOR_PANEL_MIN_ZOOM) return
    if (selectedOverlayProjectId) return
    if (nearestOverlayProjects.length === 0) return
    const first = nearestOverlayProjects[0]
    const timer = window.setTimeout(() => {
      setSelectedOverlayProjectId(first.id)
      setSelectedOverlayFloorId(first.floors[0]?.id ?? null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [nearestOverlayProjects, overlayZoom, selectedOverlayProjectId])

  return {
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
  }
}
