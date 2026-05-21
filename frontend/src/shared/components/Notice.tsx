import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

export type NoticeTone = 'info' | 'success' | 'error'

export interface NoticeState {
  tone: NoticeTone
  title: string
  detail?: string
}

interface NoticeProps {
  notice: NoticeState | null
  onDismiss: () => void
}

const toneClassName: Record<NoticeTone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-rose-200 bg-rose-50 text-rose-900',
}

const iconClassName: Record<NoticeTone, string> = {
  info: 'text-sky-600',
  success: 'text-emerald-600',
  error: 'text-rose-600',
}

function NoticeIcon({ tone }: { tone: NoticeTone }) {
  if (tone === 'success') {
    return <CheckCircle2 className="size-5" aria-hidden="true" />
  }

  if (tone === 'error') {
    return <AlertCircle className="size-5" aria-hidden="true" />
  }

  return <Info className="size-5" aria-hidden="true" />
}

export function Notice({ notice, onDismiss }: NoticeProps) {
  if (!notice) {
    return null
  }

  return (
    <div
      className={`fixed bottom-4 left-4 right-4 z-30 rounded-lg border p-4 shadow-lg md:left-auto md:right-6 md:w-96 ${toneClassName[notice.tone]}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className={iconClassName[notice.tone]}>
          <NoticeIcon tone={notice.tone} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{notice.title}</p>
          {notice.detail ? (
            <p className="mt-1 text-sm opacity-80">{notice.detail}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="rounded-md p-1 opacity-70 transition hover:bg-white/60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          onClick={onDismiss}
          aria-label="Dismiss status message"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
