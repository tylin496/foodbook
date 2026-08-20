import type { FoodItem, FoodSubItem, IngredientOverrides, SubItemOverrides } from './types'
import {
  getEffectiveBaseQty,
  getEffectiveIngredientQty,
  getEffectiveSubItemQty,
  getFoodTotals,
  getSubItemTotals,
} from './types'

export function formatSubItemName(sub: { name: string; qty?: number }): string {
  const qty = sub.qty ?? 1
  return qty !== 1 ? `${sub.name} ×${formatAmount(qty)}` : sub.name
}

export function toNumber(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// Summing decimal inputs leaves float noise (124.20000000000002); one decimal
// place is also all the precision these values are ever entered with.
export function roundAmount(value: number): number {
  return Math.round(value * 10) / 10
}

export function formatAmount(value: number): string {
  return String(roundAmount(value))
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Keeps checked rows grouped above unchecked ones (stable otherwise) — mirrors
// the move-to-bottom that happens live when a row gets unchecked in the edit
// form, so a record saved with stale ordering doesn't reopen looking wrong.
export function sortBySelected<T extends { selected?: boolean }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.selected !== false) - Number(a.selected !== false))
}

type Totals = { weight: number; protein: number; calories: number }

function sameTotals(a: Totals, b: Totals): boolean {
  return (
    roundAmount(a.weight) === roundAmount(b.weight) &&
    roundAmount(a.calories) === roundAmount(b.calories) &&
    roundAmount(a.protein) === roundAmount(b.protein)
  )
}

export function formatItemsAsText(
  items: FoodItem[],
  overridesByItem?: Record<string, SubItemOverrides>,
  ingredientOverridesByItem?: Record<string, IngredientOverrides>,
): string {
  const lines: string[] = []

  items.forEach((item) => {
    const overrides = overridesByItem?.[item.id]
    const ingredientOverrides = ingredientOverridesByItem?.[item.id]
    const totals = getFoodTotals(item, overrides, ingredientOverrides)
    const subItems = item.subItems ?? []

    const pushIngredients = (sub: FoodSubItem, parentQty: number, indent: string) => {
      for (const ing of sub.ingredients ?? []) {
        const ownQty = getEffectiveIngredientQty(ing, ingredientOverrides)
        const ingQty = (ownQty > 0 ? ownQty : 1) * parentQty
        lines.push(
          `${indent}${ownQty > 0 ? '☑' : '☐'} ${formatSubItemName({ ...ing, qty: ownQty > 0 ? ownQty : 1 })}：${formatAmount(ing.weight * ingQty)}g`,
        )
        lines.push(`${indent}  ${formatAmount(ing.calories * ingQty)}kcal / ${formatAmount(ing.protein * ingQty)}g`)
      }
    }

    // A single counted sub-item that carries the item's whole numbers just
    // restates the two header lines verbatim — fold its name into the item's
    // and let its ingredients (if any) hang straight off the item instead.
    // Child lines are priced at one portion of the item, matching the sheet;
    // only the header lines below carry the item's own 份數, which its ×N names.
    const baseQty = getEffectiveBaseQty(item, overrides)
    const lone = subItems.length === 1 ? subItems[0] : null
    const loneQty = lone ? getEffectiveSubItemQty(lone, overrides) : 0
    const folded =
      lone && loneQty > 0 && sameTotals(getSubItemTotals(lone, loneQty * baseQty, ingredientOverrides), totals)
        ? lone
        : null

    const foldedName = folded && folded.name !== item.name ? formatSubItemName({ ...folded, qty: loneQty }) : null
    // The totals below already carry the item's own portions; without this the
    // doubled numbers would arrive unexplained.
    const itemName = formatSubItemName({ ...item, qty: baseQty })
    lines.push(foldedName ? `${itemName}（${foldedName}）` : itemName)
    lines.push(`   ${formatAmount(totals.weight)}g`)
    lines.push(`   ${formatAmount(totals.calories)}kcal / ${formatAmount(totals.protein)}g`)

    if (folded) {
      pushIngredients(folded, loneQty, '   ')
      return
    }

    for (const sub of subItems) {
      const subQty = getEffectiveSubItemQty(sub, overrides)
      // An excluded row is still worth listing (it's part of the record), but
      // pricing it at qty 0 would print a meaningless "0g / 0kcal" — show one
      // portion instead and let the ☐ say it isn't counted.
      const qty = subQty > 0 ? subQty : 1
      const subTotals = getSubItemTotals(sub, qty, ingredientOverrides)
      lines.push(
        `   ${subQty > 0 ? '☑' : '☐'} ${formatSubItemName({ ...sub, qty })}：${formatAmount(subTotals.weight)}g`,
      )
      lines.push(`     ${formatAmount(subTotals.calories)}kcal / ${formatAmount(subTotals.protein)}g`)
      pushIngredients(sub, qty, '     ')
    }
  })

  return lines.join('\n')
}

// navigator.clipboard exists only on secure origins. Served over plain http —
// which is how the app is reached from a phone on the LAN during development —
// the whole `clipboard` object is undefined, so reaching straight for
// `.writeText` throws before anything after the call can run. Keep the throw
// in here, and fall back to the old textarea + execCommand path so the copy
// still lands on those origins.
export function copyText(text: string): boolean {
  try {
    if (navigator.clipboard?.writeText) {
      // Swallowed, not fallen back on: the rejection (Safari refuses when the
      // document isn't focused) arrives a tick later, by which point the user
      // gesture execCommand needs is spent. Left unhandled it would log an
      // unhandled rejection on every such copy.
      navigator.clipboard.writeText(text).catch(() => {})
      return true
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    // readonly so focusing it can't raise the iOS keyboard, and 1×1 rather
    // than off-screen so scroll position stays put.
    area.setAttribute('readonly', '')
    area.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;opacity:0'
    document.body.appendChild(area)

    // iOS ignores .select() here and copies the document's own selection, so
    // the range has to be set explicitly; .select() after it is what focuses
    // the field everywhere else, which is what execCommand reads from there.
    const range = document.createRange()
    range.selectNodeContents(area)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    area.setSelectionRange(0, text.length)
    area.select()

    const ok = document.execCommand('copy')
    selection?.removeAllRanges()
    area.remove()
    return ok
  } catch {
    return false
  }
}
