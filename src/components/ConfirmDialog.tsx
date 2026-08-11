import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDialogDismiss } from '../useDialogDismiss'
import { useFocusTrap } from '../useFocusTrap'

interface ConfirmDialogProps {
  message: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  closing: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  message,
  description,
  confirmLabel = '確定',
  cancelLabel = '取消',
  closing,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const backdropProps = useDialogDismiss(onCancel)
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, true)

  return createPortal(
    <div className={`dialog-backdrop${closing ? ' is-closing' : ''}`} {...backdropProps}>
      <div
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-message"
        className={`dialog confirm-dialog${closing ? ' is-closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title" id="confirm-dialog-message">
          {message}
        </div>
        {description && <div className="dialog-body">{description}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
