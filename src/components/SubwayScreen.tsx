import { useEffect } from 'react'
import { ChevronLeft } from 'lucide-react'

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

  const stateClass = closing ? 'is-closing' : visible ? 'is-open' : 'is-hidden'

  return (
    <div className={`subway-screen ${stateClass}`}>
      <button type="button" className="subway-back-btn" onClick={onClose} aria-label="返回 Foodbook">
        <ChevronLeft size={18} strokeWidth={2.6} />
        Foodbook
      </button>
      <iframe src={SUBWAY_CALCULATOR_URL} title="Subway Calculator" className="subway-iframe" />
    </div>
  )
}
