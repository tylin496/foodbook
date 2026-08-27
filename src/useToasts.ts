import { useCallback, useRef, useState } from 'react'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  message: string
  action?: ToastAction
  /** Set by `toast()` from the message, so a repeat replaces rather than stacks. */
  key: string
}

const PLAIN_MS = 3200
// Long enough to actually be used, not so long it outlives the moment.
const ACTION_MS = 6000

/**
 * The app had no way to say anything that wasn't a dialog. Three things needed
 * one and were silently going unsaid: a write that didn't reach Firestore, a
 * long press that can't reorder because a sort mode is on, and a delete with
 * no way back.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef<Map<number, number>>(new Map())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, action?: ToastAction) => {
      const id = nextId.current++
      const key = action ? `action:${id}` : `plain:${message}`
      setToasts((prev) => [...prev.filter((t) => t.key !== key), { id, message, action, key }])
      timers.current.set(
        id,
        window.setTimeout(() => {
          timers.current.delete(id)
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }, action ? ACTION_MS : PLAIN_MS),
      )
      return id
    },
    [],
  )

  return { toasts, toast, dismiss }
}
