import { useCallback, useEffect, useState } from 'react'
import type { DrawingProject } from '../types'
import { fetchDrawingProject } from '../services/projects'

interface UseSpatialProjectDataOptions {
  projectId: string
  onBeforeLoad?: () => void
  onLoaded?: (
    project: DrawingProject,
    signal: AbortSignal,
  ) => DrawingProject | Promise<DrawingProject | void> | void
  onError?: (error: unknown) => void
}

export function useSpatialProjectData({
  projectId,
  onBeforeLoad,
  onLoaded,
  onError,
}: UseSpatialProjectDataOptions) {
  const [project, setProject] = useState<DrawingProject | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const reloadProject = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      onBeforeLoad?.()
      try {
        const nextProject = await fetchDrawingProject(projectId, signal)
        const loadedProject = (await onLoaded?.(nextProject, signal ?? new AbortController().signal)) ?? nextProject
        if (!signal?.aborted) {
          setProject(loadedProject)
        }
        return loadedProject
      } catch (loadError) {
        if (!signal?.aborted) {
          const nextError = loadError instanceof Error ? loadError : new Error('Project failed to load')
          setError(nextError)
          onError?.(loadError)
        }
        return null
      } finally {
        if (!signal?.aborted) {
          setLoading(false)
        }
      }
    },
    [onBeforeLoad, onError, onLoaded, projectId],
  )

  useEffect(() => {
    const abortController = new AbortController()
    const timer = window.setTimeout(() => {
      void reloadProject(abortController.signal)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      abortController.abort()
    }
  }, [reloadProject])

  return {
    projectId,
    project,
    setProject,
    loading,
    error,
    reloadProject,
  }
}
