import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Calculator, Camera, Check, Pencil } from 'lucide-react'
import type { FoodItem, SubItemOverrides } from '../types'
import { getFoodTotals, isSubItemSelected } from '../types'
import { formatAmount, formatSubItemName } from '../utils'
import { SubItemsSheet } from './SubItemsSheet'

const DETAIL_CLOSE_MS = 180

const LONG_PRESS_MS = 450
const LONG_PRESS_MOVE_TOLERANCE = 10

interface FoodCardProps {
  item: FoodItem
  selected: boolean
  grayscale: boolean
  readOnly: boolean
  reorderEnabled: boolean
  dragging: boolean
  removing: boolean
  // Marks the one card whose tap opens an external calculator instead of
  // toggling selection, so it can carry a visual cue distinguishing it from
  // every other card.
  isCalculatorLink: boolean
  onToggle: (id: string) => void
  onEdit: (id: string) => void
  onToggleSubItem: (id: string, subId: string) => void
  onSetSubItemQty: (id: string, subId: string, qty: number) => void
  onRemoveSubItem: (id: string, subId: string) => void
  onDragHandlePointerDown: (id: string, e: React.PointerEvent) => void
  guestOverrides?: SubItemOverrides
}

export function FoodCard({
  item,
  selected,
  grayscale,
  readOnly,
  reorderEnabled,
  dragging,
  removing,
  isCalculatorLink,
  onToggle,
  onEdit,
  onToggleSubItem,
  onSetSubItemQty,
  onRemoveSubItem,
  onDragHandlePointerDown,
  guestOverrides,
}: FoodCardProps) {
  const totals = getFoodTotals(item, guestOverrides)
  const subItems = item.subItems ?? []
  // Without sub-items the weight itself labels the portion, so it becomes the
  // lone chip instead of being repeated in the meta row.
  const weightAsSubItem = subItems.length === 0 && item.weight > 0

  const longPressTimer = useRef<number | null>(null)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const longPressFired = useRef(false)
  // Set when a move-past-tolerance turns out to be a scroll attempt rather than
  // a long-press-drag, so the click that pointerup still synthesizes gets eaten
  // instead of toggling the card.
  const suppressClick = useRef(false)
  // touch-action: none (below) stops the browser from ever taking over the
  // gesture as a native scroll, so once we decide it's a scroll we have to
  // replay it by hand onto the page scroller.
  const scrolling = useRef(false)
  const scrollTarget = useRef<HTMLElement | null>(null)
  const lastPointerY = useRef(0)
  const lastMoveTime = useRef(0)
  const velocityY = useRef(0)
  const momentumFrame = useRef<number | null>(null)
  const lastPointerType = useRef<string>('mouse')
  const [holding, setHolding] = useState(false)

  // Sub-item chips: show as many as actually fit before collapsing the rest
  // into a "+N" chip, instead of always showing just the first one.
  const chipsRef = useRef<HTMLDivElement | null>(null)
  const chipMeasureRef = useRef<HTMLDivElement | null>(null)
  const [visibleChipCount, setVisibleChipCount] = useState(subItems.length)

  // Any chip (including "+N") opens the same sheet listing every sub-item on
  // the card — full stats, ingredients, and (owner only) a quantity picker —
  // instead of toggling that one chip inline.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetClosing, setSheetClosing] = useState(false)
  const sheetCloseTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (sheetCloseTimer.current !== null) window.clearTimeout(sheetCloseTimer.current)
    }
  }, [])

  const closeSheet = () => {
    if (sheetClosing) return
    setSheetClosing(true)
    sheetCloseTimer.current = window.setTimeout(() => {
      setSheetOpen(false)
      setSheetClosing(false)
    }, DETAIL_CLOSE_MS)
  }

  const handleChipClick = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    setSheetOpen(true)
  }

  useLayoutEffect(() => {
    if (subItems.length === 0) return
    const container = chipsRef.current
    const measure = chipMeasureRef.current
    if (!container || !measure) return

    const recompute = () => {
      const available = container.clientWidth
      const chipEls = Array.from(measure.querySelectorAll<HTMLElement>('[data-chip]'))
      const moreEl = measure.querySelector<HTMLElement>('[data-more]')
      const gap = 4
      let used = 0
      let count = 0
      for (let i = 0; i < chipEls.length; i++) {
        const nextUsed = used + (count > 0 ? gap : 0) + chipEls[i].offsetWidth
        const remainingAfter = chipEls.length - (i + 1)
        const reserve = remainingAfter > 0 && moreEl ? gap + moreEl.offsetWidth : 0
        if (i === 0 || nextUsed + reserve <= available) {
          used = nextUsed
          count = i + 1
        } else {
          break
        }
      }
      setVisibleChipCount(count)
    }

    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(container)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subItems.map((s) => `${s.name}:${s.qty ?? 1}`).join('|')])

  const stopMomentum = () => {
    if (momentumFrame.current !== null) {
      cancelAnimationFrame(momentumFrame.current)
      momentumFrame.current = null
    }
  }

  // Native touch scrolling is blocked on this element (touch-action: none, below),
  // so once we take a gesture over as a manual scroll we also have to fake the
  // momentum/glide a real scroll would have had, or it just stops dead on release.
  const startMomentum = (target: HTMLElement, initialVelocity: number) => {
    let velocity = initialVelocity
    let lastTs: number | null = null
    const step = (ts: number) => {
      const dt = lastTs === null ? 16 : ts - lastTs
      lastTs = ts
      target.scrollBy(0, -velocity * dt)
      velocity *= Math.pow(0.95, dt / 16)
      momentumFrame.current = Math.abs(velocity) > 0.02 ? requestAnimationFrame(step) : null
    }
    momentumFrame.current = requestAnimationFrame(step)
  }

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    pointerStart.current = null
    scrolling.current = false
    setHolding(false)
  }

  const handlePhotoPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    stopMomentum()
    lastPointerType.current = e.pointerType
    suppressClick.current = false
    if (!reorderEnabled) return
    // Capture so pointermove/pointerup keep targeting this card even if the
    // cursor leaves the viewport mid-drag — without this a fast release
    // outside the window never fires pointerup and the drag sticks.
    e.currentTarget.setPointerCapture(e.pointerId)
    pointerStart.current = { x: e.clientX, y: e.clientY }
    lastPointerY.current = e.clientY
    setHolding(true)
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null
      longPressFired.current = true
      setHolding(false)
      onDragHandlePointerDown(item.id, e)
    }, LONG_PRESS_MS)
  }

  const handlePhotoPointerMove = (e: React.PointerEvent) => {
    if (scrolling.current) {
      const now = performance.now()
      const dt = Math.max(1, now - lastMoveTime.current)
      const dy = lastPointerY.current - e.clientY
      scrollTarget.current?.scrollBy(0, dy)
      velocityY.current = -dy / dt
      lastPointerY.current = e.clientY
      lastMoveTime.current = now
      return
    }
    if (!pointerStart.current) return
    const dx = e.clientX - pointerStart.current.x
    const dy = e.clientY - pointerStart.current.y
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) {
      clearLongPress()
      if (e.pointerType !== 'mouse') {
        suppressClick.current = true
        scrolling.current = true
        lastPointerY.current = e.clientY
        lastMoveTime.current = performance.now()
        velocityY.current = 0
        scrollTarget.current = (e.target as HTMLElement).closest<HTMLElement>('.page-scroll')
        scrollTarget.current?.scrollBy(0, -dy)
      }
    }
  }

  const handlePhotoPointerUp = () => {
    if (scrolling.current && scrollTarget.current) {
      startMomentum(scrollTarget.current, velocityY.current)
    }
    clearLongPress()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-food-id={item.id}
      className={`food-card${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${removing ? ' is-removing' : ''}`}
      onClick={() => {
        if (longPressFired.current) {
          longPressFired.current = false
          return
        }
        if (suppressClick.current) {
          suppressClick.current = false
          return
        }
        onToggle(item.id)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle(item.id)
        }
      }}
      aria-pressed={selected}
    >
      <div
        className={`photo${holding ? ' is-holding' : ''}`}
        style={reorderEnabled ? { touchAction: 'none' } : undefined}
        onPointerDown={handlePhotoPointerDown}
        onPointerMove={handlePhotoPointerMove}
        onPointerUp={handlePhotoPointerUp}
        onPointerCancel={clearLongPress}
        onPointerLeave={clearLongPress}
        onContextMenu={(e) => {
          // Only suppress the OS long-press menu (touch/pen) that would fight the
          // drag gesture; real right-clicks should still offer "Save image as…".
          if (reorderEnabled && lastPointerType.current !== 'mouse') e.preventDefault()
        }}
      >
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            className={grayscale ? '' : 'no-grayscale'}
            draggable={false}
          />
        ) : (
          <Camera size={26} strokeWidth={1.8} className="placeholder-icon" />
        )}
        {selected && (
          <div className="selected-badge">
            <Check size={13} strokeWidth={3} />
          </div>
        )}
        {!readOnly && (
          <div className="card-actions">
            <button
              type="button"
              aria-label="編輯"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(item.id)
              }}
            >
              <Pencil size={13} />
            </button>
          </div>
        )}
      </div>
      <div className="card-body">
        <div className="food-name-line">
          <div className="food-name">{item.name}</div>
          {isCalculatorLink && (
            <span className="calculator-badge" title="點擊開啟計算機">
              <Calculator size={11} strokeWidth={2.3} />
              計算機
            </span>
          )}
        </div>
        {weightAsSubItem && (
          <div className="sub-items-summary">
            <span className="sub-item-chip">{formatAmount(item.weight)} g</span>
          </div>
        )}
        {subItems.length > 0 && (
          <div className="sub-items-summary" ref={chipsRef} style={{ position: 'relative' }}>
            {subItems.slice(0, visibleChipCount).map((sub) => (
              <span
                key={sub.id}
                className={`sub-item-chip${isSubItemSelected(sub, guestOverrides) ? '' : ' is-excluded'} is-toggleable`}
                onClick={handleChipClick}
              >
                {formatSubItemName(sub)}
              </span>
            ))}
            {subItems.length > visibleChipCount && (
              <span className="sub-item-chip is-more" onClick={handleChipClick}>
                +{subItems.length - visibleChipCount}
              </span>
            )}
            <div
              ref={chipMeasureRef}
              aria-hidden="true"
              style={{
                position: 'absolute',
                visibility: 'hidden',
                height: 0,
                overflow: 'hidden',
                display: 'flex',
                gap: 4,
                top: 0,
                left: 0,
                pointerEvents: 'none',
              }}
            >
              {subItems.map((sub) => (
                <span
                  key={sub.id}
                  data-chip
                  className={`sub-item-chip${isSubItemSelected(sub, guestOverrides) ? '' : ' is-excluded'}`}
                  style={{ flex: 'none' }}
                >
                  {formatSubItemName(sub)}
                </span>
              ))}
              <span data-more className="sub-item-chip is-more" style={{ flex: 'none' }}>
                +{subItems.length}
              </span>
            </div>
          </div>
        )}
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-value">{formatAmount(totals.calories)}</div>
            <div className="stat-label">KCAL</div>
          </div>
          <div className="stat-rule" />
          <div className="stat">
            <div className="stat-value is-protein">{formatAmount(totals.protein)}</div>
            <div className="stat-label">蛋白 G</div>
          </div>
        </div>
      </div>
      {sheetOpen && (
        <SubItemsSheet
          title={item.name}
          subItems={subItems}
          readOnly={readOnly}
          guestOverrides={guestOverrides}
          closing={sheetClosing}
          onClose={closeSheet}
          onToggle={(subId) => onToggleSubItem(item.id, subId)}
          onSetQty={(subId, qty) => onSetSubItemQty(item.id, subId, qty)}
          onRemove={(subId) => onRemoveSubItem(item.id, subId)}
        />
      )}
    </div>
  )
}
