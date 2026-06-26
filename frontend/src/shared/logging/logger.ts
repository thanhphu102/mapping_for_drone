export interface Logger {
  info(message: string, ...details: unknown[]): void
  warn(message: string, ...details: unknown[]): void
  error(message: string, ...details: unknown[]): void
}

/**
 * Thin facade over console.*, scoped with a `[scope]` prefix so logs can be
 * traced back to their origin. No-op replacement target for a future
 * error-reporting SDK (e.g. Sentry) — call sites stay unchanged either way.
 */
export function createLogger(scope: string): Logger {
  const prefix = `[${scope}]`
  return {
    info: (message, ...details) => console.info(`${prefix} ${message}`, ...details),
    warn: (message, ...details) => console.warn(`${prefix} ${message}`, ...details),
    error: (message, ...details) => console.error(`${prefix} ${message}`, ...details),
  }
}
