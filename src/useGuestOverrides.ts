import { useEffect, useState } from 'react'
import type { IngredientOverrides, SubItemOverrides } from './types'

// Guests (read-only viewers) can still adjust sub-item qty and toggle
// ingredients for themselves, same as an owner would, but they can't write to
// the shared record — so their changes live only in this browser's
// localStorage, layered on top of the real data.
const STORAGE_KEY = 'foodbook-guest-subitem-overrides'
const INGREDIENT_STORAGE_KEY = 'foodbook-guest-ingredient-overrides'

type OverrideMap = Record<string, SubItemOverrides>
type IngredientOverrideMap = Record<string, IngredientOverrides>

function readStored<T>(key: string): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : ({} as T)
  } catch {
    return {} as T
  }
}

export function useGuestOverrides() {
  const [overrides, setOverrides] = useState<OverrideMap>(() => readStored(STORAGE_KEY))
  const [ingredientOverrides, setIngredientOverrides] = useState<IngredientOverrideMap>(() =>
    readStored(INGREDIENT_STORAGE_KEY),
  )

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  }, [overrides])

  useEffect(() => {
    localStorage.setItem(INGREDIENT_STORAGE_KEY, JSON.stringify(ingredientOverrides))
  }, [ingredientOverrides])

  const setQty = (itemId: string, subId: string, qty: number) => {
    setOverrides((prev) => {
      const itemOverrides = prev[itemId] ?? {}
      return { ...prev, [itemId]: { ...itemOverrides, [subId]: qty } }
    })
  }

  const setIngredientQty = (itemId: string, ingredientId: string, qty: number) => {
    setIngredientOverrides((prev) => {
      const itemOverrides = prev[itemId] ?? {}
      return { ...prev, [itemId]: { ...itemOverrides, [ingredientId]: qty } }
    })
  }

  return { overrides, ingredientOverrides, setQty, setIngredientQty }
}
