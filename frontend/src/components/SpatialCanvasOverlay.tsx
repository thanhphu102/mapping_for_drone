import { useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Position } from 'geojson'
import type { Map } from 'maplibre-gl'
import type { SnapPreview } from '../hooks/useSnapEngine'

interface SpatialCanvasOverlayProps {
  map: Map | null
  draftMode?: string | null
  visibleFeatures: Feature[]
  publishedFeatures?: Feature[]
  localDraftFeatureIds?: string[]
  selectedFeatureIds: string[]
  draftCollection: FeatureCollection | null
  snapPreview: SnapPreview | null
}

function featureId(feature: Feature) {
  return String(feature.id ?? feature.properties?.id ?? '')
}

function isTextFeature(feature: Feature) {
  return feature.properties?.featureType === 'text_label'
}

type RenderVariant = 'published' | 'saved-draft' | 'in-progress'

function variantStyle(variant: RenderVariant, lassoDraft: boolean) {
  if (variant === 'in-progress') {
    return lassoDraft
      ? { fill: 'rgba(37,99,235,0.14)', stroke: '#2563eb', lineWidth: 2.75 }
      : { fill: 'rgba(59,130,246,0.16)', stroke: '#2563eb', lineWidth: 2.75 }
  }
  if (variant === 'published') {
    return { fill: 'rgba(168,85,247,0.18)', stroke: '#7e22ce', lineWidth: 2.75 }
  }
  return { fill: 'rgba(239,68,68,0.16)', stroke: '#dc2626', lineWidth: 2.75 }
}

function projectPoint(map: Map, position: Position) {
  const point = map.project([position[0], position[1]])
  return { x: point.x, y: point.y }
}

function drawRing(ctx: CanvasRenderingContext2D, map: Map, ring: Position[]) {
  ring.forEach((position, index) => {
    const point = projectPoint(map, position)
    if (index === 0) {
      ctx.moveTo(point.x, point.y)
    } else {
      ctx.lineTo(point.x, point.y)
    }
  })
}

function drawPolygonPath(ctx: CanvasRenderingContext2D, map: Map, rings: Position[][]) {
  ctx.beginPath()
  rings.forEach((ring) => drawRing(ctx, map, ring))
}

function drawMultiPolygon(
  ctx: CanvasRenderingContext2D,
  map: Map,
  geometry: MultiPolygon,
  fillStyle: string,
  strokeStyle: string,
  lineWidth: number,
) {
  ctx.fillStyle = fillStyle
  ctx.strokeStyle = strokeStyle
  ctx.lineWidth = lineWidth
  geometry.coordinates.forEach((polygon) => {
    drawPolygonPath(ctx, map, polygon as Position[][])
    ctx.fill('evenodd')
    ctx.stroke()
  })
}

function projectedBounds(map: Map, ring: Position[]) {
  if (ring.length === 0) return null
  const points = ring.map((position) => projectPoint(map, position))
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
}

function geometryProjectedRotateAnchor(map: Map, geometry: Geometry | null) {
  if (!geometry) return null
  const positions: Position[] =
    geometry.type === 'Point'
      ? [geometry.coordinates as Position]
      : geometry.type === 'LineString'
        ? (geometry.coordinates as Position[])
        : geometry.type === 'Polygon'
          ? (geometry.coordinates.flat() as Position[])
          : geometry.type === 'MultiPoint'
            ? (geometry.coordinates as Position[])
            : geometry.type === 'MultiLineString'
              ? (geometry.coordinates.flat() as Position[])
              : geometry.type === 'MultiPolygon'
                ? (geometry.coordinates.flat(2) as Position[])
                : []
  if (positions.length === 0) return null
  const total = positions.reduce(
    (sum, [lng, lat]) => {
      sum.lng += lng
      sum.lat += lat
      return sum
    },
    { lng: 0, lat: 0 },
  )
  const center = projectPoint(map, [total.lng / positions.length, total.lat / positions.length])
  const radius = positions.reduce((maxRadius, position) => {
    const point = projectPoint(map, position)
    return Math.max(maxRadius, Math.hypot(point.x - center.x, point.y - center.y))
  }, 0)
  const handleOffset = Math.max(28, radius * 0.18)
  return {
    centerX: center.x,
    centerY: center.y,
    radius,
    handleX: center.x,
    handleY: center.y + radius + handleOffset,
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function drawTextBox(
  ctx: CanvasRenderingContext2D,
  map: Map,
  feature: Feature,
  selected: boolean,
  variant: RenderVariant,
  lassoDraft: boolean,
) {
  if (feature.geometry.type !== 'Polygon') return
  const ring = feature.geometry.coordinates[0] as Position[]
  const bounds = projectedBounds(map, ring)
  if (!bounds) return
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  if (width < 4 || height < 4) return
  const style = variantStyle(variant, lassoDraft)

  ctx.fillStyle = variant === 'in-progress' ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.86)'
  ctx.strokeStyle = style.stroke
  ctx.lineWidth = style.lineWidth
  ctx.fillRect(bounds.minX, bounds.minY, width, height)
  ctx.strokeRect(bounds.minX, bounds.minY, width, height)
  if (selected) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = style.lineWidth + 3
    ctx.strokeRect(bounds.minX, bounds.minY, width, height)
    ctx.strokeStyle = '#16a34a'
    ctx.lineWidth = style.lineWidth + 1
    ctx.strokeRect(bounds.minX, bounds.minY, width, height)
  }

  const props = feature.properties ?? {}
  const value = String(props.text ?? props.name ?? props.tag ?? '')
  if (!value) return
  const fontSize = Number((props.textStyle as Record<string, unknown> | undefined)?.fontSize ?? 14)
  ctx.font = `${fontSize}px sans-serif`
  ctx.fillStyle = '#0f172a'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const padding = 6
  const lines = wrapText(ctx, value, Math.max(8, width - padding * 2))
  const lineHeight = fontSize * 1.25
  lines.slice(0, Math.max(1, Math.floor((height - padding * 2) / lineHeight))).forEach((line, index) => {
    ctx.fillText(line, bounds.minX + padding, bounds.minY + padding + index * lineHeight)
  })
}

function drawFeature(
  ctx: CanvasRenderingContext2D,
  map: Map,
  feature: Feature,
  selected: boolean,
  lassoDraft: boolean,
  variant: RenderVariant = 'saved-draft',
) {
  const geometry = feature.geometry as Geometry | null
  if (!geometry) return
  const style = variantStyle(variant, lassoDraft)
  const fill = style.fill
  const baseStroke = style.stroke
  const lineWidth = style.lineWidth

  if (isTextFeature(feature)) {
    drawTextBox(ctx, map, feature, selected, variant, lassoDraft)
    return
  }

  if (geometry.type === 'Polygon') {
    drawPolygonPath(ctx, map, geometry.coordinates as Position[][])
    ctx.fillStyle = fill
    ctx.strokeStyle = baseStroke
    ctx.lineWidth = lineWidth
    ctx.fill('evenodd')
    ctx.stroke()
    if (selected) {
      drawPolygonPath(ctx, map, geometry.coordinates as Position[][])
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = lineWidth + 3
      ctx.stroke()
      drawPolygonPath(ctx, map, geometry.coordinates as Position[][])
      ctx.strokeStyle = '#16a34a'
      ctx.lineWidth = lineWidth + 1
      ctx.stroke()
    }
  } else if (geometry.type === 'MultiPolygon') {
    drawMultiPolygon(ctx, map, geometry as MultiPolygon, fill, baseStroke, lineWidth)
    if (selected) {
      drawMultiPolygon(ctx, map, geometry as MultiPolygon, 'rgba(0,0,0,0)', '#ffffff', lineWidth + 3)
      drawMultiPolygon(ctx, map, geometry as MultiPolygon, 'rgba(0,0,0,0)', '#16a34a', lineWidth + 1)
    }
  } else if (geometry.type === 'LineString') {
    ctx.beginPath()
    ;(geometry.coordinates as Position[]).forEach((position, index) => {
      const point = projectPoint(map, position)
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.strokeStyle = baseStroke
    ctx.lineWidth = lineWidth
    ctx.stroke()
    if (selected) {
      ctx.beginPath()
      ;(geometry.coordinates as Position[]).forEach((position, index) => {
        const point = projectPoint(map, position)
        if (index === 0) ctx.moveTo(point.x, point.y)
        else ctx.lineTo(point.x, point.y)
      })
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = lineWidth + 3
      ctx.stroke()
      ctx.beginPath()
      ;(geometry.coordinates as Position[]).forEach((position, index) => {
        const point = projectPoint(map, position)
        if (index === 0) ctx.moveTo(point.x, point.y)
        else ctx.lineTo(point.x, point.y)
      })
      ctx.strokeStyle = '#16a34a'
      ctx.lineWidth = lineWidth + 1
      ctx.stroke()
    }
  } else if (geometry.type === 'Point') {
    const point = projectPoint(map, geometry.coordinates as Position)
    ctx.beginPath()
    ctx.arc(point.x, point.y, selected ? 8 : 5, 0, Math.PI * 2)
    if (selected) {
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2)
    }
    ctx.fillStyle = selected ? '#16a34a' : baseStroke
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.fill()
    ctx.stroke()
  } else if (geometry.type === 'MultiPoint') {
    ;(geometry.coordinates as Position[]).forEach((position) => {
      const point = projectPoint(map, position)
      ctx.beginPath()
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = baseStroke
      ctx.lineWidth = 2
      ctx.fill()
      ctx.stroke()
    })
  }
}

export function SpatialCanvasOverlay({
  map,
  draftMode = null,
  visibleFeatures,
  publishedFeatures = [],
  localDraftFeatureIds = [],
  selectedFeatureIds,
  draftCollection,
  snapPreview,
}: SpatialCanvasOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!map) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    const selectedSet = new Set(selectedFeatureIds)
    const lassoDraft = draftMode === 'delete_lasso'
    const localDraftIds = new Set(localDraftFeatureIds)
    const publishedById = new globalThis.Map(
      publishedFeatures
        .map((feature) => [featureId(feature), feature] as const)
        .filter(([id]) => Boolean(id)),
    )

    const isPublishedFeature = (feature: Feature) => {
      const id = featureId(feature)
      if (!id) return false
      const publishedFeature = publishedById.get(id)
      if (!publishedFeature) return false
      return (
        JSON.stringify(publishedFeature.geometry) === JSON.stringify(feature.geometry) &&
        JSON.stringify(publishedFeature.properties ?? {}) === JSON.stringify(feature.properties ?? {})
      )
    }

    const render = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const width = Math.max(1, Math.floor(rect.width * dpr))
      const height = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)

      visibleFeatures.forEach((feature) => {
        const featureStateId = featureId(feature)
        drawFeature(
          ctx,
          map,
          feature,
          selectedSet.has(featureStateId),
          false,
          localDraftIds.has(featureStateId)
            ? 'in-progress'
            : isPublishedFeature(feature)
              ? 'published'
              : 'saved-draft',
        )
      })

      if (selectedFeatureIds.length === 1) {
        const selectedFeature = visibleFeatures.find((feature) => featureId(feature) === selectedFeatureIds[0])
        const anchor = selectedFeature
          ? geometryProjectedRotateAnchor(map, selectedFeature.geometry as Geometry | null)
          : null
        if (anchor) {
          const { centerX, centerY, radius, handleY } = anchor
          ctx.beginPath()
          ctx.setLineDash([4, 4])
          ctx.strokeStyle = 'rgba(15,23,42,0.9)'
          ctx.lineWidth = 1.5
          ctx.moveTo(centerX, centerY + Math.max(8, radius + 4))
          ctx.lineTo(centerX, handleY - 10)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.arc(centerX, handleY, 9, 0, Math.PI * 2)
          ctx.fillStyle = '#0f172a'
          ctx.fill()
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 2.5
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(centerX, centerY, 3, 0, Math.PI * 2)
          ctx.fillStyle = '#f97316'
          ctx.fill()
        }
      }

      draftCollection?.features.forEach((feature) => {
        drawFeature(ctx, map, feature as Feature, false, lassoDraft, 'in-progress')
      })

      if (snapPreview) {
        const point = projectPoint(map, snapPreview.point)
        ctx.beginPath()
        ctx.arc(point.x, point.y, 6, 0, Math.PI * 2)
        ctx.fillStyle = '#f97316'
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.fill()
        ctx.stroke()
      }
    }

    const schedule = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(render)
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(canvas)
    map.on('move', schedule)
    map.on('zoom', schedule)
    map.on('resize', schedule)
    schedule()

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      map.off('move', schedule)
      map.off('zoom', schedule)
      map.off('resize', schedule)
    }
  }, [draftCollection, draftMode, localDraftFeatureIds, map, publishedFeatures, selectedFeatureIds, snapPreview, visibleFeatures])

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-10 h-full w-full" />
}
