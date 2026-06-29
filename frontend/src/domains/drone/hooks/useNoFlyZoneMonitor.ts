import { useEffect, useMemo, useRef } from 'react'
import type { DrawingProject } from '../../spatial-editor/types'
import type { DroneRegistry } from '../types'
import type { NoticeState } from '../../../shared/components/Notice'
import { throttle, type ThrottledFunction } from '../../../shared/utils/throttle'
import {
  collectAllowedZones,
  collectNoFlyZones,
  isInsideAnyAllowedZone,
  isPointInNoFlyZones,
  type Zone,
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
 * Watches connected drones against the active geofence zones and fires a
 * high-priority notice the moment a drone violates one. Two complementary rules:
 *
 *  - **No-fly zones** (exclusion): a drone INSIDE any `no_fly_zone` breaches.
 *  - **Allowed zones** (inclusion): when at least one `allowed_zone` exists, a
 *    drone OUTSIDE all of them breaches (it has left the permitted airspace).
 *    With no allowed zones, the inclusion rule is inactive.
 *
 * Performance: the filtered zone lists are memoized and the polygon pass is
 * throttled. Notices are edge-triggered (once per entry/exit) so high-rate
 * telemetry never spams the UI; the two rules track separate breach sets so a
 * drone can transition between them cleanly.
 */
export function useNoFlyZoneMonitor({
  dronesById,
  overlayProjects,
  selectedOverlayFloorId,
  onBreach,
}: UseNoFlyZoneMonitorParams): void {
  const noFlyZones = useMemo<Zone[]>(
    () => collectNoFlyZones(overlayProjects, selectedOverlayFloorId),
    [overlayProjects, selectedOverlayFloorId],
  )
  const allowedZones = useMemo<Zone[]>(
    () => collectAllowedZones(overlayProjects, selectedOverlayFloorId),
    [overlayProjects, selectedOverlayFloorId],
  )

  const noFlyZonesRef = useRef<Zone[]>(noFlyZones)
  const allowedZonesRef = useRef<Zone[]>(allowedZones)
  const dronesRef = useRef<DroneRegistry>(dronesById)
  const onBreachRef = useRef(onBreach)
  const breachedNoFlyRef = useRef<Set<string>>(new Set())
  const outsideAllowedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    noFlyZonesRef.current = noFlyZones
  }, [noFlyZones])
  useEffect(() => {
    allowedZonesRef.current = allowedZones
  }, [allowedZones])
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
      const noFly = noFlyZonesRef.current
      const allowed = allowedZonesRef.current
      const breachedNoFly = breachedNoFlyRef.current
      const outsideAllowed = outsideAllowedRef.current
      if (noFly.length === 0 && allowed.length === 0) {
        breachedNoFly.clear()
        outsideAllowed.clear()
        return
      }

      for (const drone of Object.values(dronesRef.current)) {
        if (drone.status !== 'connected' || drone.lon == null || drone.lat == null) {
          continue
        }

        const point: [number, number] = [drone.lon, drone.lat]

        // Exclusion rule: inside any no-fly zone.
        const inNoFly = noFly.length > 0 && isPointInNoFlyZones(point, noFly)
        if (inNoFly && !breachedNoFly.has(drone.id)) {
          breachedNoFly.add(drone.id)
          onBreachRef.current({
            tone: 'error',
            title: 'CRITICAL WARNING',
            detail: `Drone ${drone.id} has breached a No-Fly Zone!`,
          })
        } else if (!inNoFly && breachedNoFly.has(drone.id)) {
          breachedNoFly.delete(drone.id)
        }

        // Inclusion rule: outside every allowed zone (only when zones exist).
        const outside = allowed.length > 0 && !isInsideAnyAllowedZone(point, allowed)
        if (outside && !outsideAllowed.has(drone.id)) {
          outsideAllowed.add(drone.id)
          onBreachRef.current({
            tone: 'error',
            title: 'CRITICAL WARNING',
            detail: `Drone ${drone.id} has left the allowed flight zone!`,
          })
        } else if (!outside && outsideAllowed.has(drone.id)) {
          outsideAllowed.delete(drone.id)
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
    // Early return: nothing to check when there are no active zones at all.
    if (noFlyZones.length === 0 && allowedZones.length === 0) {
      breachedNoFlyRef.current.clear()
      outsideAllowedRef.current.clear()
      return
    }
    runCheckRef.current?.()
  }, [dronesById, noFlyZones, allowedZones])
}
