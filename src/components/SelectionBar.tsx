import { useEffect, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { useCountUp } from '../useCountUp'

interface SelectionBarProps {
  count: number
  totalProtein: number
  totalCalories: number
  onClear: () => void
  onCopy: () => void
}

export function SelectionBar({
  count,
  totalProtein,
  totalCalories,
  onClear,
  onCopy,
}: SelectionBarProps) {
  const [copied, setCopied] = useState(false)
  const visible = count > 0
  const [rendered, setRendered] = useState(visible)

  const displayProtein = useCountUp(totalProtein)
  const displayCalories = useCountUp(totalCalories)

  useEffect(() => {
    if (visible) {
      setRendered(true)
      return
    }
    if (!rendered) return
    const timer = setTimeout(() => setRendered(false), 200)
    return () => clearTimeout(timer)
  }, [visible, rendered])

  if (!rendered) return null

  const handleCopy = () => {
    onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`selection-bar${visible ? '' : ' is-leaving'}`}>
      <div className="selected-count">已選 {count} 項</div>
      <div className="stats">
        <div className="stat">
          <div className="value">{Math.round(displayCalories)}</div>
          <div className="label">kcal</div>
        </div>
        <div className="stat-rule" />
        <div className="stat">
          <div className="value">{Math.round(displayProtein)}</div>
          <div className="label">蛋白質 g</div>
        </div>
      </div>
      <div className="icon-actions">
        <button
          type="button"
          className={`icon-btn${copied ? ' is-copied' : ''}`}
          onClick={handleCopy}
          aria-label={copied ? '已複製' : '複製成文字'}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
        <button type="button" className="icon-btn" onClick={onClear} aria-label="清除選取">
          <X size={17} />
        </button>
      </div>
    </div>
  )
}
