import { memo } from 'react'
import { Battery, LocateFixed } from 'lucide-react'
import type { DroneState } from '../types/drone'
import { formatBattery, formatCoordinate } from '../utils/format'

interface DroneTableProps {
  drones: DroneState[]
  isTelemetryOpen: boolean
  selectedTrackingDroneId: string | null
  onSelectTrackingDrone: (droneId: string) => void
}

export const DroneTable = memo(function DroneTable({
  drones,
  isTelemetryOpen,
  selectedTrackingDroneId,
  onSelectTrackingDrone,
}: DroneTableProps) {
  if (drones.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-sky-100 text-sky-700">
          <LocateFixed className="size-5" aria-hidden="true" />
        </div>
        <h2 className="mt-3 text-sm font-semibold text-slate-950">
          {isTelemetryOpen ? 'Waiting for drones' : 'Telemetry not connected'}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {isTelemetryOpen
            ? 'Connected drone telemetry will appear here.'
            : 'Start the backend and simulator to populate this table.'}
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed divide-y divide-slate-200 text-left text-sm">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[16%]" />
            <col className="w-[20%]" />
            <col className="w-[22%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Drone ID</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Lat</th>
              <th className="px-3 py-3">Lon</th>
              <th className="px-3 py-3">Battery</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {drones.map((drone) => (
              <tr
                className={`cursor-pointer transition-colors ${
                  selectedTrackingDroneId === drone.id
                    ? 'bg-sky-100/80'
                    : 'hover:bg-sky-50/70'
                }`}
                key={drone.id}
                onClick={() => onSelectTrackingDrone(drone.id)}
                aria-selected={selectedTrackingDroneId === drone.id}
              >
                <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-950">
                  {drone.id}
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    On
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-700">
                  {formatCoordinate(drone.lat, 5)}
                </td>
                <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-700">
                  {formatCoordinate(drone.lon, 5)}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                  <span className="inline-flex items-center gap-1">
                    <Battery className="size-4 text-sky-600" aria-hidden="true" />
                    {formatBattery(drone.battery)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})
