import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Camera, Check, ChevronDown, GripVertical, Plus, X } from 'lucide-react'
import type { FoodDraft, FoodIngredientDraft, FoodSubItemDraft } from '../types'
import { uploadToCloudinary } from '../cloudinary'
import { useDialogDismiss } from '../useDialogDismiss'
import { useFocusTrap } from '../useFocusTrap'
import type { ConfirmOptions } from '../useConfirm'
import { formatAmount, generateId, roundAmount, toNumber } from '../utils'

interface FoodModalProps {
  itemId: string
  draft: FoodDraft
  isEditing: boolean
  closing: boolean
  onChange: (draft: FoodDraft) => void
  // Resolves once the write actually settles, with whether it succeeded —
  // the modal waits for this before claiming success.
  onSave: () => Promise<boolean>
  onCancel: () => void
  onDelete: () => void
  onImageUploaded: (id: string, url: string) => void
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>
}

export function FoodModal({
  itemId,
  draft,
  isEditing,
  closing,
  onChange,
  onSave,
  onCancel,
  onDelete,
  onImageUploaded,
  confirm,
}: FoodModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(draft.imageUrl)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  // Which sub-item's card is expanded in the form's accordion — collapsed by
  // default, single-expand (matches the chip-menu redesign's simplified
  // sub-item information hierarchy).
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saveTimerRef = useRef<number | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    // The write already happened by the time we reach 'success' (see
    // handleSaveClick below) — this timer just holds the checkmark on screen
    // for a beat before closing, so on unmount there's nothing left to flush.
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    }
  }, [])

  const backdropProps = useDialogDismiss(onCancel)
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, true)

  // min="0" on these fields doesn't actually stop a typed/pasted "-5" — with
  // no <form> wrapping the dialog, the constraint validation it depends on
  // never runs, so it only disables the spinner below 0. Clamp the typed
  // value itself so a stray minus sign can't reach the stored draft (and
  // from there getFoodTotals) at all.
  const clampNonNegative = (raw: string) => (toNumber(raw) < 0 ? '0' : raw)

  const handleSaveClick = async () => {
    if (draft.name.trim().length === 0 || saveState === 'saving' || saveState === 'success') return
    setSaveState('saving')
    const ok = await onSaveRef.current()
    if (!ok) {
      setSaveState('error')
      return
    }
    setSaveState('success')
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      onCancelRef.current()
    }, 560)
  }

  const addSubItem = () => {
    const newSubItem: FoodSubItemDraft = {
      id: generateId(),
      name: '',
      weight: '',
      protein: '',
      calories: '',
      selected: true,
      qty: '1',
    }

    // First sub-item: split the manually-entered base numbers out into their
    // own row so the top fields can become a read-only auto-sum from here on.
    const hasBaseValues =
      draft.subItems.length === 0 &&
      (toNumber(draft.weight) > 0 || toNumber(draft.calories) > 0 || toNumber(draft.protein) > 0)
    if (hasBaseValues) {
      const baseSubItem: FoodSubItemDraft = {
        id: generateId(),
        name: draft.name.trim() || '本體',
        weight: draft.weight,
        protein: draft.protein,
        calories: draft.calories,
        selected: true,
        qty: '1',
      }
      onChange({
        ...draft,
        weight: '0',
        calories: '0',
        protein: '0',
        subItems: [baseSubItem, newSubItem],
      })
      setExpandedSubId(newSubItem.id)
      return
    }

    onChange({ ...draft, subItems: [...draft.subItems, newSubItem] })
    setExpandedSubId(newSubItem.id)
  }

  const updateSubItem = (id: string, patch: Partial<FoodSubItemDraft>) => {
    onChange({
      ...draft,
      subItems: draft.subItems.map((sub) => (sub.id === id ? { ...sub, ...patch } : sub)),
    })
  }

  const selectSubItem = (id: string, selected: boolean) => {
    if (!selected) {
      // Unchecking drops the row to the bottom of the list instead of leaving
      // it in place, so active items stay grouped at the top.
      const target = draft.subItems.find((sub) => sub.id === id)
      if (!target) return
      const rest = draft.subItems.filter((sub) => sub.id !== id)
      // Unchecking the last active row would leave the whole item hidden
      // (zero totals) — force the new top row active instead of allowing that.
      if (rest.length > 0 && !rest.some((sub) => sub.selected)) {
        const [first, ...others] = rest
        onChange({ ...draft, subItems: [{ ...first, selected: true }, ...others, { ...target, selected }] })
        return
      }
      onChange({ ...draft, subItems: [...rest, { ...target, selected }] })
      return
    }
    updateSubItem(id, { selected })
  }

  // Mirrors the confirmation the sheet-side delete already has ([App.tsx]
  // removeSubItem) — but only when there's real data at stake, so clearing a
  // just-added blank row stays a single click.
  const removeSubItem = async (id: string) => {
    const target = draft.subItems.find((sub) => sub.id === id)
    const hasContent =
      target &&
      (target.name.trim().length > 0 ||
        toNumber(target.weight) > 0 ||
        toNumber(target.calories) > 0 ||
        toNumber(target.protein) > 0 ||
        (target.ingredients?.length ?? 0) > 0)
    if (hasContent && !(await confirm('確定要刪除這個子項目嗎？'))) return
    onChange({ ...draft, subItems: draft.subItems.filter((sub) => sub.id !== id) })
    setExpandedSubId((current) => (current === id ? null : current))
  }

  // Ingredients belong entirely to their sub-item (e.g. "鐵板麵" under "沙朗牛排"):
  // always counted whenever the sub-item is, with no checkbox of their own.
  const addIngredient = (subId: string) => {
    const sub = draft.subItems.find((s) => s.id === subId)
    if (!sub) return
    const ingredients = sub.ingredients ?? []
    const newIngredient: FoodIngredientDraft = {
      id: generateId(),
      name: '',
      weight: '',
      protein: '',
      calories: '',
      selected: true,
      qty: '1',
    }

    // First ingredient: split the sub-item's own manually-entered numbers out
    // into their own row, mirroring how the top-level fields split for sub-items.
    const hasBaseValues =
      ingredients.length === 0 &&
      (toNumber(sub.weight) > 0 || toNumber(sub.calories) > 0 || toNumber(sub.protein) > 0)
    if (hasBaseValues) {
      const baseIngredient: FoodIngredientDraft = {
        id: generateId(),
        name: sub.name.trim() || '本體',
        weight: sub.weight,
        protein: sub.protein,
        calories: sub.calories,
        selected: true,
        qty: '1',
      }
      updateSubItem(subId, {
        weight: '0',
        calories: '0',
        protein: '0',
        ingredients: [baseIngredient, newIngredient],
      })
      return
    }

    updateSubItem(subId, { ingredients: [...ingredients, newIngredient] })
  }

  const updateIngredient = (subId: string, ingredientId: string, patch: Partial<FoodIngredientDraft>) => {
    const sub = draft.subItems.find((s) => s.id === subId)
    if (!sub) return
    updateSubItem(subId, {
      ingredients: (sub.ingredients ?? []).map((ing) => (ing.id === ingredientId ? { ...ing, ...patch } : ing)),
    })
  }

  const selectIngredient = (subId: string, ingredientId: string, selected: boolean) => {
    const sub = draft.subItems.find((s) => s.id === subId)
    if (!sub) return
    const ingredients = sub.ingredients ?? []
    if (!selected) {
      // Mirrors selectSubItem: unchecking drops the row to the bottom of the
      // list instead of leaving it in place, so active ingredients stay
      // grouped at the top.
      const target = ingredients.find((ing) => ing.id === ingredientId)
      if (!target) return
      const rest = ingredients.filter((ing) => ing.id !== ingredientId)
      updateSubItem(subId, { ingredients: [...rest, { ...target, selected }] })
      return
    }
    updateIngredient(subId, ingredientId, { selected })
  }

  const removeIngredient = async (subId: string, ingredientId: string) => {
    const sub = draft.subItems.find((s) => s.id === subId)
    if (!sub) return
    const target = (sub.ingredients ?? []).find((ing) => ing.id === ingredientId)
    const hasContent =
      target &&
      (target.name.trim().length > 0 ||
        toNumber(target.weight) > 0 ||
        toNumber(target.calories) > 0 ||
        toNumber(target.protein) > 0)
    if (hasContent && !(await confirm('確定要刪除這個成分嗎？'))) return
    updateSubItem(subId, { ingredients: (sub.ingredients ?? []).filter((ing) => ing.id !== ingredientId) })
  }

  const subItemTotals = (sub: FoodSubItemDraft) => {
    const ingredients = sub.ingredients ?? []
    const countedIngredients = ingredients.filter((ing) => ing.selected !== false)
    const hasIngredients = ingredients.length > 0
    const qty = toNumber(sub.qty) || 1
    const ingredientQty = (ing: FoodIngredientDraft) => toNumber(ing.qty) || 1
    const baseWeight =
      toNumber(sub.weight) + countedIngredients.reduce((sum, ing) => sum + toNumber(ing.weight) * ingredientQty(ing), 0)
    const baseCalories =
      toNumber(sub.calories) +
      countedIngredients.reduce((sum, ing) => sum + toNumber(ing.calories) * ingredientQty(ing), 0)
    const baseProtein =
      toNumber(sub.protein) +
      countedIngredients.reduce((sum, ing) => sum + toNumber(ing.protein) * ingredientQty(ing), 0)
    return {
      hasIngredients,
      qty,
      weight: roundAmount(baseWeight * qty),
      calories: roundAmount(baseCalories * qty),
      protein: roundAmount(baseProtein * qty),
    }
  }

  // Mirrors the food-grid card drag system in App.tsx: the grabbed row follows
  // the pointer with a spring lag, siblings FLIP-animate into their new slot as
  // the order changes live, and everything settles back with the same
  // --motion-flip-bold ease on release.
  const subItemsRef = useRef<HTMLDivElement>(null)
  const dragMetaRef = useRef<{ id: string; grabOffsetY: number } | null>(null)
  const lastPointerYRef = useRef(0)
  const springOffsetRef = useRef<number | null>(null)
  const dragRafRef = useRef<number | null>(null)
  const prevSubItemRectsRef = useRef<Record<string, DOMRect> | null>(null)
  const [draggingSubItemId, setDraggingSubItemId] = useState<string | null>(null)

  const findSubItemRowEl = (id: string): HTMLElement | null =>
    subItemsRef.current?.querySelector<HTMLElement>(`[data-sub-item-id="${CSS.escape(id)}"]`) ?? null

  const captureSubItemRects = (excludeId?: string) => {
    const container = subItemsRef.current
    if (!container) return
    const rects: Record<string, DOMRect> = {}
    container.querySelectorAll<HTMLElement>('[data-sub-item-id]').forEach((el) => {
      const id = el.dataset.subItemId
      if (id && id !== excludeId) rects[id] = el.getBoundingClientRect()
    })
    prevSubItemRectsRef.current = rects
  }

  const computeSubItemDragOffsetY = (el: HTMLElement, clientY: number) => {
    const meta = dragMetaRef.current
    if (!meta) return 0
    const saved = el.style.transform
    el.style.transform = ''
    const rect = el.getBoundingClientRect()
    el.style.transform = saved
    return clientY - meta.grabOffsetY - rect.top
  }

  const applySubItemDragTransform = (el: HTMLElement, y: number) => {
    el.style.transform = `translateY(${y}px) scale(1.02)`
  }

  const SUB_ITEM_SPRING_FACTOR = 0.35

  const stopSubItemSpringLoop = () => {
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = null
    }
    springOffsetRef.current = null
  }

  const startSubItemSpringLoop = (id: string) => {
    const step = () => {
      const meta = dragMetaRef.current
      const el = meta && meta.id === id ? findSubItemRowEl(id) : null
      const current = springOffsetRef.current
      if (!meta || !el || current === null) {
        dragRafRef.current = null
        return
      }
      const target = computeSubItemDragOffsetY(el, lastPointerYRef.current)
      const next = current + (target - current) * SUB_ITEM_SPRING_FACTOR
      springOffsetRef.current = next
      applySubItemDragTransform(el, next)
      dragRafRef.current = requestAnimationFrame(step)
    }
    dragRafRef.current = requestAnimationFrame(step)
  }

  // FLIP: after a live reorder moves rows in the DOM, replay each sibling from
  // its pre-reorder position back to rest so the shuffle reads as motion.
  useLayoutEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!prevSubItemRectsRef.current) return
    const rects = prevSubItemRectsRef.current
    prevSubItemRectsRef.current = null
    const dragId = dragMetaRef.current?.id
    if (reducedMotion) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        Object.keys(rects).forEach((id) => {
          if (id === dragId) return
          const el = findSubItemRowEl(id)
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

  const handleSubItemGripDown = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    e.preventDefault()
    const el = findSubItemRowEl(id)
    if (!el) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = el.getBoundingClientRect()
    dragMetaRef.current = { id, grabOffsetY: e.clientY - rect.top }
    lastPointerYRef.current = e.clientY
    el.style.transition = 'transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 140ms ease'
    el.style.zIndex = '2'
    el.style.boxShadow = 'var(--shadow-lg)'
    const startOffset = computeSubItemDragOffsetY(el, e.clientY)
    applySubItemDragTransform(el, startOffset)
    setDraggingSubItemId(id)
    window.setTimeout(() => {
      if (dragMetaRef.current?.id !== id) return
      el.style.transition = 'none'
      springOffsetRef.current = startOffset
      startSubItemSpringLoop(id)
    }, 140)
  }

  const handleSubItemGripMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const dragging = dragMetaRef.current
    if (!dragging || !subItemsRef.current) return
    lastPointerYRef.current = e.clientY

    // Dragging over another (expanded) sub-item's ingredients zone previews a
    // convert-to-ingredient drop instead of reordering the sub-items list.
    const crossSubId = findIngredientsSectionSubIdAt(e.clientX, e.clientY, dragging.id)
    if (crossSubId) {
      const container = ingredientContainersRef.current.get(crossSubId)
      const rows = container ? Array.from(container.querySelectorAll<HTMLElement>('[data-ingredient-id]')) : []
      const index = indexForPointerY(rows, e.clientY)
      setConvertTarget((current) =>
        current?.kind === 'toIngredient' && current.subId === crossSubId && current.index === index
          ? current
          : { kind: 'toIngredient', subId: crossSubId, index },
      )
      return
    }
    if (convertTarget !== null) setConvertTarget(null)

    const draggedIndex = draft.subItems.findIndex((sub) => sub.id === dragging.id)
    if (draggedIndex === -1) return
    const rows = Array.from(subItemsRef.current.querySelectorAll<HTMLElement>('[data-sub-item-id]'))
    for (let i = 0; i < rows.length; i++) {
      if (i === draggedIndex) continue
      const rect = rows[i].getBoundingClientRect()
      const mid = rect.top + rect.height / 2
      const crossed = (i < draggedIndex && e.clientY < mid) || (i > draggedIndex && e.clientY > mid)
      if (crossed) {
        captureSubItemRects(dragging.id)
        const next = [...draft.subItems]
        const [moved] = next.splice(draggedIndex, 1)
        next.splice(i, 0, moved)
        onChange({ ...draft, subItems: next })
        break
      }
    }
  }

  const handleSubItemGripUp = () => {
    const meta = dragMetaRef.current
    stopSubItemSpringLoop()
    if (meta) {
      const el = findSubItemRowEl(meta.id)
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
    if (meta && convertTarget?.kind === 'toIngredient') {
      convertSubItemToIngredient(meta.id, convertTarget.subId, convertTarget.index)
    }
    dragMetaRef.current = null
    setDraggingSubItemId(null)
    setConvertTarget(null)
  }

  useEffect(() => {
    return () => stopSubItemSpringLoop()
  }, [])

  // Mirrors the sub-item drag system above, scoped to one sub-item's own
  // ingredients list at a time (drag state carries which sub-item it's in).
  const ingredientContainersRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const ingredientDragMetaRef = useRef<{ subId: string; id: string; grabOffsetY: number } | null>(null)
  const lastIngredientPointerYRef = useRef(0)
  const ingredientSpringOffsetRef = useRef<number | null>(null)
  const ingredientDragRafRef = useRef<number | null>(null)
  const prevIngredientRectsRef = useRef<{ subId: string; rects: Record<string, DOMRect> } | null>(null)
  const [draggingIngredientId, setDraggingIngredientId] = useState<string | null>(null)
  const [convertTarget, setConvertTarget] = useState<
    { kind: 'toIngredient'; subId: string; index: number } | { kind: 'toSubItem'; index: number } | null
  >(null)

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

    // Dragging out of every ingredients zone and over the sub-items list
    // previews a convert-to-sub-item drop instead of reordering ingredients.
    if (isOverTopLevelSubItemsZone(e.clientX, e.clientY)) {
      const rows = subItemsRef.current
        ? Array.from(subItemsRef.current.querySelectorAll<HTMLElement>('[data-sub-item-id]'))
        : []
      const index = indexForPointerY(rows, e.clientY)
      setConvertTarget((current) =>
        current?.kind === 'toSubItem' && current.index === index ? current : { kind: 'toSubItem', index },
      )
      return
    }
    if (convertTarget !== null) setConvertTarget(null)

    const sub = draft.subItems.find((s) => s.id === dragging.subId)
    const ingredients = sub?.ingredients ?? []
    const draggedIndex = ingredients.findIndex((ing) => ing.id === dragging.id)
    if (draggedIndex === -1) return
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-ingredient-id]'))
    for (let i = 0; i < rows.length; i++) {
      if (i === draggedIndex) continue
      const rect = rows[i].getBoundingClientRect()
      const mid = rect.top + rect.height / 2
      const crossed = (i < draggedIndex && e.clientY < mid) || (i > draggedIndex && e.clientY > mid)
      if (crossed) {
        captureIngredientRects(dragging.subId, dragging.id)
        const next = [...ingredients]
        const [moved] = next.splice(draggedIndex, 1)
        next.splice(i, 0, moved)
        updateSubItem(dragging.subId, { ingredients: next })
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
    if (meta && convertTarget?.kind === 'toSubItem') {
      convertIngredientToSubItem(meta.subId, meta.id, convertTarget.index)
    }
    ingredientDragMetaRef.current = null
    setDraggingIngredientId(null)
    setConvertTarget(null)
  }

  useEffect(() => {
    return () => stopIngredientSpringLoop()
  }, [])

  // Cross-zone conversion: a sub-item's grip dropped onto another sub-item's
  // ingredients zone (or an ingredient's grip dropped onto the sub-items
  // list) converts it in place. Shared by both drag systems above since only
  // one grip can be held at a time.
  const indexForPointerY = (rows: HTMLElement[], clientY: number) => {
    for (let i = 0; i < rows.length; i++) {
      if (clientY < rows[i].getBoundingClientRect().top + rows[i].getBoundingClientRect().height / 2) return i
    }
    return rows.length
  }

  // The ingredients zone renders (with a ref) even when empty, so it's a
  // valid drop target as soon as its sub-item is expanded.
  const findIngredientsSectionSubIdAt = (clientX: number, clientY: number, excludeSubId: string) => {
    for (const [subId, el] of ingredientContainersRef.current) {
      if (subId === excludeSubId) continue
      const rect = el.getBoundingClientRect()
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return subId
    }
    return null
  }

  const isOverTopLevelSubItemsZone = (clientX: number, clientY: number) => {
    const container = subItemsRef.current
    if (!container) return false
    const rect = container.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false
    for (const [, el] of ingredientContainersRef.current) {
      const r = el.getBoundingClientRect()
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return false
    }
    return true
  }

  // A sub-item dropped as an ingredient can't keep its own nested ingredients
  // (no double nesting) — they're promoted to siblings right after it instead
  // of silently disappearing.
  const convertSubItemToIngredient = (subItemId: string, targetSubId: string, atIndex: number) => {
    const source = draft.subItems.find((sub) => sub.id === subItemId)
    const target = draft.subItems.find((sub) => sub.id === targetSubId)
    if (!source || !target || source.id === target.id) return
    const converted: FoodIngredientDraft = {
      id: source.id,
      name: source.name,
      weight: source.weight,
      protein: source.protein,
      calories: source.calories,
      selected: source.selected,
      qty: source.qty,
    }
    const nextIngredients = [...(target.ingredients ?? [])]
    nextIngredients.splice(atIndex, 0, converted, ...(source.ingredients ?? []))
    onChange({
      ...draft,
      subItems: draft.subItems
        .filter((sub) => sub.id !== subItemId)
        .map((sub) => (sub.id === targetSubId ? { ...sub, ingredients: nextIngredients } : sub)),
    })
    setExpandedSubId(targetSubId)
  }

  const convertIngredientToSubItem = (subId: string, ingredientId: string, atIndex: number) => {
    const sub = draft.subItems.find((s) => s.id === subId)
    const source = sub?.ingredients?.find((ing) => ing.id === ingredientId)
    if (!sub || !source) return
    const converted: FoodSubItemDraft = {
      id: source.id,
      name: source.name,
      weight: source.weight,
      protein: source.protein,
      calories: source.calories,
      selected: source.selected,
      qty: source.qty,
    }
    const nextSubItems = draft.subItems.map((s) =>
      s.id === subId ? { ...s, ingredients: (s.ingredients ?? []).filter((ing) => ing.id !== ingredientId) } : s,
    )
    nextSubItems.splice(atIndex, 0, converted)
    onChange({ ...draft, subItems: nextSubItems })
    setExpandedSubId(converted.id)
  }

  const hasSubItems = draft.subItems.length > 0
  const selectedSubItems = draft.subItems.filter((sub) => sub.selected)
  const totalWeight = roundAmount(
    toNumber(draft.weight) + selectedSubItems.reduce((sum, sub) => sum + subItemTotals(sub).weight, 0),
  )
  const totalCalories = roundAmount(
    toNumber(draft.calories) + selectedSubItems.reduce((sum, sub) => sum + subItemTotals(sub).calories, 0),
  )
  const totalProtein = roundAmount(
    toNumber(draft.protein) + selectedSubItems.reduce((sum, sub) => sum + subItemTotals(sub).protein, 0),
  )

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setPreview(URL.createObjectURL(file))
    setUploadError(false)
    setUploading(true)
    try {
      const url = await uploadToCloudinary(file)
      onChange({ ...draft, imageUrl: url })
      onImageUploaded(itemId, url)
    } catch {
      setUploadError(true)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className={`dialog-backdrop${closing ? ' is-closing' : ''}`} {...backdropProps}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="food-modal-title"
        className={`dialog${closing ? ' is-closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          if (e.nativeEvent.isComposing) return
          e.preventDefault()
          handleSaveClick()
        }}
      >
        <div className="dialog-header">
          <div className="dialog-title" id="food-modal-title">{isEditing ? '編輯紀錄' : '新增紀錄'}</div>
          <button type="button" className="dialog-close" aria-label="關閉" onClick={onCancel}>
            <X size={20} />
          </button>
        </div>

        <div className="food-modal-photo-row" onClick={() => fileInputRef.current?.click()}>
          <div className="food-modal-photo">
            {preview ? <img src={preview} alt="食物照片預覽" /> : <Camera size={22} strokeWidth={1.8} />}
          </div>
          {uploading && <span className="photo-upload-label">上傳中…</span>}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
        {uploadError && <div className="upload-error">照片上傳失敗，請重試</div>}

        <div className="field">
          <label htmlFor="food-name">食物名稱</label>
          <input
            id="food-name"
            className="input"
            autoFocus
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="例如：雞胸肉"
          />
        </div>

        <div className="number-fields">
          <div className="field">
            <label htmlFor="food-calories">熱量 (kcal){hasSubItems && ' 自動加總'}</label>
            <input
              id="food-calories"
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              value={hasSubItems ? totalCalories : draft.calories}
              disabled={hasSubItems}
              onChange={(e) => onChange({ ...draft, calories: clampNonNegative(e.target.value) })}
              placeholder="0"
            />
          </div>
          <div className="field">
            <label htmlFor="food-protein">蛋白質 (g){hasSubItems && ' 自動加總'}</label>
            <input
              id="food-protein"
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              value={hasSubItems ? totalProtein : draft.protein}
              disabled={hasSubItems}
              onChange={(e) => onChange({ ...draft, protein: clampNonNegative(e.target.value) })}
              placeholder="0"
            />
          </div>
          <div className="field">
            <label htmlFor="food-weight">重量 (g){hasSubItems && ' 自動加總'}</label>
            <input
              id="food-weight"
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              value={hasSubItems ? totalWeight : draft.weight}
              disabled={hasSubItems}
              onChange={(e) => onChange({ ...draft, weight: clampNonNegative(e.target.value) })}
              placeholder="0"
            />
          </div>
        </div>

        <div className="dialog-divider" />

        <div className="sub-items-section">
          {hasSubItems ? (
            <div className="sub-items-header">
              <span>子項目 勾選要計入加總的項目</span>
              <button type="button" className="btn-ghost btn-add-subitem" onClick={addSubItem}>
                <Plus size={14} />
                新增子項目
              </button>
            </div>
          ) : (
            <button type="button" className="btn-add-subitem-row" onClick={addSubItem}>
              <Plus size={14} />
              新增子項目
            </button>
          )}

          {draft.subItems.length > 0 && (
            <div
              className={`sub-items${convertTarget?.kind === 'toSubItem' ? ' is-convert-target' : ''}`}
              ref={subItemsRef}
            >
              {draft.subItems.map((sub) => {
                const subTotals = subItemTotals(sub)
                const expanded = expandedSubId === sub.id
                return (
                  <div
                    className={`sub-item-row${sub.selected ? '' : ' is-excluded'}${sub.id === draggingSubItemId ? ' is-dragging' : ''}${expanded ? ' is-expanded' : ''}`}
                    key={sub.id}
                    data-sub-item-id={sub.id}
                  >
                    <div
                      className="sub-item-row-top"
                      role="button"
                      tabIndex={0}
                      aria-expanded={expanded}
                      onClick={() => setExpandedSubId((current) => (current === sub.id ? null : sub.id))}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault()
                        setExpandedSubId((current) => (current === sub.id ? null : sub.id))
                      }}
                    >
                      <button
                        type="button"
                        className="sub-item-grip"
                        aria-label="拖曳排序子項目"
                        onPointerDown={(e) => handleSubItemGripDown(e, sub.id)}
                        onPointerMove={handleSubItemGripMove}
                        onPointerUp={handleSubItemGripUp}
                        onPointerCancel={handleSubItemGripUp}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GripVertical size={14} />
                      </button>
                      <label className="checkbox-tap-area" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="sub-item-checkbox"
                          aria-label={sub.selected ? '取消計入加總' : '計入加總'}
                          checked={sub.selected}
                          onChange={(e) => selectSubItem(sub.id, e.target.checked)}
                        />
                      </label>
                      <div className="sub-item-row-summary">
                        <div className="sub-item-row-name">{sub.name.trim() || '子項目'}</div>
                        {!expanded && (
                          <div className="sub-item-row-collapsed-stats">
                            {sub.selected
                              ? `${formatAmount(subTotals.calories)} kcal ${formatAmount(subTotals.protein)} g`
                              : '未計入加總'}
                          </div>
                        )}
                      </div>
                      {subTotals.qty !== 1 && <span className="sub-item-qty-badge">×{formatAmount(subTotals.qty)}</span>}
                      <button
                        type="button"
                        className="sub-item-remove"
                        aria-label="刪除子項目"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeSubItem(sub.id)
                        }}
                      >
                        <X size={14} />
                      </button>
                      <ChevronDown size={14} className="sub-item-chevron" />
                    </div>
                    {expanded && (
                    <div className="sub-item-row-expanded" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="input"
                      value={sub.name}
                      onChange={(e) => updateSubItem(sub.id, { name: e.target.value })}
                      placeholder="例如：加鯛魚"
                      autoFocus
                    />
                    <div className="sub-item-row-numbers">
                      <div className="input-unit-field">
                        <input
                          className="input"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          value={subTotals.hasIngredients ? subTotals.weight : sub.weight}
                          disabled={subTotals.hasIngredients}
                          onChange={(e) => updateSubItem(sub.id, { weight: clampNonNegative(e.target.value) })}
                          placeholder={subTotals.qty !== 1 ? '每份重量' : '重量'}
                        />
                        <span className="input-unit">g</span>
                      </div>
                      <div className="input-unit-field">
                        <input
                          className="input"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          value={subTotals.hasIngredients ? subTotals.calories : sub.calories}
                          disabled={subTotals.hasIngredients}
                          onChange={(e) => updateSubItem(sub.id, { calories: clampNonNegative(e.target.value) })}
                          placeholder={subTotals.qty !== 1 ? '每份熱量' : '熱量'}
                        />
                        <span className="input-unit">kcal</span>
                      </div>
                      <div className="input-unit-field">
                        <input
                          className="input"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          value={subTotals.hasIngredients ? subTotals.protein : sub.protein}
                          disabled={subTotals.hasIngredients}
                          onChange={(e) => updateSubItem(sub.id, { protein: clampNonNegative(e.target.value) })}
                          placeholder={subTotals.qty !== 1 ? '每份蛋白質' : '蛋白質'}
                        />
                        <span className="input-unit">g</span>
                      </div>
                    </div>
                    <div className="sub-item-qty-wrap" title="份數（幾份）">
                      <span className="sub-item-qty-x">×</span>
                      <input
                        className="input sub-item-qty"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.5"
                        value={sub.qty}
                        onChange={(e) => updateSubItem(sub.id, { qty: clampNonNegative(e.target.value) })}
                        aria-label="份數"
                      />
                    </div>
                    {subTotals.qty !== 1 && (
                      <div className="sub-item-qty-hint">
                        × {formatAmount(subTotals.qty)} ＝ {formatAmount(subTotals.weight)}g
                        {formatAmount(subTotals.calories)}kcal {formatAmount(subTotals.protein)}g
                      </div>
                    )}

                    <div
                      className={`ingredients-section${convertTarget?.kind === 'toIngredient' && convertTarget.subId === sub.id ? ' is-convert-target' : ''}`}
                      ref={(el) => {
                        if (el) ingredientContainersRef.current.set(sub.id, el)
                        else ingredientContainersRef.current.delete(sub.id)
                      }}
                    >
                      <div className="ingredients-header">
                        <span>成分 勾選要計入加總的項目</span>
                        <button
                          type="button"
                          className="btn-ghost btn-add-ingredient"
                          onClick={() => addIngredient(sub.id)}
                        >
                          <Plus size={12} />
                          新增成分
                        </button>
                      </div>
                      {(sub.ingredients?.length ?? 0) > 0 ? (
                        <div className="ingredients">
                          {sub.ingredients!.map((ing) => (
                            <div
                              className={`ingredient-row${ing.selected ? '' : ' is-excluded'}${ing.id === draggingIngredientId ? ' is-dragging' : ''}`}
                              key={ing.id}
                              data-ingredient-id={ing.id}
                            >
                              <div className="ingredient-row-top">
                                <button
                                  type="button"
                                  className="ingredient-grip"
                                  aria-label="拖曳排序成分"
                                  onPointerDown={(e) => handleIngredientGripDown(e, sub.id, ing.id)}
                                  onPointerMove={handleIngredientGripMove}
                                  onPointerUp={handleIngredientGripUp}
                                  onPointerCancel={handleIngredientGripUp}
                                >
                                  <GripVertical size={12} />
                                </button>
                                <label className="checkbox-tap-area">
                                  <input
                                    type="checkbox"
                                    className="sub-item-checkbox"
                                    aria-label={ing.selected ? '取消計入加總' : '計入加總'}
                                    checked={ing.selected}
                                    onChange={(e) => selectIngredient(sub.id, ing.id, e.target.checked)}
                                  />
                                </label>
                                <input
                                  className="input"
                                  value={ing.name}
                                  onChange={(e) => updateIngredient(sub.id, ing.id, { name: e.target.value })}
                                  placeholder="例如：鐵板麵"
                                />
                                <div className="sub-item-qty-wrap" title="份數（幾份）">
                                  <span className="sub-item-qty-x">×</span>
                                  <input
                                    className="input sub-item-qty"
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    step="1"
                                    value={ing.qty}
                                    onChange={(e) =>
                                      updateIngredient(sub.id, ing.id, { qty: clampNonNegative(e.target.value) })
                                    }
                                    aria-label="份數"
                                  />
                                </div>
                                <button
                                  type="button"
                                  className="sub-item-remove"
                                  aria-label="刪除成分"
                                  onClick={() => removeIngredient(sub.id, ing.id)}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                              <div className="ingredient-row-numbers">
                                <div className="input-unit-field">
                                  <input
                                    className="input"
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    value={ing.weight}
                                    onChange={(e) =>
                                      updateIngredient(sub.id, ing.id, { weight: clampNonNegative(e.target.value) })
                                    }
                                    placeholder={toNumber(ing.qty) !== 1 ? '每份重量' : '重量'}
                                  />
                                  <span className="input-unit">g</span>
                                </div>
                                <div className="input-unit-field">
                                  <input
                                    className="input"
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    value={ing.calories}
                                    onChange={(e) =>
                                      updateIngredient(sub.id, ing.id, { calories: clampNonNegative(e.target.value) })
                                    }
                                    placeholder={toNumber(ing.qty) !== 1 ? '每份熱量' : '熱量'}
                                  />
                                  <span className="input-unit">kcal</span>
                                </div>
                                <div className="input-unit-field">
                                  <input
                                    className="input"
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    value={ing.protein}
                                    onChange={(e) =>
                                      updateIngredient(sub.id, ing.id, { protein: clampNonNegative(e.target.value) })
                                    }
                                    placeholder={toNumber(ing.qty) !== 1 ? '每份蛋白質' : '蛋白質'}
                                  />
                                  <span className="input-unit">g</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        convertTarget?.kind === 'toIngredient' &&
                        convertTarget.subId === sub.id && <div className="ingredients-empty-hint">拖放到這裡變成成分</div>
                      )}
                    </div>
                    </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="dialog-actions space-between">
          <div>
            {isEditing && (
              confirmDelete ? (
                <div className="delete-confirm-inline">
                  <span>確定刪除？</span>
                  <button type="button" className="btn-delete-text" onClick={onDelete}>
                    刪除
                  </button>
                  <button type="button" className="btn-delete-cancel" onClick={() => setConfirmDelete(false)}>
                    取消
                  </button>
                </div>
              ) : (
                <button type="button" className="btn-delete-text" onClick={() => setConfirmDelete(true)}>
                  刪除紀錄
                </button>
              )
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            {saveState === 'error' && <div className="upload-error">儲存失敗，請確認網路連線後重試</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={onCancel}>
                取消
              </button>
              {saveState === 'idle' || saveState === 'error' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={draft.name.trim().length === 0}
                  onClick={handleSaveClick}
                >
                  {saveState === 'error' ? '重試' : '儲存'}
                </button>
              ) : saveState === 'saving' ? (
                <button type="button" className="btn btn-primary" disabled>
                  儲存中…
                </button>
              ) : (
                <button type="button" className="btn btn-primary" disabled>
                  <Check size={16} className="save-success-icon" strokeWidth={3} />
                  已儲存
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
