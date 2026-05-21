import { useMemo, useState, type ChangeEvent } from 'react'
import type { ImportScanPreviewResponse } from '../services/imports'

type ParsedPolygon = {
  name?: string
  externalId?: string
  tag?: string
  note?: string
  coordinates: [number, number][]
}

interface ImportScanJsonPanelProps {
  disabled?: boolean
  preview: ImportScanPreviewResponse | null
  error: string | null
  loading: boolean
  onPreview: (polygons: ParsedPolygon[]) => Promise<void>
  onCommit: (polygons: ParsedPolygon[]) => Promise<void>
  onUnpreview: () => void
}

function parseImportText(raw: string): ParsedPolygon[] {
  const payload = JSON.parse(raw) as { polygons?: unknown }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.polygons)) {
    throw new Error('Import JSON must contain payload.polygons array')
  }
  const parsed: ParsedPolygon[] = []
  payload.polygons.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Polygon at index ${index} must be an object`)
    }
    const row = item as Record<string, unknown>
    if (!Array.isArray(row.coordinates)) {
      throw new Error(`Polygon at index ${index} is missing coordinates array`)
    }
    const coordinates: [number, number][] = row.coordinates.map((point, pointIndex) => {
      if (
        !Array.isArray(point)
        || point.length !== 2
        || typeof point[0] !== 'number'
        || typeof point[1] !== 'number'
      ) {
        throw new Error(`Polygon ${index} coordinate ${pointIndex} must be [lng, lat]`)
      }
      return [point[0], point[1]]
    })
    parsed.push({
      name: typeof row.name === 'string' ? row.name : undefined,
      externalId: typeof row.externalId === 'string' ? row.externalId : undefined,
      tag: typeof row.tag === 'string' ? row.tag : undefined,
      note: typeof row.note === 'string' ? row.note : undefined,
      coordinates,
    })
  })
  return parsed
}

export function ImportScanJsonPanel({
  disabled = false,
  preview,
  error,
  loading,
  onPreview,
  onCommit,
  onUnpreview,
}: ImportScanJsonPanelProps) {
  const [fileName, setFileName] = useState<string>('')
  const [parsed, setParsed] = useState<ParsedPolygon[] | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<'idle' | 'preview' | 'commit'>('idle')

  const canCommit = useMemo(
    () => Boolean(parsed && parsed.length > 0 && preview && preview.validRooms > 0),
    [parsed, preview],
  )

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    setLocalError(null)
    const file = event.target.files?.[0]
    if (!file) {
      setFileName('')
      setParsed(null)
      return
    }
    try {
      const raw = await file.text()
      const polygons = parseImportText(raw)
      setParsed(polygons)
      setFileName(file.name)
    } catch (fileError) {
      setParsed(null)
      setFileName(file.name)
      setLocalError(fileError instanceof Error ? fileError.message : 'Invalid import JSON file')
    }
  }

  const handlePreview = async () => {
    setLocalError(null)
    setLastAction('preview')
    try {
      const polygons = parsed ?? []
      if (polygons.length === 0) {
        setLocalError('Please choose a JSON file with polygons')
        return
      }
      await onPreview(polygons)
    } catch (previewError) {
      setLocalError(previewError instanceof Error ? previewError.message : 'Invalid import JSON')
    }
  }

  const handleCommit = async () => {
    if (!parsed) return
    setLocalError(null)
    setLastAction('commit')
    try {
      await onCommit(parsed)
    } catch (commitError) {
      setLocalError(commitError instanceof Error ? commitError.message : 'Import commit failed')
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Import Scan JSON</h3>
      <label className="mt-2 block">
        <input
          type="file"
          accept="application/json,.json"
          onChange={handleFileChange}
          disabled={disabled || loading}
          className="block w-full text-xs text-slate-700 file:mr-2 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 hover:file:border-slate-400 hover:file:bg-slate-100 disabled:opacity-50"
        />
      </label>
      <div className="mt-1 text-xs text-slate-500">
        {fileName ? `File: ${fileName}` : 'No file selected'}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={handlePreview}
          disabled={disabled || loading}
          className="rounded-md border border-sky-300 bg-sky-100 px-2 py-1 text-[11px] font-semibold text-sky-900 hover:border-sky-400 hover:bg-sky-200 disabled:opacity-50"
        >
          {loading ? 'Previewing...' : 'Preview'}
        </button>
        <button
          type="button"
          onClick={handleCommit}
          disabled={disabled || loading || !canCommit}
          className="rounded-md border border-emerald-300 bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-900 hover:border-emerald-400 hover:bg-emerald-200 disabled:opacity-50"
        >
          {loading ? 'Committing...' : 'Commit Import'}
        </button>
        <button
          type="button"
          onClick={onUnpreview}
          disabled={disabled || loading || !preview}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-100 disabled:opacity-50"
        >
          Unpreview
        </button>
      </div>
      {preview ? (
        <div className="mt-2 text-xs text-slate-600">
          {preview.detectedRooms} detected · {preview.validRooms} valid · {preview.invalidRooms} invalid
        </div>
      ) : null}
      {!preview && lastAction === 'preview' && !loading && !error && !localError ? (
        <div className="mt-2 text-xs text-slate-600">No preview data returned.</div>
      ) : null}
      {preview?.warnings?.length ? (
        <div className="mt-1 text-xs text-amber-700">{preview.warnings.join(' | ')}</div>
      ) : null}
      {error ? <div className="mt-1 text-xs text-rose-700">{error}</div> : null}
      {localError ? <div className="mt-1 text-xs text-rose-700">{localError}</div> : null}
    </section>
  )
}
