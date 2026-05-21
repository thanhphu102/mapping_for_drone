import { useCallback, useState } from 'react'

export type EditorNoticeTone = 'success' | 'error' | 'info'

export interface EditorNoticeState {
  tone: EditorNoticeTone
  text: string
}

export function useEditorNotices(initialMessage = '') {
  const [notice, setNotice] = useState<EditorNoticeState | null>(
    initialMessage ? { tone: 'info', text: initialMessage } : null,
  )

  const setMessage = useCallback((text: string, tone: EditorNoticeTone = 'info') => {
    setNotice({ tone, text })
  }, [])

  const showSuccess = useCallback((text: string) => {
    setNotice({ tone: 'success', text })
  }, [])

  const showError = useCallback((text: string) => {
    setNotice({ tone: 'error', text })
  }, [])

  const clearNotice = useCallback(() => {
    setNotice(null)
  }, [])

  return {
    notice,
    message: notice?.text ?? '',
    setMessage,
    showSuccess,
    showError,
    clearNotice,
  }
}

