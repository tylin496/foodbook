// An ingredient nested under a sub-item — a fixed component (like "鐵板麵"
// belonging to "沙朗牛排") that's always counted whenever its parent is, so it
// carries no selected flag of its own.
export interface FoodIngredient {
  id: string
  name: string
  weight: number
  protein: number
  calories: number
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
}

export type FoodIngredientDraft = {
  id: string
  name: string
  weight: string
  protein: string
  calories: string
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

// A guest's local sub-item toggles never touch the shared record — this is the
// per-item override map (subId -> selected) layered on top of it for display/totals.
export type SubItemOverrides = Record<string, boolean>

export function isSubItemSelected(sub: FoodSubItem, overrides?: SubItemOverrides): boolean {
  return (overrides?.[sub.id] ?? sub.selected) !== false
}

function sumIngredients(ingredients?: FoodIngredient[]): {
  weight: number
  protein: number
  calories: number
} {
  return (ingredients ?? []).reduce(
    (acc, ing) => ({
      weight: acc.weight + ing.weight,
      protein: acc.protein + ing.protein,
      calories: acc.calories + ing.calories,
    }),
    { weight: 0, protein: 0, calories: 0 },
  )
}

// A sub-item's own total folds in its ingredients — excluding the sub-item
// (via selected/overrides) drops its ingredients along with it.
export function getSubItemTotals(sub: FoodSubItem): { weight: number; protein: number; calories: number } {
  const ingredientTotals = sumIngredients(sub.ingredients)
  const qty = sub.qty ?? 1
  return {
    weight: (sub.weight + ingredientTotals.weight) * qty,
    protein: (sub.protein + ingredientTotals.protein) * qty,
    calories: (sub.calories + ingredientTotals.calories) * qty,
  }
}

export function getFoodTotals(
  item: FoodItem,
  overrides?: SubItemOverrides,
): { weight: number; protein: number; calories: number } {
  const subItems = (item.subItems ?? []).filter((sub) => isSubItemSelected(sub, overrides))
  return subItems.reduce(
    (acc, sub) => {
      const subTotals = getSubItemTotals(sub)
      return {
        weight: acc.weight + subTotals.weight,
        protein: acc.protein + subTotals.protein,
        calories: acc.calories + subTotals.calories,
      }
    },
    { weight: item.weight, protein: item.protein, calories: item.calories },
  )
}
