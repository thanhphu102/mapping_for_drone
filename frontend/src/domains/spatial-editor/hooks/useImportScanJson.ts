import { useCallback, useState } from 'react'
import {
  commitScanJsonImport,
  previewScanJsonImport,
  type ImportPolygonPayload,
  type ImportScanPreviewResponse,
} from '../services/imports'

export function useImportScanJson() {
  const [preview, setPreview] = useState<ImportScanPreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const previewImport = useCallback(async (params: {
    projectId: string
    objectId?: string
    floorId?: string | null
    floorCode?: string
    floorLabel?: string
    floorLevel?: number
    polygons: ImportPolygonPayload[]
  }) => {
    setLoading(true)
    setError(null)
    try {
      const response = await previewScanJsonImport(params)
      setPreview(response)
      return response
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : 'Import preview failed'
      setError(message)
      throw previewError
    } finally {
      setLoading(false)
    }
  }, [])

  const commitImport = useCallback(async (params: {
    projectId: string
    objectId?: string
    floorId?: string | null
    floorCode?: string
    floorLabel?: string
    floorLevel?: number
    polygons: ImportPolygonPayload[]
  }) => {
    setLoading(true)
    setError(null)
    try {
      return await commitScanJsonImport(params)
    } catch (commitError) {
      const message = commitError instanceof Error ? commitError.message : 'Import commit failed'
      setError(message)
      throw commitError
    } finally {
      setLoading(false)
    }
  }, [])

  const clearPreview = useCallback(() => {
    setPreview(null)
    setError(null)
  }, [])

  return {
    preview,
    error,
    loading,
    previewImport,
    commitImport,
    clearPreview,
  }
}
