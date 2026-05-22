import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Feature } from 'geojson'

export interface InspectorDraft {
  name: string
  tag: string
  noteText: string
}

function featureId(feature: Feature | null): string | null {
  if (!feature) return null
  const id = feature.id ?? feature.properties?.id
  return id == null ? null : String(id)
}

function featureDraft(feature: Feature): InspectorDraft {
  const props = (feature.properties ?? {}) as Record<string, unknown>
  return {
    name: String(props.name ?? ''),
    tag: String(props.tag ?? ''),
    noteText: String(props.noteText ?? ''),
  }
}

export function useInspectorFormState(selectedFeatures: Feature[]) {
  const singleSelectedFeature = useMemo(
    () => (selectedFeatures.length === 1 ? selectedFeatures[0] : null),
    [selectedFeatures],
  )
  const selectedId = featureId(singleSelectedFeature)
  const isMultiSelect = selectedFeatures.length > 1

  const lastSyncedFeatureIdRef = useRef<string | null>(null)
  const [name, setNameState] = useState('')
  const [tag, setTagState] = useState('')
  const [noteText, setNoteTextState] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!singleSelectedFeature || !selectedId) {
        lastSyncedFeatureIdRef.current = null
        setNameState('')
        setTagState('')
        setNoteTextState('')
        return
      }
      if (lastSyncedFeatureIdRef.current === selectedId) {
        return
      }
      lastSyncedFeatureIdRef.current = selectedId
      const nextDraft = featureDraft(singleSelectedFeature)
      setNameState(nextDraft.name)
      setTagState(nextDraft.tag)
      setNoteTextState(nextDraft.noteText)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [selectedId, singleSelectedFeature])

  const setName = useCallback((name: string) => {
    setNameState(name)
  }, [])

  const setTag = useCallback((tag: string) => {
    setTagState(tag)
  }, [])

  const setNoteText = useCallback((noteText: string) => {
    setNoteTextState(noteText)
  }, [])

  const setDraftValue = useCallback((next: InspectorDraft) => {
    setNameState(next.name)
    setTagState(next.tag)
    setNoteTextState(next.noteText)
  }, [])

  const draft = useMemo<InspectorDraft>(() => ({
    name,
    tag,
    noteText,
  }), [name, noteText, tag])

  return {
    draft,
    setDraft: setDraftValue,
    setName,
    setTag,
    setNoteText,
    isMultiSelect,
    hasSelection: Boolean(singleSelectedFeature),
  }
}
