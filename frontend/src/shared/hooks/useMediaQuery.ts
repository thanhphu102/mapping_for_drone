import { useSyncExternalStore } from 'react'

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 * Uses useSyncExternalStore so the value stays consistent across renders and
 * is SSR-safe (server snapshot is always false).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (onChange: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return () => {}
    }
    const mediaQueryList = window.matchMedia(query)
    mediaQueryList.addEventListener('change', onChange)
    return () => {
      mediaQueryList.removeEventListener('change', onChange)
    }
  }

  const getSnapshot = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia(query).matches
  }

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
