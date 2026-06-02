export interface LocationSearchResult {
  id: string
  label: string
  lat: number
  lon: number
}

interface NominatimSearchItem {
  place_id: number
  display_name: string
  lat: string
  lon: string
}

export function parseCoordinateQuery(query: string): { lat: number; lon: number } | null {
  const normalized = query
    .trim()
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')

  if (!normalized) {
    return null
  }

  const parts = normalized
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length !== 2) {
    return null
  }

  const first = Number(parts[0])
  const second = Number(parts[1])
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return null
  }

  const firstLooksLikeLon = Math.abs(first) > 90 && Math.abs(first) <= 180
  const secondLooksLikeLat = Math.abs(second) <= 90
  const lat = firstLooksLikeLon && secondLooksLikeLat ? second : first
  const lon = firstLooksLikeLon && secondLooksLikeLat ? first : second

  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null
  }

  return {
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
  }
}

export async function searchLocations(
  query: string,
  signal?: AbortSignal,
): Promise<LocationSearchResult[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return []
  }

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=en&q=${encodeURIComponent(trimmedQuery)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal,
    },
  )

  if (!response.ok) {
    throw new Error(`Search failed (${response.status})`)
  }

  const payload = (await response.json()) as NominatimSearchItem[]
  return payload
    .map((item) => {
      const lat = Number(item.lat)
      const lon = Number(item.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null
      }
      return {
        id: String(item.place_id),
        label: item.display_name,
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6)),
      }
    })
    .filter((item): item is LocationSearchResult => item !== null)
}
