import { useEffect } from 'react'
import { ChevronLeft } from 'lucide-react'

const SUBWAY_CALCULATOR_URL = 'https://tylin496.github.io/subway-calculator/'

interface SubwayScreenProps {
  closing: boolean
  onClose: () => void
}

export function SubwayScreen({ closing, onClose }: SubwayScreenProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className={`subway-screen${closing ? ' is-closing' : ''}`}>
      <button type="button" className="subway-back-btn" onClick={onClose} aria-label="返回 Foodbook">
        <ChevronLeft size={18} strokeWidth={2.6} />
        Foodbook
      </button>
      <iframe src={SUBWAY_CALCULATOR_URL} title="Subway Calculator" className="subway-iframe" />
    </div>
  )
}
