function normalizeWsUrl(base: string): string {
  if (base.endsWith('/ws/frontend')) {
    return base
  }

  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
  return `${trimmed}/ws/frontend`
}

export function getFrontendWebSocketUrl(): string {
  const configured = import.meta.env.VITE_BACKEND_WS_URL as string | undefined
  if (configured && configured.trim().length > 0) {
    return normalizeWsUrl(configured.trim())
  }

  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://'
  return `${protocol}${window.location.host}/ws/frontend`
}

export function createFrontendWebSocket(): WebSocket {
  return new WebSocket(getFrontendWebSocketUrl())
}
