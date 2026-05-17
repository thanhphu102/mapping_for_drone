import { useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Position } from 'geojson'
import type { Map } from 'maplibre-gl'
import type { SnapPreview } from '../hooks/useSnapEngine'

interface SpatialCanvasOverlayProps {
  map: Map | null
  projectStatus?: 'draft' | 'published' | 'archived'
  draftMode?: string | null
  visibleFeatures: Feature[]
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

function drawTextBox(ctx: CanvasRenderingContext2D, map: Map, feature: Feature, selected: boolean) {
  if (feature.geometry.type !== 'Polygon') return
  const ring = feature.geometry.coordinates[0] as Position[]
  const bounds = projectedBounds(map, ring)
  if (!bounds) return
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  if (width < 4 || height < 4) return

  ctx.fillStyle = 'rgba(255,255,255,0.82)'
  ctx.strokeStyle = selected ? '#38bdf8' : 'rgba(15,23,42,0.35)'
  ctx.lineWidth = selected ? 2 : 1
  ctx.fillRect(bounds.minX, bounds.minY, width, height)
  ctx.strokeRect(bounds.minX, bounds.minY, width, height)

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
  published: boolean,
  lassoDraft: boolean,
  draft = false,
) {
  const geometry = feature.geometry as Geometry | null
  if (!geometry) return
  const savedFill = published ? 'rgba(168,85,247,0.20)' : 'rgba(34,197,94,0.18)'
  const savedStroke = published ? '#7e22ce' : '#15803d'
  const draftFill = lassoDraft ? 'rgba(59,130,246,0.12)' : 'rgba(34,197,94,0.18)'
  const draftStroke = lassoDraft ? '#2563eb' : '#15803d'
  const fill = draft ? draftFill : savedFill
  const stroke = selected ? '#38bdf8' : draft ? draftStroke : savedStroke
  const lineWidth = selected ? 3 : draft ? 2.5 : 2

  if (isTextFeature(feature)) {
    drawTextBox(ctx, map, feature, selected)
    return
  }

  if (geometry.type === 'Polygon') {
    drawPolygonPath(ctx, map, geometry.coordinates as Position[][])
    ctx.fillStyle = fill
    ctx.strokeStyle = stroke
    ctx.lineWidth = lineWidth
    ctx.fill('evenodd')
    ctx.stroke()
  } else if (geometry.type === 'MultiPolygon') {
    drawMultiPolygon(ctx, map, geometry as MultiPolygon, fill, stroke, lineWidth)
  } else if (geometry.type === 'LineString') {
    ctx.beginPath()
    ;(geometry.coordinates as Position[]).forEach((position, index) => {
      const point = projectPoint(map, position)
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.strokeStyle = stroke
    ctx.lineWidth = lineWidth
    ctx.stroke()
  } else if (geometry.type === 'Point') {
    const point = projectPoint(map, geometry.coordinates as Position)
    ctx.beginPath()
    ctx.arc(point.x, point.y, selected ? 7 : 5, 0, Math.PI * 2)
    ctx.fillStyle = draft ? draftStroke : savedStroke
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
      ctx.strokeStyle = draft ? draftStroke : savedStroke
      ctx.lineWidth = 2
      ctx.fill()
      ctx.stroke()
    })
  }
}

export function SpatialCanvasOverlay({
  map,
  projectStatus = 'draft',
  draftMode = null,
  visibleFeatures,
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
    const published = projectStatus === 'published'
    const lassoDraft = draftMode === 'delete_lasso'

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
        drawFeature(ctx, map, feature, selectedSet.has(featureId(feature)), published, false)
      })

      draftCollection?.features.forEach((feature) => {
        drawFeature(ctx, map, feature as Feature, false, published, lassoDraft, true)
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
  }, [draftCollection, draftMode, map, projectStatus, selectedFeatureIds, snapPreview, visibleFeatures])

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-10 h-full w-full" />
}
