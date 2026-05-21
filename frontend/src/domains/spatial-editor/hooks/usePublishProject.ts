import { useCallback, useState } from 'react'
import type { Feature } from 'geojson'
import type { DrawingProject } from '../types'
import { publishDrawingProject } from '../services/projects'

interface UsePublishProjectOptions {
  project: DrawingProject | null
  hasPendingChanges: boolean
  persistDraftChanges: (message?: string) => Promise<boolean | undefined>
  isMounted: () => boolean
  onMessage: (message: string) => void
  onPublished: (project: DrawingProject, features: Feature[]) => void
}

export function usePublishProject({
  project,
  hasPendingChanges,
  persistDraftChanges,
  isMounted,
  onMessage,
  onPublished,
}: UsePublishProjectOptions) {
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const publishProject = useCallback(async () => {
    if (!project) {
      return
    }
    setSuccess(false)
    setError(null)
    if (hasPendingChanges) {
      const didPersist = await persistDraftChanges('Saving draft before publish...')
      if (!didPersist) {
        return
      }
    }
    setPublishing(true)
    onMessage('Publishing project...')
    try {
      const response = await publishDrawingProject(project.id)
      if (!isMounted()) {
        return
      }
      onPublished(response.project, response.project.features)
      setSuccess(true)
      onMessage('Project published')
    } catch (publishError) {
      if (isMounted()) {
        const message = publishError instanceof Error ? publishError.message : 'Publish failed'
        setError(message)
        onMessage(message)
      }
    } finally {
      if (isMounted()) {
        setPublishing(false)
      }
    }
  }, [hasPendingChanges, isMounted, onMessage, onPublished, persistDraftChanges, project])

  return {
    publishing,
    publishProject,
    error,
    success,
  }
}
