import { X } from 'lucide-react'
import type { Toast } from '../useToasts'

interface ToastsProps {
  toasts: Toast[]
  // Rides above the selection bar when one is up, so neither covers the other.
  raised: boolean
  onDismiss: (id: number) => void
}

export function Toasts({ toasts, raised, onDismiss }: ToastsProps) {
  if (toasts.length === 0) return null
  return (
    <div className={`toast-stack${raised ? ' is-raised' : ''}`} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <span className="toast-message">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.onClick()
                onDismiss(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            aria-label="關閉提示"
            onClick={() => onDismiss(toast.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
