import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, Plus, Search, X } from 'lucide-react'
import { useAuth } from './useAuth'
import { useTheme } from './useTheme'
import { useCloudItems } from './useCloudItems'
import { useGuestOverrides } from './useGuestOverrides'
import type { FoodDraft } from './types'
import { BASE_QTY_KEY, emptyDraft, getEffectiveBaseQty, getEffectiveSubItemQty, getFoodTotals } from './types'
import { FoodCard } from './components/FoodCard'
import { SelectionBar } from './components/SelectionBar'
import { FoodModal } from './components/FoodModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { SubwayScreen, SUBWAY_CALCULATOR_URL } from './components/SubwayScreen'
import { formatItemsAsText, generateId, roundAmount, sortBySelected, toNumber } from './utils'
import { useConfirm } from './useConfirm'
import { embedContext, postSelectionTotals } from './embed'

const GRAYSCALE_PHOTOS = false
const OWNER_UID = '277SEyYGZyUyapmKB5Fu4OC4dDR2'
// Launches the embedded calculator instead of toggling into the selection total.
const SUBWAY_ITEM_NAME = 'Subway'
const SUBWAY_CLOSE_MS = 220
// Trusted regardless of where Foodbook itself is served from (dev vs. prod) —
// the iframe always points at the live calculator at this fixed origin.
const SUBWAY_ORIGIN = new URL(SUBWAY_CALCULATOR_URL).origin

type SubwayResult = { hasSelection: boolean; mainName?: string; kcal?: number; protein?: number }
type SortMode = 'manual' | 'calories' | 'protein'
const SORT_MODE_KEY = 'food-diary:sort-mode'
const SORT_DIR_KEY = 'food-diary:sort-dir'

export default function App() {
  const { user, loading: authLoading, signIn, logOut, signInError } = useAuth()

  if (authLoading) return null

  const isOwner = user?.uid === OWNER_UID

  return (
    <FoodBook
      isOwner={isOwner}
      userLabel={user?.displayName ?? user?.email ?? ''}
      photoURL={user?.photoURL ?? null}
      onSignIn={signIn}
      onLogOut={logOut}
      signInError={signInError}
    />
  )
}

function FoodBook({
  isOwner,
  userLabel,
  photoURL,
  onSignIn,
  onLogOut,
  signInError,
}: {
  isOwner: boolean
  userLabel: string
  photoURL: string | null
  onSignIn: () => void
  onLogOut: () => void
  signInError: boolean
}) {
  const [items, setItems, itemsLoading] = useCloudItems(OWNER_UID)
  const {
    overrides: guestOverrides,
    ingredientOverrides: guestIngredientOverrides,
    setQty: setGuestSubItemQty,
    setIngredientQty: setGuestIngredientQty,
  } = useGuestOverrides()
  const { confirm, confirmDialogProps } = useConfirm()
  useTheme(embedContext?.theme ?? null)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<FoodDraft>(emptyDraft)

  // Stays true once set — the iframe keeps loading/running in the background
  // (hidden) so reopening never re-fetches, and any in-progress order survives
  // a close/reopen. Pre-warmed shortly after load so the first tap is instant too.
  const [subwayMounted, setSubwayMounted] = useState(false)
  const [subwayOpen, setSubwayOpen] = useState(false)
  const [subwayClosing, setSubwayClosing] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setSubwayMounted(true), 1500)
    return () => window.clearTimeout(timer)
  }, [])

  // The calculator posts its current build on every change; we just keep the
  // latest one and apply it when the user backs out, rather than writing to
  // Firestore on every tap inside the iframe.
  const subwayResultRef = useRef<SubwayResult | null>(null)

  // Guests can't write the Subway card's subItems to the shared record, so
  // their build lives here instead — folded into the card/totals below,
  // same as guestOverrides, but for a computed value rather than a toggle.
  const [guestSubwayItem, setGuestSubwayItem] = useState<{ name: string; protein: number; calories: number } | null>(
    null,
  )

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== SUBWAY_ORIGIN) return
      if (e.data?.source !== 'subway-calculator') return
      subwayResultRef.current = e.data as SubwayResult
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Folds the calculator's current build back onto the Subway card's chip and
  // totals — owners get it written to the shared record, guests just get it
  // added to their local running total (they can't write the shared record).
  const applySubwayResult = (result: SubwayResult) => {
    if (!result.hasSelection || !result.mainName) return
    const subwayItem = items.find((item) => item.name === SUBWAY_ITEM_NAME)
    if (!subwayItem) return
    if (isOwner) {
      const subId = subwayItem.subItems?.[0]?.id ?? generateId()
      setItems((prev) =>
        prev.map((item) =>
          item.id === subwayItem.id
            ? {
                ...item,
                subItems: [
                  {
                    id: subId,
                    name: result.mainName!,
                    weight: 0,
                    protein: result.protein ?? 0,
                    calories: result.kcal ?? 0,
                    selected: true,
                  },
                ],
              }
            : item,
        ),
      )
    } else {
      setGuestSubwayItem({ name: result.mainName!, protein: result.protein ?? 0, calories: result.kcal ?? 0 })
    }
    setSelectedIds((prev) => new Set(prev).add(subwayItem.id))
  }

  // Guest-only view of `items` with the Subway card's build swapped in —
  // never written back, so it disappears on reload like the rest of a
  // guest's local state.
  const displayItems = useMemo(() => {
    if (isOwner || !guestSubwayItem) return items
    return items.map((item) =>
      item.name === SUBWAY_ITEM_NAME
        ? {
            ...item,
            subItems: [
              {
                id: item.subItems?.[0]?.id ?? 'guest-subway',
                name: guestSubwayItem.name,
                weight: 0,
                protein: guestSubwayItem.protein,
                calories: guestSubwayItem.calories,
                selected: true,
              },
            ],
          }
        : item,
    )
  }, [items, isOwner, guestSubwayItem])

  const closeSubway = () => {
    if (subwayClosing) return
    if (subwayResultRef.current) applySubwayResult(subwayResultRef.current)
    setSubwayClosing(true)
    window.setTimeout(() => {
      setSubwayOpen(false)
      setSubwayClosing(false)
    }, SUBWAY_CLOSE_MS)
  }

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return displayItems
    return displayItems.filter((item) => {
      if (item.name.toLowerCase().includes(q)) return true
      return (item.subItems ?? []).some((sub) => {
        if (sub.name.toLowerCase().includes(q)) return true
        return (sub.ingredients ?? []).some((ing) => ing.name.toLowerCase().includes(q))
      })
    })
  }, [displayItems, search])

  const [sortMode, setSortMode] = useState<SortMode>(() => {
    try {
      const cached = localStorage.getItem(SORT_MODE_KEY)
      return cached === 'calories' || cached === 'protein' ? cached : 'manual'
    } catch {
      return 'manual'
    }
  })
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>(() => {
    try {
      return localStorage.getItem(SORT_DIR_KEY) === 'asc' ? 'asc' : 'desc'
    } catch {
      return 'desc'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(SORT_MODE_KEY, sortMode)
      localStorage.setItem(SORT_DIR_KEY, sortDir)
    } catch {
      // storage full or unavailable — sort choice just won't persist
    }
  }, [sortMode, sortDir])

  const handleSortPillClick = (mode: SortMode) => {
    if (mode === 'manual') {
      setSortMode('manual')
      return
    }
    if (sortMode === mode) {
      setSortDir((dir) => (dir === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortMode(mode)
      setSortDir('desc')
    }
  }

  // Manual is the stored/drag order as-is; the other modes rank by each
  // item's own totals (protein efficiency = protein per kcal, so a lean,
  // high-protein food ranks above a calorie-dense one). Clicking an already
  // active mode again flips sortDir to reverse the ranking.
  const sortedItems = useMemo(() => {
    if (sortMode === 'manual') return filteredItems
    const dirSign = sortDir === 'desc' ? 1 : -1
    const ranked = filteredItems.map((item) => ({ item, totals: getFoodTotals(item) }))
    ranked.sort((a, b) => {
      if (sortMode === 'calories') return (b.totals.calories - a.totals.calories) * dirSign
      const effA = a.totals.calories > 0 ? a.totals.protein / a.totals.calories : 0
      const effB = b.totals.calories > 0 ? b.totals.protein / b.totals.calories : 0
      return (effB - effA) * dirSign
    })
    return ranked.map(({ item }) => item)
  }, [filteredItems, sortMode, sortDir])

  const reorderEnabled = isOwner && search.trim().length === 0 && sortMode === 'manual'
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  const [modalClosing, setModalClosing] = useState(false)

  const foodGridRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const prevRectsRef = useRef<Record<string, DOMRect> | null>(null)
  // Set before any captureRects() that isn't the live drag-move path (sort
  // change, add/delete, search filter): those can reshuffle many cards at
  // once, each by a different 2D distance, unlike drag-reorder where usually
  // 1-2 cards shift. The bouncy drag-settle easing overshooting on every card
  // simultaneously reads as chaotic, so bulk reflows use a plain ease-out.
  const bulkFlipRef = useRef(false)
  const dragMetaRef = useRef<{ id: string; grabOffsetX: number; grabOffsetY: number } | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const springOffsetRef = useRef<{ x: number; y: number } | null>(null)
  const dragRafRef = useRef<number | null>(null)

  const findCardEl = useCallback((id: string): HTMLElement | null => {
    const grid = foodGridRef.current
    if (!grid) return null
    return grid.querySelector<HTMLElement>(`[data-food-id="${CSS.escape(id)}"]`)
  }, [])

  const captureRects = useCallback((excludeId?: string) => {
    const grid = foodGridRef.current
    if (!grid) return
    const rects: Record<string, DOMRect> = {}
    grid.querySelectorAll<HTMLElement>('[data-food-id]').forEach((el) => {
      const id = el.dataset.foodId
      if (id && id !== excludeId) rects[id] = el.getBoundingClientRect()
    })
    prevRectsRef.current = rects
  }, [])

  const computeDragOffset = useCallback((el: HTMLElement, clientX: number, clientY: number) => {
    const meta = dragMetaRef.current
    if (!meta) return null
    const saved = el.style.transform
    el.style.transform = ''
    const rect = el.getBoundingClientRect()
    el.style.transform = saved
    return { x: clientX - meta.grabOffsetX - rect.left, y: clientY - meta.grabOffsetY - rect.top }
  }, [])

  const applyDragTransform = (el: HTMLElement, x: number, y: number, rotate: number) => {
    el.style.transform = `translate(${x}px,${y}px) scale(1.06) rotate(${rotate}deg)`
  }

  const SPRING_FACTOR = 0.3

  const stopSpringLoop = useCallback(() => {
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = null
    }
    springOffsetRef.current = null
  }, [])

  const startSpringLoop = useCallback(
    (id: string) => {
      const step = () => {
        const meta = dragMetaRef.current
        const el = meta && meta.id === id ? findCardEl(id) : null
        const current = springOffsetRef.current
        if (!meta || !el || !current) {
          dragRafRef.current = null
          return
        }
        const target = computeDragOffset(el, lastPointerRef.current.x, lastPointerRef.current.y)
        if (target) {
          const nx = current.x + (target.x - current.x) * SPRING_FACTOR
          const ny = current.y + (target.y - current.y) * SPRING_FACTOR
          const rotate = Math.max(-8, Math.min(8, (nx - current.x) * 0.6))
          springOffsetRef.current = { x: nx, y: ny }
          applyDragTransform(el, nx, ny, rotate)
        }
        dragRafRef.current = requestAnimationFrame(step)
      }
      dragRafRef.current = requestAnimationFrame(step)
    },
    [computeDragOffset, findCardEl],
  )

  useLayoutEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prevRectsRef.current) {
      const rects = prevRectsRef.current
      prevRectsRef.current = null
      const dragId = dragMetaRef.current?.id
      const transition = bulkFlipRef.current
        ? 'transform 320ms var(--motion-entrance-bold)'
        : 'transform var(--motion-flip-bold)'
      bulkFlipRef.current = false
      if (!reducedMotion) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            Object.keys(rects).forEach((id) => {
              if (id === dragId) return
              const el = findCardEl(id)
              if (!el) return
              const prev = rects[id]
              const now = el.getBoundingClientRect()
              const dx = prev.left - now.left
              const dy = prev.top - now.top
              if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
              el.style.transition = 'none'
              el.style.transform = `translate(${dx}px,${dy}px)`
              requestAnimationFrame(() => {
                el.style.transition = transition
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
      }
    }
  })

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const dragging = dragMetaRef.current
      if (!dragging) return
      lastPointerRef.current = { x: e.clientX, y: e.clientY }

      const under = document.elementFromPoint(e.clientX, e.clientY)
      const cardEl = under instanceof Element ? under.closest<HTMLElement>('[data-food-id]') : null
      const targetId = cardEl?.dataset.foodId
      if (!targetId || targetId === dragging.id) return
      captureRects(dragging.id)
      setItems((prev) => {
        const fromIndex = prev.findIndex((item) => item.id === dragging.id)
        const toIndex = prev.findIndex((item) => item.id === targetId)
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev
        const next = [...prev]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        return next
      })
    },
    [setItems, findCardEl, captureRects],
  )

  const handlePointerUp = useCallback(() => {
    const meta = dragMetaRef.current
    stopSpringLoop()
    if (meta) {
      const el = findCardEl(meta.id)
      if (el) {
        el.style.transition = 'transform var(--motion-flip-bold)'
        el.style.transform = ''
        window.setTimeout(() => {
          el.style.boxShadow = ''
          el.style.zIndex = ''
          el.style.transition = ''
        }, 340)
      }
    }
    dragMetaRef.current = null
    setDraggingId(null)
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    window.removeEventListener('pointercancel', handlePointerUp)
  }, [findCardEl, stopSpringLoop])

  const handleDragHandlePointerDown = (id: string, e: React.PointerEvent) => {
    if (!reorderEnabled) return
    e.preventDefault()
    const el = findCardEl(id)
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragMetaRef.current = {
      id,
      grabOffsetX: e.clientX - rect.left,
      grabOffsetY: e.clientY - rect.top,
    }
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    el.style.transition = 'transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 140ms ease'
    el.style.zIndex = '60'
    el.style.boxShadow = 'var(--shadow-lg)'
    const startOffset = computeDragOffset(el, e.clientX, e.clientY) ?? { x: 0, y: 0 }
    applyDragTransform(el, startOffset.x, startOffset.y, 0)
    setDraggingId(id)
    window.setTimeout(() => {
      if (dragMetaRef.current?.id !== id) return
      el.style.transition = 'none'
      springOffsetRef.current = startOffset
      startSpringLoop(id)
    }, 140)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      stopSpringLoop()
    }
  }, [handlePointerMove, handlePointerUp, stopSpringLoop])

  const selectedItems = useMemo(
    () => displayItems.filter((item) => selectedIds.has(item.id)),
    [displayItems, selectedIds],
  )
  const totals = useMemo(
    () =>
      selectedItems.reduce(
        (acc, item) => {
          const itemTotals = getFoodTotals(
            item,
            isOwner ? undefined : guestOverrides[item.id],
            isOwner ? undefined : guestIngredientOverrides[item.id],
          )
          return {
            weight: acc.weight + itemTotals.weight,
            protein: acc.protein + itemTotals.protein,
            calories: acc.calories + itemTotals.calories,
          }
        },
        { weight: 0, protein: 0, calories: 0 },
      ),
    [selectedItems, isOwner, guestOverrides, guestIngredientOverrides],
  )

  // The selection bar's stepper drives the item's own qty (see FoodItem.qty),
  // which scales the whole card — base numbers and sub-items alike
  // (getFoodTotals). It's the same number the sub-items sheet's header stepper
  // edits. With several cards selected it acts on the last one tapped, which
  // the bar names: selectedIds keeps insertion order, so that's its last entry
  // (selectedItems is in display order, not selection order).
  const lastSelectedId = useMemo(() => {
    let last: string | null = null
    for (const id of selectedIds) last = id
    return last
  }, [selectedIds])
  const steppableItem =
    selectedItems.find((item) => item.id === lastSelectedId) ??
    selectedItems[selectedItems.length - 1] ??
    null
  const selectedQty = steppableItem
    ? getEffectiveBaseQty(steppableItem, isOwner ? undefined : guestOverrides[steppableItem.id])
    : null

  // Embedded in LiftOS: mirror the running selection out to the host on every
  // change, the same way the Subway calculator mirrors its build to us. LiftOS
  // decides when to commit it — nothing here is a send.
  useEffect(() => {
    if (!embedContext) return
    postSelectionTotals(embedContext.parentOrigin, {
      count: selectedItems.length,
      calories: roundAmount(totals.calories),
      protein: roundAmount(totals.protein),
      weight: roundAmount(totals.weight),
    })
  }, [selectedItems.length, totals.calories, totals.protein, totals.weight])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCardToggle = (id: string) => {
    toggleSelect(id)
  }

  const openSubwayCalculator = () => {
    setSubwayMounted(true)
    setSubwayOpen(true)
  }

  // A card selected via keyboard (Tab + Enter/Space) keeps its :focus-visible
  // ring after Escape/cmd+D/清除 clears the selection — same --accent color as
  // the "selected" box-shadow, so it reads as still selected. Blur it so the
  // ring actually goes away with the selection.
  const clearSelection = () => {
    const active = document.activeElement as HTMLElement | null
    if (active?.classList.contains('food-card')) active.blur()
    setSelectedIds(new Set())
  }

  const selectAll = () => setSelectedIds(new Set(filteredItems.map((item) => item.id)))

  const copySelectedAsText = () => {
    navigator.clipboard.writeText(
      formatItemsAsText(selectedItems, isOwner ? undefined : guestOverrides, isOwner ? undefined : guestIngredientOverrides),
    )
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      // Any open dialog (edit modal, sub-items sheet, Subway calculator) owns
      // the keyboard — checked generically instead of via `modalOpen` alone
      // so it also covers dialogs App.tsx doesn't itself track the state of.
      const isDialogOpen = () => !!document.querySelector('.dialog-backdrop:not(.is-hidden)')

      if (e.key === '/' && !isEditable && !(e.metaKey || e.ctrlKey) && !isDialogOpen()) {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }

      // Dialogs own Esc for their own dismissal via useDialogDismiss — bail
      // so this doesn't also wipe the selection.
      if (e.key === 'Escape' && !isEditable && !isDialogOpen()) {
        if (selectedItems.length === 0) return
        e.preventDefault()
        clearSelection()
        return
      }

      if (!(e.metaKey || e.ctrlKey)) return
      const isSelectAll = e.key === 'a' || e.key === 'A'
      const isDeselect = e.key === 'd' || e.key === 'D'
      const isCopy = e.key === 'c' || e.key === 'C'
      if (!isSelectAll && !isDeselect && !isCopy) return
      if (isEditable || isDialogOpen()) return
      if (isCopy) {
        if (selectedItems.length === 0) return
        e.preventDefault()
        copySelectedAsText()
        return
      }
      e.preventDefault()
      if (isSelectAll) selectAll()
      else clearSelection()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredItems, selectedItems])

  const openAddModal = () => {
    if (!isOwner) return
    setEditingId(null)
    setActiveId(generateId())
    setDraft(emptyDraft)
    setModalOpen(true)
  }

  const openEditModal = (id: string) => {
    if (!isOwner) return
    const item = items.find((i) => i.id === id)
    if (!item) return
    setEditingId(id)
    setActiveId(id)

    const existingSubItems = sortBySelected(
      (item.subItems ?? []).map((sub) => ({
        id: sub.id,
        name: sub.name,
        weight: String(sub.weight),
        protein: String(sub.protein),
        calories: String(sub.calories),
        selected: sub.selected !== false,
        qty: String(sub.qty ?? 1),
        ingredients: sortBySelected(
          (sub.ingredients ?? []).map((ing) => ({
            id: ing.id,
            name: ing.name,
            weight: String(ing.weight),
            protein: String(ing.protein),
            calories: String(ing.calories),
            selected: ing.selected !== false,
            qty: String(ing.qty ?? 1),
          })),
        ),
      })),
    )
    // Legacy records may still carry their own base numbers alongside sub-items;
    // split them out into a row so the top fields can show a clean auto-sum.
    const hasBaseValues = item.weight > 0 || item.calories > 0 || item.protein > 0
    const shouldSplitBase = existingSubItems.length > 0 && hasBaseValues
    const subItems = shouldSplitBase
      ? [
          {
            id: generateId(),
            name: item.name,
            weight: String(item.weight),
            protein: String(item.protein),
            calories: String(item.calories),
            selected: true,
            qty: '1',
          },
          ...existingSubItems,
        ]
      : existingSubItems

    setDraft({
      name: item.name,
      imageUrl: item.imageUrl,
      weight: shouldSplitBase ? '0' : String(item.weight),
      protein: shouldSplitBase ? '0' : String(item.protein),
      calories: shouldSplitBase ? '0' : String(item.calories),
      subItems,
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    if (modalClosing) return
    setModalClosing(true)
    window.setTimeout(() => {
      setModalOpen(false)
      setModalClosing(false)
      setEditingId(null)
      setActiveId(null)
      setDraft(emptyDraft)
    }, 180)
  }

  const handleImageUploaded = (id: string, url: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, imageUrl: url } : item)))
  }

  // qty 0 excludes the sub-item but keeps its stored qty, so re-including it
  // restores the prior count.
  const setSubItemQty = (id: string, subId: string, qty: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item
        const subItems = item.subItems ?? []
        return {
          ...item,
          subItems: subItems.map((sub) =>
            sub.id === subId ? { ...sub, selected: qty > 0, qty: qty > 0 ? qty : sub.qty } : sub,
          ),
        }
      }),
    )
  }

  // Sets one nested ingredient's qty (e.g. "多一個蛋", or 0 to leave off a
  // burger's bun) without touching its sub-item's own qty/selected. qty 0
  // excludes the ingredient but keeps its stored qty, mirroring setSubItemQty.
  const setIngredientQty = (id: string, subId: string, ingredientId: string, qty: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item
        const subItems = item.subItems ?? []
        return {
          ...item,
          subItems: subItems.map((sub) =>
            sub.id !== subId
              ? sub
              : {
                  ...sub,
                  ingredients: (sub.ingredients ?? []).map((ing) =>
                    ing.id === ingredientId
                      ? { ...ing, selected: qty > 0, qty: qty > 0 ? qty : ing.qty }
                      : ing,
                  ),
                },
          ),
        }
      }),
    )
  }

  // Owner edits write straight to the shared record; guests can't write there,
  // so their qty changes flip a local-only override instead (see useGuestOverrides).
  //
  // Dropping to 0 sub-items selected would leave the whole item hidden (zero
  // totals — see getFoodTotals), so block whichever change would do that,
  // same invariant FoodModal enforces for its own edit path.
  const handleSetSubItemQty = (id: string, subId: string, qty: number) => {
    if (qty <= 0) {
      const subItems = items.find((item) => item.id === id)?.subItems ?? []
      const overrides = isOwner ? undefined : guestOverrides[id]
      const stillSelected = subItems.some(
        (sub) => sub.id !== subId && getEffectiveSubItemQty(sub, overrides) > 0,
      )
      if (subItems.length > 0 && !stillSelected) return
    }
    if (isOwner) {
      setSubItemQty(id, subId, qty)
      return
    }
    setGuestSubItemQty(id, subId, qty)
  }

  // The item's own qty (see FoodItem.qty) can't drop below 1 — excluding the
  // whole item is the card's own checkbox, not this stepper.
  const handleSetBaseQty = (id: string, qty: number) => {
    const clamped = Math.max(1, qty)
    if (isOwner) {
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, qty: clamped } : item)))
      return
    }
    setGuestSubItemQty(id, BASE_QTY_KEY, clamped)
  }

  // Owner edits write straight to the shared record; guests can't write there,
  // so their ingredient qty changes flip a local-only override instead (see useGuestOverrides).
  const handleSetIngredientQty = (id: string, subId: string, ingredientId: string, qty: number) => {
    if (isOwner) {
      setIngredientQty(id, subId, ingredientId, qty)
      return
    }
    setGuestIngredientQty(id, ingredientId, qty)
  }

  // Manual drag order from the sub-items sheet — rewrites the shared record
  // directly, so it's only ever wired up for the owner (see FoodCard).
  const reorderIngredients = (id: string, subId: string, orderedIngredientIds: string[]) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item
        const subItems = item.subItems ?? []
        return {
          ...item,
          subItems: subItems.map((sub) => {
            if (sub.id !== subId) return sub
            const byId = new Map((sub.ingredients ?? []).map((ing) => [ing.id, ing]))
            return {
              ...sub,
              ingredients: orderedIngredientIds
                .map((ingId) => byId.get(ingId))
                .filter((ing): ing is NonNullable<typeof ing> => ing != null),
            }
          }),
        }
      }),
    )
  }

  // Returns whether the write actually landed, so the modal can show a real
  // success/failure state instead of an optimistic checkmark that plays
  // regardless of what happened. Closing the modal is the modal's own call
  // (it does so via onCancel once it's shown the success state) — this just
  // does the write.
  const handleSave = async () => {
    if (draft.name.trim().length === 0) return false
    const subItems = draft.subItems
      .filter((sub) => sub.name.trim().length > 0)
      .map((sub) => ({
        id: sub.id,
        name: sub.name.trim(),
        weight: toNumber(sub.weight),
        protein: toNumber(sub.protein),
        calories: toNumber(sub.calories),
        selected: sub.selected,
        qty: toNumber(sub.qty) || 1,
        ingredients: (sub.ingredients ?? [])
          .filter((ing) => ing.name.trim().length > 0)
          .map((ing) => ({
            id: ing.id,
            name: ing.name.trim(),
            weight: toNumber(ing.weight),
            protein: toNumber(ing.protein),
            calories: toNumber(ing.calories),
            selected: ing.selected,
            qty: toNumber(ing.qty) || 1,
          })),
      }))
    bulkFlipRef.current = true
    captureRects()
    const result = editingId
      ? await setItems((prev) =>
          prev.map((item) =>
            item.id === editingId
              ? {
                  ...item,
                  name: draft.name.trim(),
                  imageUrl: draft.imageUrl,
                  weight: toNumber(draft.weight),
                  protein: toNumber(draft.protein),
                  calories: toNumber(draft.calories),
                  subItems,
                }
              : item,
          ),
        )
      : await setItems((prev) => [
          {
            id: activeId ?? generateId(),
            name: draft.name.trim(),
            imageUrl: draft.imageUrl,
            weight: toNumber(draft.weight),
            protein: toNumber(draft.protein),
            calories: toNumber(draft.calories),
            createdAt: Date.now(),
            subItems,
          },
          ...prev,
        ])
    return result.ok
  }

  const deleteItem = async (id: string) => {
    if (!isOwner) return
    // FoodModal gates this call with its own inline "確定刪除？" confirm —
    // an extra confirm() here would double-prompt.
    if (editingId === id) closeModal()
    if (removingIds.has(id)) return
    setRemovingIds((prev) => new Set(prev).add(id))
    window.setTimeout(() => {
      bulkFlipRef.current = true
      captureRects(id)
      setItems((prev) => prev.filter((item) => item.id !== id))
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setRemovingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 230)
  }

  const hasAnyItems = items.length > 0
  const hasResults = filteredItems.length > 0

  return (
    <>
      <div className="page-scroll">
        <div className="page-content">
          <header className="page-topbar">
            <div className="title-row">
              <h1>Foodbook</h1>
              <span className="item-count">{items.length} 筆</span>
            </div>

            <div className="search-bar">
              <Search size={14} strokeWidth={2} />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => {
                  bulkFlipRef.current = true
                  captureRects()
                  setSearch(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') e.currentTarget.blur()
                }}
                placeholder="搜尋食物名稱"
              />
              {search ? (
                <button
                  type="button"
                  className="search-clear"
                  aria-label="清除搜尋"
                  onClick={() => {
                    bulkFlipRef.current = true
                    captureRects()
                    setSearch('')
                    searchInputRef.current?.focus()
                  }}
                >
                  <X size={13} strokeWidth={2.4} />
                </button>
              ) : (
                <span className="kbd-hint">/</span>
              )}
            </div>

            <div className="topbar-actions">
              {isOwner ? (
                <>
                  <button type="button" className="btn-add-pill" onClick={openAddModal}>
                    <Plus size={15} strokeWidth={2.4} />
                    新增
                  </button>
                  <button
                    type="button"
                    className="avatar-btn"
                    title={`登出 ${userLabel}`}
                    onClick={async () => {
                      if (await confirm(`確定要登出 ${userLabel} 嗎？`)) onLogOut()
                    }}
                  >
                    {photoURL ? (
                      <img src={photoURL} alt="" />
                    ) : (
                      (userLabel[0] ?? '?').toUpperCase()
                    )}
                  </button>
                </>
              ) : (
                /* Also offered inside the LiftOS frame — editing there needs it.
                   The popup works because that iframe allows popups; the catch
                   is that browsers partition storage per top-level site, so this
                   session is separate from the standalone app's and may need
                   signing in again. */
                <div className="signin-wrap">
                  {signInError && <div className="upload-error">登入失敗，請重試</div>}
                  <button type="button" className="btn btn-secondary" onClick={onSignIn}>
                    使用 Google 登入
                  </button>
                </div>
              )}
            </div>
          </header>

          {hasAnyItems && (
            <div className="sort-bar">
              <button
                type="button"
                className={`sort-pill${sortMode === 'manual' ? ' is-active' : ''}`}
                onClick={() => handleSortPillClick('manual')}
              >
                預設
              </button>
              <button
                type="button"
                className={`sort-pill${sortMode === 'calories' ? ' is-active' : ''}`}
                onClick={() => handleSortPillClick('calories')}
              >
                熱量{sortMode === 'calories' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </button>
              <button
                type="button"
                className={`sort-pill${sortMode === 'protein' ? ' is-active' : ''}`}
                onClick={() => handleSortPillClick('protein')}
              >
                蛋白質效率{sortMode === 'protein' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </button>
            </div>
          )}

          {itemsLoading && !hasAnyItems && <div className="no-results">同步中…</div>}
          {!itemsLoading && !hasAnyItems && (
            <div className="empty-state">
              <ImageIcon size={48} />
              <h3>還沒有任何紀錄</h3>
              <p className="text-muted">拍下食物照片，記錄重量、蛋白質與熱量，開始建立你的資料庫</p>
              {isOwner && (
                <button type="button" className="btn btn-primary" onClick={openAddModal}>
                  <Plus size={16} />
                  新增第一筆紀錄
                </button>
              )}
            </div>
          )}

          {hasAnyItems && !hasResults && (
            <div className="no-results">找不到符合「{search}」的紀錄</div>
          )}

          {hasAnyItems && hasResults && (
            <div className="food-grid" ref={foodGridRef}>
              {sortedItems.map((item) => (
                <FoodCard
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  grayscale={GRAYSCALE_PHOTOS}
                  readOnly={!isOwner}
                  reorderEnabled={reorderEnabled}
                  dragging={draggingId === item.id}
                  removing={removingIds.has(item.id)}
                  isCalculatorLink={item.name === SUBWAY_ITEM_NAME}
                  onToggle={handleCardToggle}
                  onOpenCalculator={openSubwayCalculator}
                  onEdit={openEditModal}
                  onSetSubItemQty={handleSetSubItemQty}
                  onSetIngredientQty={handleSetIngredientQty}
                  onSetBaseQty={handleSetBaseQty}
                  onReorderIngredients={isOwner ? reorderIngredients : undefined}
                  onDragHandlePointerDown={handleDragHandlePointerDown}
                  guestOverrides={isOwner ? undefined : guestOverrides[item.id]}
                  guestIngredientOverrides={isOwner ? undefined : guestIngredientOverrides[item.id]}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <SelectionBar
        count={selectedItems.length}
        itemName={steppableItem?.name ?? ''}
        totalProtein={totals.protein}
        totalCalories={totals.calories}
        qty={selectedQty}
        onSetQty={(qty) => steppableItem && handleSetBaseQty(steppableItem.id, qty)}
        onClear={clearSelection}
        onCopy={copySelectedAsText}
      />

      {modalOpen && activeId && (
        <FoodModal
          itemId={activeId}
          draft={draft}
          isEditing={editingId !== null}
          closing={modalClosing}
          onChange={setDraft}
          onSave={handleSave}
          onCancel={closeModal}
          onDelete={() => editingId && deleteItem(editingId)}
          onImageUploaded={handleImageUploaded}
          confirm={confirm}
        />
      )}

      {subwayMounted && (
        <SubwayScreen visible={subwayOpen} closing={subwayClosing} onClose={closeSubway} />
      )}

      {confirmDialogProps && <ConfirmDialog {...confirmDialogProps} />}
    </>
  )
}
