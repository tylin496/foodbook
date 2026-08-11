import type { FoodItem, IngredientOverrides, SubItemOverrides } from './types'
import { getFoodTotals, getSubItemTotals } from './types'

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

    lines.push(item.name)
    lines.push(`   ${formatAmount(totals.weight)}g`)
    lines.push(`   ${formatAmount(totals.calories)}kcal / ${formatAmount(totals.protein)}g`)
    for (const sub of item.subItems ?? []) {
      const subTotals = getSubItemTotals(sub)
      const qty = sub.qty ?? 1
      lines.push(`   - ${formatSubItemName(sub)}：${formatAmount(subTotals.weight)}g`)
      lines.push(`     ${formatAmount(subTotals.calories)}kcal / ${formatAmount(subTotals.protein)}g`)
      for (const ing of sub.ingredients ?? []) {
        lines.push(`     · ${ing.name}：${formatAmount(ing.weight * qty)}g`)
        lines.push(`       ${formatAmount(ing.calories * qty)}kcal / ${formatAmount(ing.protein * qty)}g`)
      }
    }
  })

  return lines.join('\n')
}
