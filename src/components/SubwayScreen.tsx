import { useRef } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '../useFocusTrap'
import { useDialogDismiss } from '../useDialogDismiss'

export const SUBWAY_CALCULATOR_URL = 'https://tylin496.github.io/subway-calculator/'

interface SubwayScreenProps {
  // Stays mounted (and its iframe alive) even while hidden, so it can be
  // preloaded ahead of the first tap and keeps its state between visits.
  visible: boolean
  closing: boolean
  // Backing out — ✕, Esc, backdrop — leaves the card untouched. Only onConfirm
  // folds the calculator's build back onto it.
  onCancel: () => void
  onConfirm: () => void
}

export function SubwayScreen({ visible, closing, onCancel, onConfirm }: SubwayScreenProps) {
  // `active: visible` — this component stays mounted while hidden, so
  // useDialogDismiss must push/pop on show/hide rather than mount/unmount to
  // correctly arbitrate topmost-dialog Esc against the other dialogs.
  const backdropProps = useDialogDismiss(onCancel, visible)
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, visible)

  const stateClass = closing ? 'is-closing' : visible ? 'is-open' : 'is-hidden'

  return (
    <div className={`dialog-backdrop subway-backdrop ${stateClass}`} {...backdropProps}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Subway 計算機"
        className={`dialog subway-dialog ${stateClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="subway-close" aria-label="取消，不套用" onClick={onCancel}>
          <X size={20} />
        </button>
        <iframe src={SUBWAY_CALCULATOR_URL} title="Subway Calculator" className="subway-iframe" />
        <div className="subway-dialog-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            確定
          </button>
        </div>
      </div>
    </div>
  )
}
