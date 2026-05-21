import type { CommandResponse, CommandTarget } from '../types'

export async function sendDroneCommand(
  target: CommandTarget,
): Promise<CommandResponse> {
  const response = await fetch('/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, drones: 'all' }),
  })

  if (!response.ok) {
    throw new Error(`Command failed with HTTP ${response.status}`)
  }

  return (await response.json()) as CommandResponse
}
