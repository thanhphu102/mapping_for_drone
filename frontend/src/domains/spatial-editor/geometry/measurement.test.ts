import { describe, expect, it } from 'vitest'
import { roundMeasurement } from './measurement'

describe('roundMeasurement', () => {
  it('rounds to the given precision', () => {
    expect(roundMeasurement(1.23456, 2)).toBe(1.23)
  })

  it('follows toFixed binary-float rounding (1.005 stores as slightly below 1.005)', () => {
    expect(roundMeasurement(1.005, 2)).toBe(1)
  })

  it('returns an integer unchanged at precision 0', () => {
    expect(roundMeasurement(42, 0)).toBe(42)
  })

  it('handles negative values', () => {
    expect(roundMeasurement(-1.239, 2)).toBe(-1.24)
  })

  it('handles zero', () => {
    expect(roundMeasurement(0, 6)).toBe(0)
  })

  it('returns a number, not a string', () => {
    expect(typeof roundMeasurement(1.1, 2)).toBe('number')
  })
})
