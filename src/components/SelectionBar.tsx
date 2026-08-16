import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, X } from 'lucide-react'
import { useCountUp } from '../useCountUp'

interface SelectionBarProps {
  count: number
  totalProtein: number
  totalCalories: number
  // The selected item's own portions, when a single item is selected and its
  // qty is meaningful here (see App.tsx) — null hides the ×N stepper.
  qty: number | null
  onSetQty: (qty: number) => void
  onClear: () => void
  onCopy: () => void
}

export function SelectionBar({
  count,
  totalProtein,
  totalCalories,
  qty,
  onSetQty,
  onClear,
  onCopy,
}: SelectionBarProps) {
  const [copied, setCopied] = useState(false)
  const visible = count > 0
  const [rendered, setRendered] = useState(visible)
  // Clearing the selection nulls out qty an animation-frame before the bar
  // finishes leaving, which would pop the stepper away mid-fade — keep showing
  // the last real value for as long as the bar is on its way out.
  const [lastQty, setLastQty] = useState(qty)

  const displayProtein = useCountUp(totalProtein)
  const displayCalories = useCountUp(totalCalories)

  useEffect(() => {
    if (qty !== null) setLastQty(qty)
  }, [qty])

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

  const shownQty = visible ? qty : lastQty

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
      {shownQty !== null && (
        <div className="qty-stepper">
          <div className="qty-stepper-value">×{shownQty}</div>
          <div className="qty-arrows">
            <button type="button" aria-label="增加份數" onClick={() => onSetQty(shownQty + 1)}>
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              aria-label="減少份數"
              disabled={shownQty <= 1}
              onClick={() => onSetQty(Math.max(1, shownQty - 1))}
            >
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      )}
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
