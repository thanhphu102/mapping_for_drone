import { useCallback, useMemo, useState } from 'react'
import type { DrawingProject, SpatialFloor } from '../types'
import {
  createProjectFloor,
  deleteProjectFloor,
  updateProjectFloor,
} from '../services/floors'

interface UseFloorManagementOptions {
  project: DrawingProject | null
  setProject: (updater: (project: DrawingProject | null) => DrawingProject | null) => void
  isMounted: () => boolean
  onMessage: (message: string) => void
}

export function useFloorManagement({
  project,
  setProject,
  isMounted,
  onMessage,
}: UseFloorManagementOptions) {
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null)
  const [isCreatingFloor, setIsCreatingFloor] = useState(false)
  const [isUpdatingFloor, setIsUpdatingFloor] = useState(false)

  const floors = useMemo(() => {
    if (!project) return []
    return [...project.floors].sort((a, b) => a.sortOrder - b.sortOrder)
  }, [project])

  const createFloor = useCallback(async () => {
    if (!project) return
    const nextLevel = project.floors.length > 0
      ? Math.max(...project.floors.map((floor) => floor.level)) + 1
      : 1
    const nextSort = project.floors.length > 0
      ? Math.max(...project.floors.map((floor) => floor.sortOrder)) + 1
      : 1
    onMessage('Creating floor...')
    setIsCreatingFloor(true)
    try {
      const response = await createProjectFloor(project.id, {
        label: `F${nextLevel}`,
        code: `F${nextLevel}`,
        level: nextLevel,
        sortOrder: nextSort,
      })
      if (!isMounted()) return
      setProject((current) => (current ? { ...current, floors: response.floors } : current))
      setSelectedFloorId(response.floor.id)
      onMessage('Floor created')
    } catch (error) {
      if (isMounted()) {
        onMessage(error instanceof Error ? error.message : 'Create floor failed')
      }
    } finally {
      if (isMounted()) {
        setIsCreatingFloor(false)
      }
    }
  }, [isMounted, onMessage, project, setProject])

  const updateFloor = useCallback(async (
    floor: SpatialFloor,
    updates: Partial<Pick<SpatialFloor, 'label' | 'code'>>,
  ) => {
    if (!project) return
    const nextLabel = (updates.label ?? floor.label).trim()
    const nextCode = (updates.code ?? floor.code).trim()
    if (!nextLabel || !nextCode) {
      onMessage('Floor label and code cannot be empty')
      return
    }
    setIsUpdatingFloor(true)
    onMessage('Updating floor...')
    try {
      const response = await updateProjectFloor(project.id, floor.id, {
        label: nextLabel,
        code: nextCode,
        level: floor.level,
        elevation: floor.elevation,
        visible: floor.visible,
        sortOrder: floor.sortOrder,
      })
      if (!isMounted()) return
      setProject((current) => (current ? { ...current, floors: response.floors } : current))
      onMessage('Floor updated')
    } catch (error) {
      if (isMounted()) {
        onMessage(error instanceof Error ? error.message : 'Update floor failed')
      }
    } finally {
      if (isMounted()) setIsUpdatingFloor(false)
    }
  }, [isMounted, onMessage, project, setProject])

  const deleteFloor = useCallback(async (floor: SpatialFloor) => {
    if (!project) return
    setIsUpdatingFloor(true)
    onMessage('Deleting floor...')
    try {
      const response = await deleteProjectFloor(project.id, floor.id)
      if (!isMounted()) return
      setProject((current) => (current ? { ...current, floors: response.floors } : current))
      if (selectedFloorId === floor.id) {
        const next = [...response.floors].sort((a, b) => a.sortOrder - b.sortOrder)[0]
        setSelectedFloorId(next?.id ?? null)
      }
      onMessage('Floor deleted')
    } catch (error) {
      if (isMounted()) {
        onMessage(error instanceof Error ? error.message : 'Delete floor failed')
      }
    } finally {
      if (isMounted()) setIsUpdatingFloor(false)
    }
  }, [isMounted, onMessage, project, selectedFloorId, setProject])

  return {
    floors,
    selectedFloorId,
    setSelectedFloorId,
    createFloor,
    updateFloor,
    deleteFloor,
    isCreatingFloor,
    isUpdatingFloor,
  }
}

