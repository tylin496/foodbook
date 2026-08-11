import { useCallback, useRef, useState } from 'react'

export interface ConfirmOptions {
  description?: string
  confirmLabel?: string
  cancelLabel?: string
}

interface ConfirmRequest extends ConfirmOptions {
  message: string
  resolve: (value: boolean) => void
}

const CLOSE_MS = 180

// A styled, promise-based stand-in for window.confirm() — matches the rest of
// the app's dialog language (glass surface, dark mode, Esc/backdrop dismiss,
// focus trap) instead of dropping an unstyled OS box on top of it.
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef<number | null>(null)

  const settle = useCallback((value: boolean) => {
    setRequest((current) => {
      current?.resolve(value)
      return current
    })
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setClosing(false)
      setRequest(null)
    }, CLOSE_MS)
  }, [])

  const confirm = useCallback((message: string, options?: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setRequest({ message, ...options, resolve })
    })
  }, [])

  const confirmDialogProps = request && {
    message: request.message,
    description: request.description,
    confirmLabel: request.confirmLabel,
    cancelLabel: request.cancelLabel,
    closing,
    onConfirm: () => settle(true),
    onCancel: () => settle(false),
  }

  return { confirm, confirmDialogProps }
}
