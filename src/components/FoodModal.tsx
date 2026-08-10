import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Camera, Check, GripVertical, Plus, X } from 'lucide-react'
import type { FoodDraft, FoodIngredientDraft, FoodSubItemDraft } from '../types'
import { uploadToCloudinary } from '../cloudinary'
import { useDialogDismiss } from '../useDialogDismiss'
import { formatAmount, generateId, roundAmount, toNumber } from '../utils'

interface FoodModalProps {
  itemId: string
  draft: FoodDraft
  isEditing: boolean
  closing: boolean
  onChange: (draft: FoodDraft) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  onImageUploaded: (id: string, url: string) => void
  mergeCandidateCount: number
  onMerge: () => void
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
  mergeCandidateCount,
  onMerge,
}: FoodModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(draft.imageUrl)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'success'>('idle')
  const saveTimerRef = useRef<number | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  useEffect(() => {
    return () => {
      // If the modal gets dismissed another way (Escape, backdrop, X button)
      // while the success checkmark is still playing, don't drop the save
      // that already showed as "done" — flush it instead of cancelling it.
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        onSaveRef.current()
      }
    }
  }, [])

  const backdropProps = useDialogDismiss(onCancel)

  const handleSaveClick = () => {
    if (draft.name.trim().length === 0 || saveState === 'success') return
    setSaveState('success')
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      onSaveRef.current()
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
      return
    }

    onChange({ ...draft, subItems: [...draft.subItems, newSubItem] })
  }

  const updateSubItem = (id: string, patch: Partial<FoodSubItemDraft>) => {
    onChange({
      ...draft,
      subItems: draft.subItems.map((sub) => (sub.id === id ? { ...sub, ...patch } : sub)),
    })
  }

  const selectSubItem = (id: string, selected: boolean) => {
    updateSubItem(id, { selected })
  }

  const removeSubItem = (id: string) => {
    onChange({ ...draft, subItems: draft.subItems.filter((sub) => sub.id !== id) })
  }

  // Ingredients belong entirely to their sub-item (e.g. "鐵板麵" under "沙朗牛排"):
  // always counted whenever the sub-item is, with no checkbox of their own.
  const addIngredient = (subId: string) => {
    const sub = draft.subItems.find((s) => s.id === subId)
    if (!sub) return
    const ingredients = sub.ingredients ?? []
    const newIngredient: FoodIngredientDraft = { id: generateId(), name: '', weight: '', protein: '', calories: '' }

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

  const removeIngredient = (subId: string, ingredientId: string) => {
    const sub = draft.subItems.find((s) => s.id === subId)
    if (!sub) return
    updateSubItem(subId, { ingredients: (sub.ingredients ?? []).filter((ing) => ing.id !== ingredientId) })
  }

  const subItemTotals = (sub: FoodSubItemDraft) => {
    const ingredients = sub.ingredients ?? []
    const hasIngredients = ingredients.length > 0
    const qty = toNumber(sub.qty) || 1
    const baseWeight = toNumber(sub.weight) + ingredients.reduce((sum, ing) => sum + toNumber(ing.weight), 0)
    const baseCalories = toNumber(sub.calories) + ingredients.reduce((sum, ing) => sum + toNumber(ing.calories), 0)
    const baseProtein = toNumber(sub.protein) + ingredients.reduce((sum, ing) => sum + toNumber(ing.protein), 0)
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
    dragMetaRef.current = null
    setDraggingSubItemId(null)
  }

  useEffect(() => {
    return () => stopSubItemSpringLoop()
  }, [])

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
        className={`dialog${closing ? ' is-closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          if (e.nativeEvent.isComposing) return
          const target = e.target as HTMLElement
          if (target.tagName === 'TEXTAREA') return
          e.preventDefault()
          handleSaveClick()
        }}
      >
        <div className="dialog-header">
          <div className="dialog-title">{isEditing ? '編輯紀錄' : '新增紀錄'}</div>
          <button type="button" className="dialog-close" aria-label="關閉" onClick={onCancel}>
            <X size={20} />
          </button>
        </div>

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
            <label htmlFor="food-calories">熱量 (kcal){hasSubItems && '・自動加總'}</label>
            <input
              id="food-calories"
              className="input"
              type="number"
              inputMode="decimal"
              value={hasSubItems ? totalCalories : draft.calories}
              disabled={hasSubItems}
              onChange={(e) => onChange({ ...draft, calories: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="field">
            <label htmlFor="food-protein">蛋白質 (g){hasSubItems && '・自動加總'}</label>
            <input
              id="food-protein"
              className="input"
              type="number"
              inputMode="decimal"
              value={hasSubItems ? totalProtein : draft.protein}
              disabled={hasSubItems}
              onChange={(e) => onChange({ ...draft, protein: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="field">
            <label htmlFor="food-weight">重量 (g){hasSubItems && '・自動加總'}</label>
            <input
              id="food-weight"
              className="input"
              type="number"
              inputMode="decimal"
              value={hasSubItems ? totalWeight : draft.weight}
              disabled={hasSubItems}
              onChange={(e) => onChange({ ...draft, weight: e.target.value })}
              placeholder="0"
            />
          </div>
        </div>

        <div className="photo-upload-row" onClick={() => fileInputRef.current?.click()}>
          <div className="photo-upload-thumb">
            {preview ? <img src={preview} alt="食物照片預覽" /> : <Camera size={18} strokeWidth={1.8} />}
          </div>
          <span className="photo-upload-label">
            {uploading ? '上傳中…' : preview ? '更換照片' : '加一張照片・選填'}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
        {uploadError && (
          <div style={{ color: 'var(--color-accent)', fontSize: 12, marginTop: -8 }}>
            照片上傳失敗，請重試
          </div>
        )}

        {isEditing && mergeCandidateCount > 0 && (
          <div className="merge-hint">
            <span>已選取 {mergeCandidateCount} 項</span>
            <button type="button" className="btn-ghost" onClick={onMerge}>
              合併為子項目
            </button>
          </div>
        )}

        <div className="sub-items-section">
          {hasSubItems ? (
            <div className="sub-items-header">
              <span>子項目・勾選要計入加總的項目</span>
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
            <div className="sub-items" ref={subItemsRef}>
              {draft.subItems.map((sub) => {
                const subTotals = subItemTotals(sub)
                return (
                  <div
                    className={`sub-item-row${sub.selected ? '' : ' is-excluded'}${sub.id === draggingSubItemId ? ' is-dragging' : ''}`}
                    key={sub.id}
                    data-sub-item-id={sub.id}
                  >
                    <div className="sub-item-row-top">
                      <button
                        type="button"
                        className="sub-item-grip"
                        aria-label="拖曳排序子項目"
                        onPointerDown={(e) => handleSubItemGripDown(e, sub.id)}
                        onPointerMove={handleSubItemGripMove}
                        onPointerUp={handleSubItemGripUp}
                        onPointerCancel={handleSubItemGripUp}
                      >
                        <GripVertical size={14} />
                      </button>
                      <input
                        type="checkbox"
                        className="sub-item-checkbox"
                        aria-label={sub.selected ? '取消計入加總' : '計入加總'}
                        checked={sub.selected}
                        onChange={(e) => selectSubItem(sub.id, e.target.checked)}
                      />
                      <input
                        className="input"
                        value={sub.name}
                        onChange={(e) => updateSubItem(sub.id, { name: e.target.value })}
                        placeholder="例如：加鯛魚"
                      />
                      <div className="sub-item-qty-wrap" title="份數（幾份）">
                        <span className="sub-item-qty-x">×</span>
                        <input
                          className="input sub-item-qty"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.5"
                          value={sub.qty}
                          onChange={(e) => updateSubItem(sub.id, { qty: e.target.value })}
                          aria-label="份數"
                        />
                      </div>
                      <button
                        type="button"
                        className="sub-item-remove"
                        aria-label="刪除子項目"
                        onClick={() => removeSubItem(sub.id)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="sub-item-row-numbers">
                      <input
                        className="input"
                        type="number"
                        inputMode="decimal"
                        value={subTotals.hasIngredients ? subTotals.weight : sub.weight}
                        disabled={subTotals.hasIngredients}
                        onChange={(e) => updateSubItem(sub.id, { weight: e.target.value })}
                        placeholder={subTotals.qty !== 1 ? '每份重量 (g)' : '重量 (g)'}
                      />
                      <input
                        className="input"
                        type="number"
                        inputMode="decimal"
                        value={subTotals.hasIngredients ? subTotals.calories : sub.calories}
                        disabled={subTotals.hasIngredients}
                        onChange={(e) => updateSubItem(sub.id, { calories: e.target.value })}
                        placeholder={subTotals.qty !== 1 ? '每份熱量 (kcal)' : '熱量 (kcal)'}
                      />
                      <input
                        className="input"
                        type="number"
                        inputMode="decimal"
                        value={subTotals.hasIngredients ? subTotals.protein : sub.protein}
                        disabled={subTotals.hasIngredients}
                        onChange={(e) => updateSubItem(sub.id, { protein: e.target.value })}
                        placeholder={subTotals.qty !== 1 ? '每份蛋白質 (g)' : '蛋白質 (g)'}
                      />
                    </div>
                    {subTotals.qty !== 1 && (
                      <div className="sub-item-qty-hint">
                        × {formatAmount(subTotals.qty)} ＝ {formatAmount(subTotals.weight)}g・
                        {formatAmount(subTotals.calories)}kcal・{formatAmount(subTotals.protein)}g
                      </div>
                    )}

                    <div className="ingredients-section">
                      <div className="ingredients-header">
                        <span>成分・一定計入{sub.name.trim() || '此項目'}</span>
                        <button
                          type="button"
                          className="btn-ghost btn-add-ingredient"
                          onClick={() => addIngredient(sub.id)}
                        >
                          <Plus size={12} />
                          新增成分
                        </button>
                      </div>
                      {(sub.ingredients?.length ?? 0) > 0 && (
                        <div className="ingredients">
                          {sub.ingredients!.map((ing) => (
                            <div className="ingredient-row" key={ing.id}>
                              <div className="ingredient-row-top">
                                <input
                                  className="input"
                                  value={ing.name}
                                  onChange={(e) => updateIngredient(sub.id, ing.id, { name: e.target.value })}
                                  placeholder="例如：鐵板麵"
                                />
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
                                <input
                                  className="input"
                                  type="number"
                                  inputMode="decimal"
                                  value={ing.weight}
                                  onChange={(e) => updateIngredient(sub.id, ing.id, { weight: e.target.value })}
                                  placeholder="重量 (g)"
                                />
                                <input
                                  className="input"
                                  type="number"
                                  inputMode="decimal"
                                  value={ing.calories}
                                  onChange={(e) => updateIngredient(sub.id, ing.id, { calories: e.target.value })}
                                  placeholder="熱量 (kcal)"
                                />
                                <input
                                  className="input"
                                  type="number"
                                  inputMode="decimal"
                                  value={ing.protein}
                                  onChange={(e) => updateIngredient(sub.id, ing.id, { protein: e.target.value })}
                                  placeholder="蛋白質 (g)"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="dialog-actions space-between">
          <div>
            {isEditing && (
              <button type="button" className="btn-delete-text" onClick={onDelete}>
                刪除
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              取消
            </button>
            {saveState === 'idle' ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={draft.name.trim().length === 0}
                onClick={handleSaveClick}
              >
                儲存
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
  )
}
