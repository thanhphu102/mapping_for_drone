import { useCallback, useState } from 'react'
import type { CommandTarget, MapTargetDraft } from '../types'
import { formatDroneList } from '../../../shared/utils/format'
import { useCommandDispatch } from './useCommandDispatch'

export interface CommandFlowNotice {
  tone: 'success' | 'error' | 'info'
  title: string
  detail?: string
}

interface UseCommandFlowOptions {
  onNotice: (notice: CommandFlowNotice) => void
  onTargetSelected?: () => void
  onTargetCleared?: () => void
}

export function useCommandFlow({
  onNotice,
  onTargetSelected,
  onTargetCleared,
}: UseCommandFlowOptions) {
  const commandDispatch = useCommandDispatch()
  const [selectedTarget, setSelectedTarget] = useState<CommandTarget | null>(null)

  const handleTargetSelect = useCallback(
    (target: MapTargetDraft) => {
      commandDispatch.reset()
      onTargetSelected?.()
      setSelectedTarget({
        lat: Number(target.lat.toFixed(6)),
        lon: Number(target.lon.toFixed(6)),
      })
    },
    [commandDispatch, onTargetSelected],
  )

  const handleConfirmTarget = useCallback(async () => {
    if (!selectedTarget) {
      return
    }

    try {
      const response = await commandDispatch.sendTarget(selectedTarget)
      onNotice({
        tone: 'success',
        title: 'Command sent',
        detail: `Command sent to: ${formatDroneList(response.sent)}`,
      })
      onTargetCleared?.()
      setSelectedTarget(null)
    } catch (error) {
      onNotice({
        tone: 'error',
        title: 'Command failed',
        detail:
          error instanceof Error ? error.message : 'Unable to send command',
      })
    }
  }, [commandDispatch, onNotice, onTargetCleared, selectedTarget])

  const handleCancelTarget = useCallback(() => {
    onTargetCleared?.()
    setSelectedTarget(null)
  }, [onTargetCleared])

  return {
    selectedTarget,
    commandState: commandDispatch.state,
    handleTargetSelect,
    handleConfirmTarget,
    handleCancelTarget,
  }
}
