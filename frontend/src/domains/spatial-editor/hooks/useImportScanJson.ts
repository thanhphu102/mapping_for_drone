import { useCallback, useState } from 'react'
import {
  previewScanJsonImport,
  type ImportScanPreviewResponse,
} from '../services/imports'

export function useImportScanJson() {
  const [preview, setPreview] = useState<ImportScanPreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const previewImport = useCallback(async () => {
    setError(null)
    try {
      const response = await previewScanJsonImport()
      setPreview(response)
      return response
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : 'Import preview failed'
      setError(message)
      throw previewError
    }
  }, [])

  return {
    preview,
    error,
    previewImport,
  }
}
