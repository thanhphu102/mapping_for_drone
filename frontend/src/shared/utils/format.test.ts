import { describe, expect, it } from 'vitest'
import { formatBattery, formatCoordinate, formatDroneList } from './format'

describe('formatCoordinate', () => {
  it('formats a number to the given digit precision', () => {
    expect(formatCoordinate(1.23456, 2)).toBe('1.23')
  })

  it('returns a dash for undefined', () => {
    expect(formatCoordinate(undefined, 2)).toBe('-')
  })

  it('formats zero', () => {
    expect(formatCoordinate(0, 4)).toBe('0.0000')
  })
})

describe('formatBattery', () => {
  it('formats a numeric battery value to one decimal', () => {
    expect(formatBattery(87.456)).toBe('87.5')
  })

  it('passes through a string battery value unchanged', () => {
    expect(formatBattery('charging')).toBe('charging')
  })

  it('returns a dash for undefined', () => {
    expect(formatBattery(undefined)).toBe('-')
  })
})

describe('formatDroneList', () => {
  it('joins drone ids with a comma', () => {
    expect(formatDroneList(['a', 'b', 'c'])).toBe('a, b, c')
  })

  it('returns a fallback message for an empty list', () => {
    expect(formatDroneList([])).toBe('No drones')
  })

  it('returns a single id unchanged', () => {
    expect(formatDroneList(['a'])).toBe('a')
  })
})
