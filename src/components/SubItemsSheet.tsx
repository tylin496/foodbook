import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Plus, X } from 'lucide-react'
import type { FoodSubItem, IngredientOverrides, SubItemOverrides } from '../types'
import { getEffectiveSubItemQty, getSubItemTotals, isIngredientSelected } from '../types'
import { formatAmount, formatSubItemName } from '../utils'
import { useDialogDismiss } from '../useDialogDismiss'
import { useFocusTrap } from '../useFocusTrap'

interface SubItemsSheetProps {
  title: string
  subItems: FoodSubItem[]
  guestOverrides?: SubItemOverrides
  guestIngredientOverrides?: IngredientOverrides
  closing: boolean
  onClose: () => void
  onSetQty: (subId: string, qty: number) => void
  onToggleIngredient: (subId: string, ingredientId: string) => void
}

export function SubItemsSheet({
  title,
  subItems,
  guestOverrides,
  guestIngredientOverrides,
  closing,
  onClose,
  onSetQty,
  onToggleIngredient,
}: SubItemsSheetProps) {
  const backdropProps = useDialogDismiss(onClose)
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, true)

  const rows = subItems.map((sub) => ({ sub, activeQty: getEffectiveSubItemQty(sub, guestOverrides) }))
  const sortedRows = [...rows].sort((a, b) => Number(b.activeQty > 0) - Number(a.activeQty > 0))

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
          {sortedRows.map(({ sub, activeQty }) => {
            const selected = activeQty > 0
            const totals = getSubItemTotals(sub, activeQty, guestIngredientOverrides)
            const ingredients = sub.ingredients ?? []

            return (
              <div key={sub.id} className={`sub-items-sheet-row${selected ? '' : ' is-excluded'}`}>
                <div className="sub-items-sheet-row-top">
                  <button
                    type="button"
                    className="sub-items-sheet-row-name"
                    onClick={() => onSetQty(sub.id, activeQty > 0 ? 0 : 1)}
                  >
                    {formatSubItemName(sub)}
                  </button>
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
                </div>

                {ingredients.length > 0 && (
                  <div className="sub-items-sheet-ingredients">
                    {ingredients.map((ing) => {
                      const ingSelected = isIngredientSelected(ing, guestIngredientOverrides)
                      return (
                        <button
                          type="button"
                          key={ing.id}
                          className={`sub-item-detail-ingredient-row${ingSelected ? '' : ' is-excluded'}`}
                          onClick={() => onToggleIngredient(sub.id, ing.id)}
                        >
                          <span>{ing.name}</span>
                          <span>
                            {formatAmount(ing.weight)}g {formatAmount(ing.calories)}kcal {formatAmount(ing.protein)}g
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}

                <div className="sub-items-sheet-row-stats">
                  {formatAmount(totals.calories)}kcal/{formatAmount(totals.protein)}g
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
