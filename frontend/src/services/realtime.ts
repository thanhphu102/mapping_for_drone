export function createFrontendWebSocket(): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://'
  return new WebSocket(`${protocol}${window.location.host}/ws/frontend`)
}

