import { useCallback, useEffect, useRef, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { FoodItem } from './types'

const LOCAL_KEY = 'food-diary:items'

function readLocalCache(): FoodItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return raw ? (JSON.parse(raw) as FoodItem[]) : []
  } catch {
    return []
  }
}

function writeLocalCache(items: FoodItem[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items))
  } catch {
    // storage full or unavailable — Firestore remains source of truth
  }
}

function itemsDocRef(uid: string) {
  return doc(db, 'users', uid, 'data', 'foodItems')
}

/**
 * Mirrors the [value, setValue] shape of useLocalStorage, but backs onto a
 * single Firestore document per user so data survives cleared browser storage
 * and syncs across devices. localStorage is kept as an offline read cache.
 */
export function useCloudItems(uid: string) {
  const [items, setItemsState] = useState<FoodItem[]>(() => readLocalCache())
  const [loading, setLoading] = useState(true)
  const migratedRef = useRef(false)
  // Chains setDoc calls so they hit Firestore in call order. Without this,
  // two writes fired close together race on the network and whichever
  // response lands last wins — silently reverting a newer save with a
  // stale one even though both promises resolve { ok: true }.
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    setLoading(true)
    migratedRef.current = false
    writeQueueRef.current = Promise.resolve()
    const ref = itemsDocRef(uid)
    const unsubscribe = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const remote = (snap.data().items ?? []) as FoodItem[]
        setItemsState(remote)
        writeLocalCache(remote)
      } else if (!migratedRef.current) {
        // First time this account signs in: carry over whatever is already
        // sitting in this browser's localStorage instead of starting empty.
        migratedRef.current = true
        const local = readLocalCache()
        setDoc(ref, { items: local }).catch(() => {
          // not signed in as the owner — nothing to migrate on this visit
        })
      }
      setLoading(false)
    })
    return unsubscribe
  }, [uid])

  // Resolves with { ok: false } on a real write failure (permission denied,
  // quota, etc.) so callers that care — e.g. the save button's success state
  // — can tell that apart from being merely offline. Never rejects: callers
  // that fire-and-forget (selection toggles, drag reorder, ...) can keep
  // ignoring the returned promise exactly as they ignored the old void return.
  const setItems = useCallback(
    (next: FoodItem[] | ((prev: FoodItem[]) => FoodItem[])): Promise<{ ok: boolean }> => {
      return new Promise((resolve) => {
        setItemsState((prev) => {
          const resolved = typeof next === 'function' ? (next as (prev: FoodItem[]) => FoodItem[])(prev) : next
          writeLocalCache(resolved)
          writeQueueRef.current = writeQueueRef.current.then(() =>
            setDoc(itemsDocRef(uid), { items: resolved }).then(
              () => resolve({ ok: true }),
              (err) => {
                // Offline writes queue locally and resync once reconnected —
                // that's still a success. Anything else is a real failure.
                resolve({ ok: err?.code === 'unavailable' })
              },
            ),
          )
          return resolved
        })
      })
    },
    [uid],
  )

  return [items, setItems, loading] as const
}
