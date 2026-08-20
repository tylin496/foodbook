import { useEffect, useState } from 'react'
import { Check, Copy, Minus, Plus, X } from 'lucide-react'
import { useCountUp } from '../useCountUp'

interface SelectionBarProps {
  count: number
  // The last-tapped item's name — the bar names what the stepper acts on, so a
  // multi-selection reads as "this item, ＋N others" rather than a bare count.
  itemName: string
  totalProtein: number
  totalCalories: number
  // That same item's own portions (see App.tsx) — null hides the stepper.
  qty: number | null
  onSetQty: (qty: number) => void
  onClear: () => void
  onCopy: () => void
}

export function SelectionBar({
  count,
  itemName,
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
  // Clearing the selection empties count, name and qty an animation-frame
  // before the bar finishes leaving, which would blank the label and pop the
  // stepper away mid-fade — keep the last real selection on screen until the
  // bar is gone.
  const [last, setLast] = useState({ count, itemName, qty })

  const displayProtein = useCountUp(totalProtein)
  const displayCalories = useCountUp(totalCalories)

  useEffect(() => {
    if (!visible) return
    setLast((prev) => ({ count, itemName, qty: qty ?? prev.qty }))
  }, [visible, count, itemName, qty])

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
    // The tick is feedback for the tap, not for the clipboard call — so it is
    // set first and unconditionally. Ordered the other way, an origin without
    // navigator.clipboard (see copyText) threw on the way out of onCopy and
    // took the whole ✓/pop with it, which read as the animation disappearing.
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    onCopy()
  }

  const shown = visible ? { count, itemName, qty: qty ?? last.qty } : last
  const shownQty = shown.qty
  const others = shown.count - 1

  return (
    <div className={`selection-bar${visible ? '' : ' is-leaving'}`}>
      <div className="selection-bar-name">
        <span className="selection-bar-item">{shown.itemName}</span>
        {others > 0 && <span className="selection-bar-more">＋{others} 項</span>}
      </div>
      <div className="selection-bar-rule" />
      <div className="selection-bar-totals">
        <div className="selection-bar-total">
          <span className="value">{Math.round(displayCalories)}</span>
          <span className="unit">kcal</span>
        </div>
        <div className="selection-bar-total">
          <span className="value">{Math.round(displayProtein)}</span>
          <span className="unit">蛋白 g</span>
        </div>
      </div>
      {shownQty !== null && (
        <div className="selection-bar-stepper">
          <button
            type="button"
            aria-label="減少份數"
            disabled={shownQty <= 1}
            onClick={() => onSetQty(Math.max(1, shownQty - 1))}
          >
            <Minus size={16} strokeWidth={2.2} />
          </button>
          {/* No ×: flanked by − and +, the number can only be a portion count. */}
          <div className="selection-bar-qty">{shownQty}</div>
          <button type="button" aria-label="增加份數" onClick={() => onSetQty(shownQty + 1)}>
            <Plus size={16} strokeWidth={2.2} />
          </button>
        </div>
      )}
      {/* Two rows below 430px: 清除 rides with what's selected on the top row,
          複製 with the totals it copies on the bottom one. */}
      <div className="selection-bar-divider" />
      <div className="selection-bar-actions">
        <button
          type="button"
          className={`selection-bar-btn selection-bar-copy${copied ? ' is-copied' : ''}`}
          onClick={handleCopy}
          aria-label={copied ? '已複製' : '複製成文字'}
        >
          {copied ? <Check size={16} strokeWidth={2.4} /> : <Copy size={16} />}
        </button>
        <button
          type="button"
          className="selection-bar-btn selection-bar-clear"
          onClick={onClear}
          aria-label="清除選取"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
