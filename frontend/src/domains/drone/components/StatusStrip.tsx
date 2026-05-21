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

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <ConnectionIcon
            className={isOnline ? 'size-4 text-sky-600' : 'size-4 text-rose-600'}
            aria-hidden="true"
          />
          Telemetry
        </div>
        <div className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-sm font-semibold ${connectionTone}`}>
          {connectionLabel(connectionStatus)}
        </div>
        <p className="mt-1 truncate text-xs text-slate-500" title={connectionMessage}>
          {connectionMessage}
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <RadioTower className="size-4 text-sky-600" aria-hidden="true" />
          Drones
        </div>
        <div className="mt-2 text-lg font-semibold text-slate-950">
          {connectedCount}
        </div>
        <p className="mt-1 text-xs text-slate-500">Connected now</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <BatteryMedium className="size-4 text-sky-600" aria-hidden="true" />
          Battery
        </div>
        <div className="mt-2 text-lg font-semibold text-slate-950">
          {averageBattery}
        </div>
        <p className="mt-1 text-xs text-slate-500">Fleet average</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <Send className="size-4 text-sky-600" aria-hidden="true" />
          Command
        </div>
        <div className="mt-2 text-lg font-semibold text-slate-950">
          {commandStatusLabel(commandStatus)}
        </div>
        <p className="mt-1 text-xs text-slate-500">Map target flow</p>
      </div>
    </div>
  )
}
