import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, Plus, Search, X } from 'lucide-react'
import { useAuth } from './useAuth'
import { useTheme } from './useTheme'
import { useCloudItems } from './useCloudItems'
import { useGuestOverrides } from './useGuestOverrides'
import type { FoodDraft } from './types'
import { emptyDraft, getFoodTotals } from './types'
import { FoodCard } from './components/FoodCard'
import { SelectionBar } from './components/SelectionBar'
import { FoodModal } from './components/FoodModal'
import { SubwayScreen, SUBWAY_CALCULATOR_URL } from './components/SubwayScreen'
import { formatItemsAsText, generateId, toNumber } from './utils'

const GRAYSCALE_PHOTOS = false
const OWNER_UID = '277SEyYGZyUyapmKB5Fu4OC4dDR2'
// Launches the embedded calculator instead of toggling into the selection total.
const SUBWAY_ITEM_NAME = 'Subway'
const SUBWAY_CLOSE_MS = 220
// Trusted regardless of where Foodbook itself is served from (dev vs. prod) —
// the iframe always points at the live calculator at this fixed origin.
const SUBWAY_ORIGIN = new URL(SUBWAY_CALCULATOR_URL).origin

type SubwayResult = { hasSelection: boolean; mainName?: string; kcal?: number; protein?: number }

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
  const { overrides: guestOverrides, toggle: toggleGuestSubItem } = useGuestOverrides()
  useTheme()
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
    }
    setSelectedIds((prev) => new Set(prev).add(subwayItem.id))
  }

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
    if (!q) return items
    return items.filter((item) => {
      if (item.name.toLowerCase().includes(q)) return true
      return (item.subItems ?? []).some((sub) => {
        if (sub.name.toLowerCase().includes(q)) return true
        return (sub.ingredients ?? []).some((ing) => ing.name.toLowerCase().includes(q))
      })
    })
  }, [items, search])

  const reorderEnabled = isOwner && search.trim().length === 0
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  const [modalClosing, setModalClosing] = useState(false)

  const foodGridRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const prevRectsRef = useRef<Record<string, DOMRect> | null>(null)
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
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  )
  const totals = useMemo(
    () =>
      selectedItems.reduce(
        (acc, item) => {
          const itemTotals = getFoodTotals(item, isOwner ? undefined : guestOverrides[item.id])
          return {
            weight: acc.weight + itemTotals.weight,
            protein: acc.protein + itemTotals.protein,
            calories: acc.calories + itemTotals.calories,
          }
        },
        { weight: 0, protein: 0, calories: 0 },
      ),
    [selectedItems, isOwner, guestOverrides],
  )

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCardToggle = (id: string) => {
    const item = items.find((i) => i.id === id)
    if (item?.name === SUBWAY_ITEM_NAME) {
      setSubwayMounted(true)
      setSubwayOpen(true)
      return
    }
    toggleSelect(id)
  }

  const clearSelection = () => setSelectedIds(new Set())

  const selectAll = () => setSelectedIds(new Set(filteredItems.map((item) => item.id)))

  const copySelectedAsText = () => {
    navigator.clipboard.writeText(formatItemsAsText(selectedItems, isOwner ? undefined : guestOverrides))
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if (e.key === '/' && !isEditable && !(e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }

      // Dialogs (edit modal, sub-items sheet) own Esc for their own dismissal
      // via useDialogDismiss — bail so this doesn't also wipe the selection.
      if (
        e.key === 'Escape' &&
        !isEditable &&
        !modalOpen &&
        !document.querySelector('.dialog-backdrop')
      ) {
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
      if (isEditable || modalOpen) return
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
  }, [filteredItems, modalOpen, selectedItems])

  const mergeIntoItem = (baseId: string, mergeIds: string[]) => {
    if (!isOwner || mergeIds.length === 0) return
    const base = items.find((item) => item.id === baseId)
    if (!base) return
    const mergeItems = items.filter((item) => mergeIds.includes(item.id))
    if (
      !window.confirm(
        `確定要將這 ${mergeItems.length} 項合併進「${base.name}」嗎？合併後個別項目將消失，但數值會保留為子項目。`,
      )
    )
      return

    const mergedSubItems = [
      ...(base.subItems ?? []),
      ...mergeItems.flatMap((item) => [
        {
          id: generateId(),
          name: item.name,
          weight: item.weight,
          protein: item.protein,
          calories: item.calories,
          selected: true,
        },
        ...(item.subItems ?? []).map((sub) => ({ ...sub, selected: true })),
      ]),
    ]
    const removeIds = new Set(mergeIds)

    setItems((prev) =>
      prev
        .filter((item) => !removeIds.has(item.id))
        .map((item) => (item.id === baseId ? { ...item, subItems: mergedSubItems } : item)),
    )
    setSelectedIds(new Set())
    closeModal()
  }

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

    const existingSubItems = (item.subItems ?? []).map((sub) => ({
      id: sub.id,
      name: sub.name,
      weight: String(sub.weight),
      protein: String(sub.protein),
      calories: String(sub.calories),
      selected: sub.selected !== false,
      qty: String(sub.qty ?? 1),
      ingredients: (sub.ingredients ?? []).map((ing) => ({
        id: ing.id,
        name: ing.name,
        weight: String(ing.weight),
        protein: String(ing.protein),
        calories: String(ing.calories),
      })),
    }))
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

  const toggleSubItemSelected = (id: string, subId: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item
        const subItems = item.subItems ?? []
        return {
          ...item,
          subItems: subItems.map((sub) =>
            sub.id === subId ? { ...sub, selected: sub.selected === false } : sub,
          ),
        }
      }),
    )
  }

  // Quick-pick from the card's qty chip menu (owner only — guests only ever
  // get the plain include/exclude toggle below). qty 0 excludes the sub-item
  // but keeps its stored qty, so re-including it restores the prior count.
  const setSubItemQty = (id: string, subId: string, qty: number) => {
    if (!isOwner) return
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

  // Sub-items are only ever created via the edit modal — this sheet-side
  // action can only remove one, never add.
  const removeSubItem = (id: string, subId: string) => {
    if (!isOwner) return
    if (!window.confirm('確定要刪除這個子項目嗎？')) return
    setItems((prev) =>
      prev.map((item) =>
        item.id !== id ? item : { ...item, subItems: (item.subItems ?? []).filter((sub) => sub.id !== subId) },
      ),
    )
  }

  // Owner edits write straight to the shared record; guests can't write there,
  // so their taps flip a local-only override instead (see useGuestOverrides).
  const handleToggleSubItem = (id: string, subId: string) => {
    if (isOwner) {
      toggleSubItemSelected(id, subId)
      return
    }
    const sub = items.find((item) => item.id === id)?.subItems?.find((s) => s.id === subId)
    if (!sub) return
    toggleGuestSubItem(id, subId, sub.selected !== false)
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
          })),
      }))
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

  const deleteItem = (id: string) => {
    if (!isOwner) return
    if (!window.confirm('確定要刪除這筆紀錄嗎？')) return
    if (editingId === id) closeModal()
    if (removingIds.has(id)) return
    setRemovingIds((prev) => new Set(prev).add(id))
    window.setTimeout(() => {
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

  const mergeCandidateIds = editingId
    ? selectedItems.filter((item) => item.id !== editingId).map((item) => item.id)
    : []

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
              {!isOwner && (
                <span className="guest-badge" title="子項目的勾選只會存在你的裝置上，不會同步給其他人或寫入原始紀錄">
                  檢視模式
                </span>
              )}
            </div>

            <div className="search-bar">
              <Search size={14} strokeWidth={2} />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => {
                  captureRects()
                  setSearch(e.target.value)
                }}
                placeholder="搜尋食物名稱"
              />
              {search ? (
                <button
                  type="button"
                  className="search-clear"
                  aria-label="清除搜尋"
                  onClick={() => {
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
                    onClick={() => {
                      if (window.confirm(`確定要登出 ${userLabel} 嗎？`)) onLogOut()
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
                <div className="signin-wrap">
                  {signInError && <div className="upload-error">登入失敗，請重試</div>}
                  <button type="button" className="btn btn-secondary" onClick={onSignIn}>
                    使用 Google 登入
                  </button>
                </div>
              )}
            </div>
          </header>

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
              {filteredItems.map((item) => (
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
                  onEdit={openEditModal}
                  onToggleSubItem={handleToggleSubItem}
                  onSetSubItemQty={setSubItemQty}
                  onRemoveSubItem={removeSubItem}
                  onDragHandlePointerDown={handleDragHandlePointerDown}
                  guestOverrides={isOwner ? undefined : guestOverrides[item.id]}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <SelectionBar
        count={selectedItems.length}
        totalWeight={totals.weight}
        totalProtein={totals.protein}
        totalCalories={totals.calories}
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
          mergeCandidateCount={mergeCandidateIds.length}
          onMerge={() => editingId && mergeIntoItem(editingId, mergeCandidateIds)}
        />
      )}

      {subwayMounted && (
        <SubwayScreen visible={subwayOpen} closing={subwayClosing} onClose={closeSubway} />
      )}
    </>
  )
}
