import { Send } from 'lucide-react'

interface PublishPanelProps {
  disabled: boolean
  publishing: boolean
  onPublish: () => void
}

export function PublishPanel({
  disabled,
  publishing,
  onPublish,
}: PublishPanelProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-100 px-2.5 py-1.5 text-sm font-semibold text-sky-900 shadow-sm transition hover:border-sky-400 hover:bg-sky-200 disabled:opacity-50"
        disabled={disabled || publishing}
        onClick={onPublish}
      >
        <Send className="size-3.5" />
        {publishing ? 'Publishing...' : 'Publish'}
      </button>
    </section>
  )
}

