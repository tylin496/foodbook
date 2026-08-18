// An ingredient nested under a sub-item — a fixed component (like "鐵板麵"
// belonging to "沙朗牛排"). Counted whenever its parent is, unless individually
// excluded (e.g. "麵包一片" left off a burger for one meal) — missing/undefined
// `selected` means counted, mirroring FoodSubItem.
export interface FoodIngredient {
  id: string
  name: string
  weight: number
  protein: number
  calories: number
  selected?: boolean
  // How many portions of this ingredient's weight/protein/calories were
  // consumed (e.g. an extra egg, a double portion of steak) — mirrors
  // FoodSubItem.qty. Missing/undefined means 1.
  qty?: number
}

export interface FoodSubItem {
  id: string
  name: string
  weight: number
  protein: number
  calories: number
  selected: boolean
  // How many portions of this sub-item's weight/protein/calories were
  // consumed — those three fields hold the per-portion value, this scales
  // them for totals. Missing/undefined means 1 (all pre-existing records).
  qty?: number
  ingredients?: FoodIngredient[]
}

export interface FoodItem {
  id: string
  name: string
  imageUrl: string | null
  weight: number
  protein: number
  calories: number
  createdAt: number
  subItems?: FoodSubItem[]
  // How many portions of the item's own weight/protein/calories were
  // consumed — mirrors FoodSubItem.qty, but for the item itself rather than
  // one of its sub-items. Missing/undefined means 1.
  qty?: number
}

export type FoodIngredientDraft = {
  id: string
  name: string
  weight: string
  protein: string
  calories: string
  selected: boolean
  qty: string
}

export type FoodSubItemDraft = {
  id: string
  name: string
  weight: string
  protein: string
  calories: string
  selected: boolean
  qty: string
  ingredients?: FoodIngredientDraft[]
}

export type FoodDraft = {
  name: string
  imageUrl: string | null
  weight: string
  protein: string
  calories: string
  subItems: FoodSubItemDraft[]
}

export const emptyDraft: FoodDraft = {
  name: '',
  imageUrl: null,
  weight: '',
  protein: '',
  calories: '',
  subItems: [],
}

// A guest's local sub-item qty changes never touch the shared record — this is
// the per-item override map (subId -> qty) layered on top of it for display/totals.
// A qty of 0 means excluded, mirroring how the owner's own qty field works.
// The item's own base qty (see FoodItem.qty) rides along in the same map under
// this sentinel key, since it's scoped per-item exactly like every subId here
// and a real subId can't collide with it.
export const BASE_QTY_KEY = '__item__'

export type SubItemOverrides = Record<string, number>

export function getEffectiveSubItemQty(sub: FoodSubItem, overrides?: SubItemOverrides): number {
  const overrideQty = overrides?.[sub.id]
  if (overrideQty !== undefined) return overrideQty
  return sub.selected === false ? 0 : (sub.qty ?? 1)
}

// The item's own portions, e.g. ordering 2x steak — unlike a sub-item this
// can't drop to 0 (excluding the whole item is the card's own checkbox), so
// callers should floor it at 1.
export function getEffectiveBaseQty(item: FoodItem, overrides?: SubItemOverrides): number {
  const overrideQty = overrides?.[BASE_QTY_KEY]
  if (overrideQty !== undefined) return overrideQty
  return item.qty ?? 1
}

export function isSubItemSelected(sub: FoodSubItem, overrides?: SubItemOverrides): boolean {
  return getEffectiveSubItemQty(sub, overrides) > 0
}

// A guest's local ingredient qty changes never touch the shared record — this
// is the per-item override map (ingredientId -> qty) layered on top of it for
// display/totals, mirroring SubItemOverrides. A qty of 0 means excluded.
export type IngredientOverrides = Record<string, number>

export function getEffectiveIngredientQty(ing: FoodIngredient, overrides?: IngredientOverrides): number {
  const overrideQty = overrides?.[ing.id]
  if (overrideQty !== undefined) return overrideQty
  return ing.selected === false ? 0 : (ing.qty ?? 1)
}

export function isIngredientSelected(ing: FoodIngredient, overrides?: IngredientOverrides): boolean {
  return getEffectiveIngredientQty(ing, overrides) > 0
}

function sumIngredients(
  ingredients: FoodIngredient[] | undefined,
  overrides?: IngredientOverrides,
): {
  weight: number
  protein: number
  calories: number
} {
  return (ingredients ?? []).reduce(
    (acc, ing) => {
      const qty = getEffectiveIngredientQty(ing, overrides)
      if (qty <= 0) return acc
      return {
        weight: acc.weight + ing.weight * qty,
        protein: acc.protein + ing.protein * qty,
        calories: acc.calories + ing.calories * qty,
      }
    },
    { weight: 0, protein: 0, calories: 0 },
  )
}

// A sub-item's own total folds in its ingredients — excluding the sub-item
// (qty 0) drops its ingredients along with it. `qtyOverride` lets callers
// (e.g. the guest-facing sheet) price out a qty that hasn't been committed
// to `sub.qty` yet.
export function getSubItemTotals(
  sub: FoodSubItem,
  qtyOverride?: number,
  ingredientOverrides?: IngredientOverrides,
): { weight: number; protein: number; calories: number } {
  const ingredientTotals = sumIngredients(sub.ingredients, ingredientOverrides)
  const qty = qtyOverride ?? sub.qty ?? 1
  return {
    weight: (sub.weight + ingredientTotals.weight) * qty,
    protein: (sub.protein + ingredientTotals.protein) * qty,
    calories: (sub.calories + ingredientTotals.calories) * qty,
  }
}

// The item's own portions scale the whole card — its base numbers *and* every
// counted sub-item. Scaling only the base numbers made the ×N a no-op for the
// common card whose values all live in sub-items (base 0).
export function getFoodTotals(
  item: FoodItem,
  overrides?: SubItemOverrides,
  ingredientOverrides?: IngredientOverrides,
): { weight: number; protein: number; calories: number } {
  const subItems = item.subItems ?? []
  const baseQty = getEffectiveBaseQty(item, overrides)
  const onePortion = subItems.reduce(
    (acc, sub) => {
      const qty = getEffectiveSubItemQty(sub, overrides)
      if (qty <= 0) return acc
      const subTotals = getSubItemTotals(sub, qty, ingredientOverrides)
      return {
        weight: acc.weight + subTotals.weight,
        protein: acc.protein + subTotals.protein,
        calories: acc.calories + subTotals.calories,
      }
    },
    { weight: item.weight, protein: item.protein, calories: item.calories },
  )
  return {
    weight: onePortion.weight * baseQty,
    protein: onePortion.protein * baseQty,
    calories: onePortion.calories * baseQty,
  }
}
