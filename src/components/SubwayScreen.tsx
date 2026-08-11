import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '../useFocusTrap'

export const SUBWAY_CALCULATOR_URL = 'https://tylin496.github.io/subway-calculator/'

interface SubwayScreenProps {
  // Stays mounted (and its iframe alive) even while hidden, so it can be
  // preloaded ahead of the first tap and keeps its state between visits.
  visible: boolean
  closing: boolean
  onClose: () => void
}

export function SubwayScreen({ visible, closing, onClose }: SubwayScreenProps) {
  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose])

  // Only a press that both starts and ends on the backdrop itself dismisses —
  // this component stays mounted while hidden, so a raw onClick without this
  // check would need the same "did the drag start here" guard the other
  // dialogs get for free from useDialogDismiss.
  const pressStartedOnBackdrop = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, visible)

  const stateClass = closing ? 'is-closing' : visible ? 'is-open' : 'is-hidden'

  return (
    <div
      className={`dialog-backdrop subway-backdrop ${stateClass}`}
      onPointerDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (!pressStartedOnBackdrop.current || e.target !== e.currentTarget) return
        onClose()
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="subway-dialog-title"
        className={`dialog subway-dialog ${stateClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <div className="dialog-title" id="subway-dialog-title">Subway 計算機</div>
          <button type="button" className="dialog-close" aria-label="關閉" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <iframe src={SUBWAY_CALCULATOR_URL} title="Subway Calculator" className="subway-iframe" />
      </div>
    </div>
  )
}
