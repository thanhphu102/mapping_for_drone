import type { BatteryValue } from '../types/drone'

export function formatCoordinate(value: number | undefined, digits: number) {
  return value === undefined ? '-' : value.toFixed(digits)
}

export function formatBattery(value: BatteryValue | undefined) {
  if (value === undefined) {
    return '-'
  }

  return typeof value === 'number' ? value.toFixed(1) : value
}

export function formatDroneList(ids: string[]) {
  return ids.length > 0 ? ids.join(', ') : 'No drones'
}

