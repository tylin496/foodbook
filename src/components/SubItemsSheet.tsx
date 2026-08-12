import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, GripVertical, Minus, Plus, X } from 'lucide-react'
import type { FoodSubItem, IngredientOverrides, SubItemOverrides } from '../types'
import { getEffectiveIngredientQty, getEffectiveSubItemQty, getSubItemTotals } from '../types'
import { formatAmount, formatSubItemName } from '../utils'
import { useDialogDismiss } from '../useDialogDismiss'
import { useFocusTrap } from '../useFocusTrap'

interface SubItemsSheetProps {
  title: string
  subItems: FoodSubItem[]
  // The food item's overall totals (base + every sub-item/ingredient),
  // already computed by the caller via getFoodTotals — the sheet's footer
  // just displays it, it doesn't re-derive it.
  totals: { calories: number; protein: number }
  // The item's own portions (e.g. ordering 2x steak), shown as a stepper next
  // to the title — separate from any sub-item's qty.
  baseQty: number
  guestOverrides?: SubItemOverrides
  guestIngredientOverrides?: IngredientOverrides
  closing: boolean
  onClose: () => void
  onSetQty: (subId: string, qty: number) => void
  onSetIngredientQty: (subId: string, ingredientId: string, qty: number) => void
  onSetBaseQty: (qty: number) => void
  onSelectAll: () => void
  onClearAll: () => void
  // Reordering rewrites the shared item record, so only the owner gets this —
  // omit it for guests and the drag handle just doesn't render.
  onReorderIngredients?: (subId: string, orderedIngredientIds: string[]) => void
}

export function SubItemsSheet({
  title,
  subItems,
  totals,
  baseQty,
  guestOverrides,
  guestIngredientOverrides,
  closing,
  onClose,
  onSetQty,
  onSetIngredientQty,
  onSetBaseQty,
  onSelectAll,
  onClearAll,
  onReorderIngredients,
}: SubItemsSheetProps) {
  const backdropProps = useDialogDismiss(onClose)
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, true)

  const rows = subItems.map((sub) => ({ sub, activeQty: getEffectiveSubItemQty(sub, guestOverrides) }))
  const selectedCount = rows.filter(({ activeQty }) => activeQty > 0).length
  const sortedRows = [...rows].sort((a, b) => Number(b.activeQty > 0) - Number(a.activeQty > 0))

  // Selected ingredients float to the top, same as sortedRows above; a manual
  // drag (see handleIngredientGripMove) reorders within that grouping by
  // persisting the new full id order back to sub.ingredients.
  const getSortedIngredients = (sub: FoodSubItem) =>
    [...(sub.ingredients ?? [])].sort(
      (a, b) =>
        Number(getEffectiveIngredientQty(b, guestIngredientOverrides) > 0) -
        Number(getEffectiveIngredientQty(a, guestIngredientOverrides) > 0),
    )

  // Mirrors the sub-item drag system in FoodModal: the grabbed row follows
  // the pointer with a spring lag, siblings FLIP-animate as the order changes
  // live, scoped to one sub-item's own ingredient list at a time.
  const ingredientContainersRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const ingredientDragMetaRef = useRef<{ subId: string; id: string; grabOffsetY: number } | null>(null)
  const lastIngredientPointerYRef = useRef(0)
  const ingredientSpringOffsetRef = useRef<number | null>(null)
  const ingredientDragRafRef = useRef<number | null>(null)
  const prevIngredientRectsRef = useRef<{ subId: string; rects: Record<string, DOMRect> } | null>(null)
  const [draggingIngredientId, setDraggingIngredientId] = useState<string | null>(null)

  const findIngredientRowEl = (subId: string, id: string): HTMLElement | null =>
    ingredientContainersRef.current.get(subId)?.querySelector<HTMLElement>(`[data-ingredient-id="${CSS.escape(id)}"]`) ??
    null

  const captureIngredientRects = (subId: string, excludeId?: string) => {
    const container = ingredientContainersRef.current.get(subId)
    if (!container) return
    const rects: Record<string, DOMRect> = {}
    container.querySelectorAll<HTMLElement>('[data-ingredient-id]').forEach((el) => {
      const id = el.dataset.ingredientId
      if (id && id !== excludeId) rects[id] = el.getBoundingClientRect()
    })
    prevIngredientRectsRef.current = { subId, rects }
  }

  const computeIngredientDragOffsetY = (el: HTMLElement, clientY: number) => {
    const meta = ingredientDragMetaRef.current
    if (!meta) return 0
    const saved = el.style.transform
    el.style.transform = ''
    const rect = el.getBoundingClientRect()
    el.style.transform = saved
    return clientY - meta.grabOffsetY - rect.top
  }

  const applyIngredientDragTransform = (el: HTMLElement, y: number) => {
    el.style.transform = `translateY(${y}px) scale(1.02)`
  }

  const INGREDIENT_SPRING_FACTOR = 0.35

  const stopIngredientSpringLoop = () => {
    if (ingredientDragRafRef.current !== null) {
      cancelAnimationFrame(ingredientDragRafRef.current)
      ingredientDragRafRef.current = null
    }
    ingredientSpringOffsetRef.current = null
  }

  const startIngredientSpringLoop = (subId: string, id: string) => {
    const step = () => {
      const meta = ingredientDragMetaRef.current
      const el = meta && meta.subId === subId && meta.id === id ? findIngredientRowEl(subId, id) : null
      const current = ingredientSpringOffsetRef.current
      if (!meta || !el || current === null) {
        ingredientDragRafRef.current = null
        return
      }
      const target = computeIngredientDragOffsetY(el, lastIngredientPointerYRef.current)
      const next = current + (target - current) * INGREDIENT_SPRING_FACTOR
      ingredientSpringOffsetRef.current = next
      applyIngredientDragTransform(el, next)
      ingredientDragRafRef.current = requestAnimationFrame(step)
    }
    ingredientDragRafRef.current = requestAnimationFrame(step)
  }

  useLayoutEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const pending = prevIngredientRectsRef.current
    if (!pending) return
    prevIngredientRectsRef.current = null
    const { subId, rects } = pending
    const dragId = ingredientDragMetaRef.current?.id
    if (reducedMotion) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        Object.keys(rects).forEach((id) => {
          if (id === dragId) return
          const el = findIngredientRowEl(subId, id)
          if (!el) return
          const prev = rects[id]
          const now = el.getBoundingClientRect()
          const dy = prev.top - now.top
          if (Math.abs(dy) < 0.5) return
          el.style.transition = 'none'
          el.style.transform = `translateY(${dy}px)`
          requestAnimationFrame(() => {
            el.style.transition = 'transform var(--motion-flip-bold)'
            el.style.transform = ''
            const handleEnd = () => {
              el.style.transition = ''
              el.removeEventListener('transitionend', handleEnd)
            }
            el.addEventListener('transitionend', handleEnd)
          })
        })
      })
    })
  })

  const handleIngredientGripDown = (e: React.PointerEvent<HTMLButtonElement>, subId: string, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    const el = findIngredientRowEl(subId, id)
    if (!el) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = el.getBoundingClientRect()
    ingredientDragMetaRef.current = { subId, id, grabOffsetY: e.clientY - rect.top }
    lastIngredientPointerYRef.current = e.clientY
    el.style.transition = 'transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 140ms ease'
    el.style.zIndex = '2'
    el.style.boxShadow = 'var(--shadow-lg)'
    const startOffset = computeIngredientDragOffsetY(el, e.clientY)
    applyIngredientDragTransform(el, startOffset)
    setDraggingIngredientId(id)
    window.setTimeout(() => {
      if (ingredientDragMetaRef.current?.subId !== subId || ingredientDragMetaRef.current?.id !== id) return
      el.style.transition = 'none'
      ingredientSpringOffsetRef.current = startOffset
      startIngredientSpringLoop(subId, id)
    }, 140)
  }

  const handleIngredientGripMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const dragging = ingredientDragMetaRef.current
    const container = dragging ? ingredientContainersRef.current.get(dragging.subId) : null
    if (!dragging || !container) return
    lastIngredientPointerYRef.current = e.clientY
    const sub = subItems.find((s) => s.id === dragging.subId)
    if (!sub) return
    const currentOrder = getSortedIngredients(sub)
    const draggedIndex = currentOrder.findIndex((ing) => ing.id === dragging.id)
    if (draggedIndex === -1) return
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-ingredient-id]'))
    for (let i = 0; i < rows.length; i++) {
      if (i === draggedIndex) continue
      const rect = rows[i].getBoundingClientRect()
      const mid = rect.top + rect.height / 2
      const crossed = (i < draggedIndex && e.clientY < mid) || (i > draggedIndex && e.clientY > mid)
      if (crossed) {
        captureIngredientRects(dragging.subId, dragging.id)
        const next = [...currentOrder]
        const [moved] = next.splice(draggedIndex, 1)
        next.splice(i, 0, moved)
        onReorderIngredients?.(
          dragging.subId,
          next.map((ing) => ing.id),
        )
        break
      }
    }
  }

  const handleIngredientGripUp = () => {
    const meta = ingredientDragMetaRef.current
    stopIngredientSpringLoop()
    if (meta) {
      const el = findIngredientRowEl(meta.subId, meta.id)
      if (el) {
        el.style.transition = 'transform var(--motion-flip-bold), box-shadow 200ms ease'
        el.style.transform = ''
        window.setTimeout(() => {
          el.style.boxShadow = ''
          el.style.zIndex = ''
          el.style.transition = ''
        }, 340)
      }
    }
    ingredientDragMetaRef.current = null
    setDraggingIngredientId(null)
  }

  useEffect(() => {
    return () => stopIngredientSpringLoop()
  }, [])

  return createPortal(
    <div className={`dialog-backdrop sub-items-sheet-backdrop${closing ? ' is-closing' : ''}`} {...backdropProps}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sub-items-sheet-title"
        className={`dialog sub-items-sheet${closing ? ' is-closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sub-items-sheet-handle" />
        <div className="dialog-header">
          <div>
            <div className="dialog-title" id="sub-items-sheet-title">{title}</div>
            <div className="sub-items-sheet-header-sub">已選 {selectedCount} 項</div>
          </div>
          <div className="sub-items-sheet-header-actions">
            <div className="sub-item-qty-stepper">
              <button
                type="button"
                aria-label="減少份數"
                disabled={baseQty <= 1}
                onClick={() => onSetBaseQty(Math.max(1, baseQty - 1))}
              >
                <Minus size={13} />
              </button>
              <span className="sub-item-qty-stepper-value">{formatAmount(baseQty)}</span>
              <button type="button" aria-label="增加份數" onClick={() => onSetBaseQty(baseQty + 1)}>
                <Plus size={13} />
              </button>
            </div>
            <button type="button" className="dialog-close" aria-label="關閉" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="sub-items-sheet-quick-actions">
          <button type="button" className="sub-items-sheet-pill" onClick={onSelectAll}>全選</button>
          <button type="button" className="sub-items-sheet-pill" onClick={onClearAll}>清除</button>
        </div>

        <div className="sub-items-sheet-list">
          {sortedRows.map(({ sub, activeQty }) => {
            const selected = activeQty > 0
            const isLastSelected = selected && selectedCount <= 1
            // Show the stats a sub-item would contribute if selected, not
            // zeroed out just because it's currently excluded — activeQty is
            // 0 when unselected, which would otherwise blank the display.
            const subTotals = getSubItemTotals(sub, selected ? activeQty : (sub.qty ?? 1), guestIngredientOverrides)
            const ingredients = getSortedIngredients(sub)

            return (
              <div key={sub.id} className={`sub-items-sheet-row${selected ? '' : ' is-excluded'}`}>
                <div className="sub-items-sheet-row-top">
                  <button
                    type="button"
                    className="sub-items-sheet-checkbox"
                    aria-label={selected ? '取消計入加總' : '計入加總'}
                    disabled={isLastSelected}
                    onClick={() => onSetQty(sub.id, activeQty > 0 ? 0 : 1)}
                  >
                    {selected && <Check size={12} strokeWidth={3} />}
                  </button>
                  <span className="sub-items-sheet-row-name">{formatSubItemName(sub)}</span>
                  <div className="sub-item-qty-stepper">
                    <button
                      type="button"
                      aria-label="減少數量"
                      disabled={activeQty <= 0 || isLastSelected}
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
                  <div
                    className="sub-items-sheet-ingredients"
                    ref={(el) => {
                      if (el) ingredientContainersRef.current.set(sub.id, el)
                      else ingredientContainersRef.current.delete(sub.id)
                    }}
                  >
                    {ingredients.map((ing) => {
                      const ingQty = getEffectiveIngredientQty(ing, guestIngredientOverrides)
                      const ingSelected = ingQty > 0
                      return (
                        <div
                          key={ing.id}
                          data-ingredient-id={ing.id}
                          className={`sub-item-detail-ingredient-row${ingSelected ? '' : ' is-excluded'}${ing.id === draggingIngredientId ? ' is-dragging' : ''}`}
                        >
                          <div className="sub-item-detail-ingredient-top">
                            {onReorderIngredients && (
                              <button
                                type="button"
                                className="sub-item-detail-ingredient-grip"
                                aria-label="拖曳排序成分"
                                onPointerDown={(e) => handleIngredientGripDown(e, sub.id, ing.id)}
                                onPointerMove={handleIngredientGripMove}
                                onPointerUp={handleIngredientGripUp}
                                onPointerCancel={handleIngredientGripUp}
                              >
                                <GripVertical size={11} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="sub-item-detail-ingredient-checkbox"
                              aria-label={ingSelected ? '取消計入加總' : '計入加總'}
                              onClick={() => onSetIngredientQty(sub.id, ing.id, ingQty > 0 ? 0 : 1)}
                            >
                              {ingSelected && <Check size={9} strokeWidth={3} />}
                            </button>
                            <span className="sub-item-detail-ingredient-name">{formatSubItemName(ing)}</span>
                            {ingQty > 1 ? (
                              <div className="ingredient-qty-stepper">
                                <button
                                  type="button"
                                  aria-label="減少數量"
                                  onClick={() => onSetIngredientQty(sub.id, ing.id, Math.max(1, ingQty - 1))}
                                >
                                  <Minus size={11} />
                                </button>
                                <button
                                  type="button"
                                  aria-label="增加數量"
                                  onClick={() => onSetIngredientQty(sub.id, ing.id, ingQty + 1)}
                                >
                                  <Plus size={11} />
                                </button>
                              </div>
                            ) : (
                              ingSelected && (
                                <button
                                  type="button"
                                  className="ingredient-qty-add"
                                  aria-label="加一份"
                                  onClick={() => onSetIngredientQty(sub.id, ing.id, ingQty + 1)}
                                >
                                  <Plus size={11} />
                                </button>
                              )
                            )}
                          </div>
                          <div className="sub-item-detail-ingredient-stats">
                            {(() => {
                              const displayQty = ingSelected ? ingQty : (ing.qty ?? 1)
                              return (
                                <>
                                  {formatAmount(ing.weight * displayQty)}g {formatAmount(ing.calories * displayQty)}kcal{' '}
                                  {formatAmount(ing.protein * displayQty)}g
                                </>
                              )
                            })()}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="sub-items-sheet-row-stats">
                  {formatAmount(subTotals.calories)}kcal/{formatAmount(subTotals.protein)}g
                </div>
              </div>
            )
          })}
        </div>

        <div className="sub-items-sheet-footer">
          <div className="sub-items-sheet-footer-stats">
            <div>
              <div className="sub-items-sheet-footer-value is-calories">{formatAmount(totals.calories)}</div>
              <div className="sub-items-sheet-footer-label">KCAL</div>
            </div>
            <div>
              <div className="sub-items-sheet-footer-value is-protein">{formatAmount(totals.protein)}</div>
              <div className="sub-items-sheet-footer-label">蛋白 G</div>
            </div>
          </div>
          <button type="button" className="btn btn-primary sub-items-sheet-done" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
