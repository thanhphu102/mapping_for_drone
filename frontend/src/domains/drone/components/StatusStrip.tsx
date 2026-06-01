import { BatteryMedium, RadioTower, Send, Wifi, WifiOff } from 'lucide-react'
import type { CommandDispatchStatus, ConnectionStatus } from '../types'

interface StatusStripProps {
  connectionStatus: ConnectionStatus
  connectionMessage: string
  connectedCount: number
  averageBattery: string
  commandStatus: CommandDispatchStatus
}

function connectionLabel(status: ConnectionStatus) {
  if (status === 'open') {
    return 'Online'
  }

  if (status === 'connecting') {
    return 'Connecting'
  }

  if (status === 'error') {
    return 'Error'
  }

  return 'Closed'
}

function commandStatusLabel(status: CommandDispatchStatus) {
  if (status === 'sending') {
    return 'Sending'
  }

  if (status === 'success') {
    return 'Sent'
  }

  if (status === 'error') {
    return 'Error'
  }

  return 'Ready'
}

export function StatusStrip({
  connectionStatus,
  connectionMessage,
  connectedCount,
  averageBattery,
  commandStatus,
}: StatusStripProps) {
  const isOnline = connectionStatus === 'open'
  const ConnectionIcon = isOnline ? Wifi : WifiOff
  const connectionTone = isOnline
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : connectionStatus === 'connecting'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-rose-200 bg-rose-50 text-rose-700'
  const commandTone = commandStatus === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : commandStatus === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : commandStatus === 'sending'
        ? 'border-sky-200 bg-sky-50 text-sky-700'
        : 'border-slate-200 bg-slate-50 text-slate-700'

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${connectionTone}`}>
          <ConnectionIcon className="size-4" aria-hidden="true" />
          {connectionLabel(connectionStatus)}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-800">
          <RadioTower className="size-4 text-sky-600" aria-hidden="true" />
          {connectedCount} drone{connectedCount === 1 ? '' : 's'}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-800">
          <BatteryMedium className="size-4 text-sky-600" aria-hidden="true" />
          Avg battery {averageBattery}
        </span>
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${commandTone}`}>
          <Send className="size-4" aria-hidden="true" />
          Command {commandStatusLabel(commandStatus)}
        </span>
      </div>
      <p className="mt-3 text-sm text-slate-500" title={connectionMessage}>
        {connectionMessage}
      </p>
    </section>
  )
}
