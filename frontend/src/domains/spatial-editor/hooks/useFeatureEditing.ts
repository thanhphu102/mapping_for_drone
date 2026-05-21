import { useCallback, useMemo, useState } from 'react'
import type { Feature } from 'geojson'

function featureId(feature: Feature) {
  return String(feature.id ?? '')
}

export function useFeatureEditing(initialFeatures: Feature[] = []) {
  const [draftFeatures, setDraftFeatures] = useState<Feature[]>(initialFeatures)
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([])

  const selectedFeatures = useMemo(
    () => draftFeatures.filter((feature) => selectedFeatureIds.includes(featureId(feature))),
    [draftFeatures, selectedFeatureIds],
  )

  const replaceFeatures = useCallback((features: Feature[]) => {
    setDraftFeatures(features)
    setSelectedFeatureIds((current) => {
      const ids = new Set(features.map(featureId))
      return current.filter((id) => ids.has(id))
    })
  }, [])

  const addFeature = useCallback((feature: Feature) => {
    setDraftFeatures((current) => [...current, feature])
    const id = featureId(feature)
    if (id) {
      setSelectedFeatureIds([id])
    }
  }, [])

  const updateFeature = useCallback((feature: Feature) => {
    const id = featureId(feature)
    setDraftFeatures((current) =>
      current.map((existing) => (featureId(existing) === id ? feature : existing)),
    )
  }, [])

  const deleteFeature = useCallback((featureIdToDelete: string) => {
    setDraftFeatures((current) =>
      current.filter((feature) => featureId(feature) !== featureIdToDelete),
    )
    setSelectedFeatureIds((current) => current.filter((id) => id !== featureIdToDelete))
  }, [])

  return {
    draftFeatures,
    selectedFeatureIds,
    selectedFeatures,
    setSelectedFeatureIds,
    replaceFeatures,
    addFeature,
    updateFeature,
    deleteFeature,
  }
}
