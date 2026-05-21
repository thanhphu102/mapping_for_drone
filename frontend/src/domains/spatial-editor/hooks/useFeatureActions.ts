import { useCallback, useRef, useState } from 'react'
import type { SpatialFeature } from '../types'
import {
  saveDrawingFeature,
  deleteDrawingFeature,
} from '../services/features'

interface FeatureActionsState {
  saving: boolean
  deleting: boolean
  message: string | null
}

export function useFeatureActions(projectId: string | null) {
  const [state, setState] = useState<FeatureActionsState>({
    saving: false,
    deleting: false,
    message: null,
  })
  const isMountedRef = useRef(true)

  const saveFeature = useCallback(
    async (feature: SpatialFeature): Promise<SpatialFeature | null> => {
      if (!projectId) return null
      setState((s) => ({ ...s, saving: true, message: 'Saving feature...' }))
      try {
        const response = await saveDrawingFeature(projectId, feature)
        if (isMountedRef.current) {
          setState((s) => ({ ...s, saving: false, message: 'Feature saved' }))
        }
        return response.feature
      } catch (error) {
        if (isMountedRef.current) {
          setState((s) => ({
            ...s,
            saving: false,
            message: error instanceof Error ? error.message : 'Save failed',
          }))
        }
        return null
      }
    },
    [projectId],
  )

  const deleteFeature = useCallback(
    async (featureId: string): Promise<boolean> => {
      if (!projectId) return false
      setState((s) => ({ ...s, deleting: true, message: 'Deleting feature...' }))
      try {
        await deleteDrawingFeature(projectId, featureId)
        if (isMountedRef.current) {
          setState((s) => ({ ...s, deleting: false, message: 'Feature deleted' }))
        }
        return true
      } catch (error) {
        if (isMountedRef.current) {
          setState((s) => ({
            ...s,
            deleting: false,
            message: error instanceof Error ? error.message : 'Delete failed',
          }))
        }
        return false
      }
    },
    [projectId],
  )

  return {
    ...state,
    saveFeature,
    deleteFeature,
  }
}
