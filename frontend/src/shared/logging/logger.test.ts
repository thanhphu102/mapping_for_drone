import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from './logger'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createLogger', () => {
  it('prefixes info messages with the scope and forwards extra details', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    createLogger('useDroneTelemetry').info('Command sent to:', ['drone-1'])
    expect(spy).toHaveBeenCalledWith('[useDroneTelemetry] Command sent to:', ['drone-1'])
  })

  it('prefixes warn messages with the scope', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createLogger('MapProvider').warn('map error', { code: 1 })
    expect(spy).toHaveBeenCalledWith('[MapProvider] map error', { code: 1 })
  })

  it('prefixes error messages with the scope', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('parse failed')
    createLogger('useDroneTelemetry').error('WebSocket parse error:', error)
    expect(spy).toHaveBeenCalledWith('[useDroneTelemetry] WebSocket parse error:', error)
  })

  it('gives each scope its own independent prefix', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    createLogger('A').info('hello')
    createLogger('B').info('hello')
    expect(spy).toHaveBeenNthCalledWith(1, '[A] hello')
    expect(spy).toHaveBeenNthCalledWith(2, '[B] hello')
  })
})
