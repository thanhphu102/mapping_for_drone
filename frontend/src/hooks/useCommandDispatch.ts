import { useCallback, useState } from 'react'
import { sendDroneCommand } from '../services/commands'
import type {
  CommandDispatchStatus,
  CommandResponse,
  CommandTarget,
} from '../types/drone'
import { formatDroneList } from '../utils/format'

interface CommandDispatchState {
  status: CommandDispatchStatus
  message: string
  sent: string[]
}

const idleState: CommandDispatchState = {
  status: 'idle',
  message: 'Ready for map target',
  sent: [],
}

export function useCommandDispatch() {
  const [state, setState] = useState<CommandDispatchState>(idleState)

  const reset = useCallback(() => {
    setState(idleState)
  }, [])

  const sendTarget = useCallback(
    async (target: CommandTarget): Promise<CommandResponse> => {
      setState({
        status: 'sending',
        message: 'Sending target to connected drones',
        sent: [],
      })

      try {
        const response = await sendDroneCommand(target)
        const sent = response.sent ?? []

        setState({
          status: 'success',
          message: `Command sent to: ${formatDroneList(sent)}`,
          sent,
        })

        return {
          ok: response.ok,
          sent,
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Command request failed'

        setState({
          status: 'error',
          message,
          sent: [],
        })

        throw error
      }
    },
    [],
  )

  return {
    state,
    reset,
    sendTarget,
  }
}

