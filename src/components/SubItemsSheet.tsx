import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Plus, Trash2, X } from 'lucide-react'
import type { FoodSubItem, SubItemOverrides } from '../types'
import { getSubItemTotals, isSubItemSelected } from '../types'
import { formatAmount, formatSubItemName } from '../utils'
import { useDialogDismiss } from '../useDialogDismiss'
import { useFocusTrap } from '../useFocusTrap'

interface SubItemsSheetProps {
  title: string
  subItems: FoodSubItem[]
  readOnly: boolean
  guestOverrides?: SubItemOverrides
  closing: boolean
  onClose: () => void
  onToggle: (subId: string) => void
  onSetQty: (subId: string, qty: number) => void
  onRemove: (subId: string) => void
}

export function SubItemsSheet({
  title,
  subItems,
  readOnly,
  guestOverrides,
  closing,
  onClose,
  onToggle,
  onSetQty,
  onRemove,
}: SubItemsSheetProps) {
  const backdropProps = useDialogDismiss(onClose)
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, true)

  return createPortal(
    <div className={`dialog-backdrop${closing ? ' is-closing' : ''}`} {...backdropProps}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sub-items-sheet-title"
        className={`dialog sub-items-sheet${closing ? ' is-closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <div className="dialog-title" id="sub-items-sheet-title">{title}</div>
          <button type="button" className="dialog-close" aria-label="關閉" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="sub-items-sheet-list">
          {subItems.map((sub) => {
            const selected = isSubItemSelected(sub, guestOverrides)
            const activeQty = selected ? (sub.qty ?? 1) : 0
            const totals = getSubItemTotals({ ...sub, qty: activeQty })
            const ingredients = sub.ingredients ?? []

            return (
              <div key={sub.id} className={`sub-items-sheet-row${selected ? '' : ' is-excluded'}`}>
                <div className="sub-items-sheet-row-top">
                  <span className="sub-items-sheet-row-name">{formatSubItemName(sub)}</span>
                  {readOnly ? (
                    <button
                      type="button"
                      className={`sub-item-detail-toggle${selected ? '' : ' is-excluded'}`}
                      onClick={() => onToggle(sub.id)}
                    >
                      {selected ? '已計入' : '已排除'}
                    </button>
                  ) : (
                    <div className="sub-items-sheet-row-controls">
                      <div className="sub-item-qty-stepper">
                        <button
                          type="button"
                          aria-label="減少數量"
                          disabled={activeQty <= 0}
                          onClick={() => onSetQty(sub.id, Math.max(0, activeQty - 1))}
                        >
                          <Minus size={13} />
                        </button>
                        <span className="sub-item-qty-stepper-value">{formatAmount(activeQty)}</span>
                        <button
                          type="button"
                          aria-label="增加數量"
                          onClick={() => onSetQty(sub.id, activeQty + 1)}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      <button
                        type="button"
                        className="sub-items-sheet-row-remove"
                        aria-label="刪除子項目"
                        onClick={() => onRemove(sub.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>

                {ingredients.length > 0 && (
                  <div className="sub-items-sheet-ingredients">
                    {ingredients.map((ing) => (
                      <div className="sub-item-detail-ingredient-row" key={ing.id}>
                        <span>{ing.name}</span>
                        <span>
                          {formatAmount(ing.weight)}g・{formatAmount(ing.calories)}kcal・{formatAmount(ing.protein)}g
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="sub-items-sheet-row-stats">
                  {formatAmount(totals.calories)} kcal・{formatAmount(totals.protein)} g 蛋白・{formatAmount(totals.weight)} g
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
