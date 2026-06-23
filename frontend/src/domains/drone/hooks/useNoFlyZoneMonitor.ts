import { useEffect, useMemo, useRef } from 'react'
import type { DrawingProject } from '../../spatial-editor/types'
import type { DroneRegistry } from '../types'
import type { NoticeState } from '../../../shared/components/Notice'
import { throttle, type ThrottledFunction } from '../../../shared/utils/throttle'
import {
  collectNoFlyZones,
  isPointInNoFlyZones,
  type NoFlyZone,
} from '../../map/noFlyZones'

// Telemetry can arrive at 10-60Hz; cap the polygon math to a few times per second.
const GEOFENCE_CHECK_INTERVAL_MS = 250

interface UseNoFlyZoneMonitorParams {
  dronesById: DroneRegistry
  overlayProjects: DrawingProject[]
  selectedOverlayFloorId: string | null
  onBreach: (notice: NoticeState) => void
}

/**
 * Watches connected drones against active `no_fly_zone` overlay polygons and
 * fires a high-priority notice the moment a drone enters a restricted zone.
 *
 * Performance: the filtered zone list is memoized and the polygon intersection
 * pass is throttled. Notices are edge-triggered (once per entry) so high-rate
 * telemetry never spams the UI; a drone that leaves and re-enters alerts again.
 */
export function useNoFlyZoneMonitor({
  dronesById,
  overlayProjects,
  selectedOverlayFloorId,
  onBreach,
}: UseNoFlyZoneMonitorParams): void {
  const noFlyZones = useMemo<NoFlyZone[]>(
    () => collectNoFlyZones(overlayProjects, selectedOverlayFloorId),
    [overlayProjects, selectedOverlayFloorId],
  )

  const zonesRef = useRef<NoFlyZone[]>(noFlyZones)
  const dronesRef = useRef<DroneRegistry>(dronesById)
  const onBreachRef = useRef(onBreach)
  const breachedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    zonesRef.current = noFlyZones
  }, [noFlyZones])
  useEffect(() => {
    dronesRef.current = dronesById
  }, [dronesById])
  useEffect(() => {
    onBreachRef.current = onBreach
  }, [onBreach])

  // Stable throttled checker; reads the latest drones/zones via refs. Created in
  // an effect (not during render) so it never touches refs in the render phase.
  const runCheckRef = useRef<ThrottledFunction<[]> | null>(null)
  useEffect(() => {
    const runCheck = throttle(() => {
      const zones = zonesRef.current
      const breached = breachedRef.current
      if (zones.length === 0) {
        breached.clear()
        return
      }

      for (const drone of Object.values(dronesRef.current)) {
        if (drone.status !== 'connected' || drone.lon == null || drone.lat == null) {
          continue
        }

        const point: [number, number] = [drone.lon, drone.lat]
        const inside = isPointInNoFlyZones(point, zones)

        if (inside && !breached.has(drone.id)) {
          breached.add(drone.id)
          onBreachRef.current({
            tone: 'error',
            title: 'CRITICAL WARNING',
            detail: `Drone ${drone.id} has breached a No-Fly Zone!`,
          })
        } else if (!inside && breached.has(drone.id)) {
          breached.delete(drone.id)
        }
      }
    }, GEOFENCE_CHECK_INTERVAL_MS)

    runCheckRef.current = runCheck
    return () => {
      runCheck.cancel()
      runCheckRef.current = null
    }
  }, [])

  useEffect(() => {
    // Early return: nothing to check when there are no active no-fly zones.
    if (noFlyZones.length === 0) {
      breachedRef.current.clear()
      return
    }
    runCheckRef.current?.()
  }, [dronesById, noFlyZones])
}
