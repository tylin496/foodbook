import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { FoodSubItem, SubItemOverrides } from '../types'
import { getSubItemTotals, isSubItemSelected } from '../types'
import { formatAmount, formatSubItemName } from '../utils'
import { useDialogDismiss } from '../useDialogDismiss'

interface SubItemDetailSheetProps {
  sub: FoodSubItem
  readOnly: boolean
  guestOverrides?: SubItemOverrides
  closing: boolean
  onClose: () => void
  onToggle: () => void
  onSetQty: (qty: number) => void
}

export function SubItemDetailSheet({
  sub,
  readOnly,
  guestOverrides,
  closing,
  onClose,
  onToggle,
  onSetQty,
}: SubItemDetailSheetProps) {
  const backdropProps = useDialogDismiss(onClose)
  const selected = isSubItemSelected(sub, guestOverrides)
  const maxQty = Math.max(1, Math.floor(sub.qty ?? 1))
  const activeQty = selected ? Math.floor(sub.qty ?? 1) : 0
  const totals = getSubItemTotals({ ...sub, qty: activeQty })
  const ingredients = sub.ingredients ?? []

  return createPortal(
    <div className={`dialog-backdrop${closing ? ' is-closing' : ''}`} {...backdropProps}>
      <div className={`dialog sub-item-detail${closing ? ' is-closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <div className="dialog-title">{formatSubItemName(sub)}</div>
          <button type="button" className="dialog-close" aria-label="關閉" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="sub-item-detail-stats">
          <div className="sub-item-detail-stat">
            <div className="sub-item-detail-stat-value">{formatAmount(totals.calories)}</div>
            <div className="sub-item-detail-stat-label">KCAL</div>
          </div>
          <div className="sub-item-detail-stat">
            <div className="sub-item-detail-stat-value is-protein">{formatAmount(totals.protein)}</div>
            <div className="sub-item-detail-stat-label">蛋白 G</div>
          </div>
          <div className="sub-item-detail-stat">
            <div className="sub-item-detail-stat-value">{formatAmount(totals.weight)}</div>
            <div className="sub-item-detail-stat-label">克重</div>
          </div>
        </div>

        {ingredients.length > 0 && (
          <div className="sub-item-detail-ingredients">
            <div className="sub-item-detail-ingredients-title">成分</div>
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

        {readOnly ? (
          <button
            type="button"
            className={`sub-item-detail-toggle${selected ? '' : ' is-excluded'}`}
            onClick={onToggle}
          >
            {selected ? '已計入加總・點擊排除' : '已排除・點擊計入'}
          </button>
        ) : (
          <div className="sub-item-detail-qty">
            <span className="sub-item-detail-qty-label">份數</span>
            <div className="sub-item-qty-buttons">
              {Array.from({ length: maxQty + 1 }, (_, n) => n).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`sub-item-qty-menu-btn${activeQty === n ? ' is-active' : ''}`}
                  onClick={() => onSetQty(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
