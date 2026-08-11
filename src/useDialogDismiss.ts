import { useEffect, useRef } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import { createDialogStack } from './dialogStack'

// One stack shared by every useDialogDismiss instance (not by useFocusTrap's
// — see dialogStack.ts for why each concern needs its own).
const dismissStack = createDialogStack()

// Shared dismiss behaviour for the dialogs: Esc anywhere, or a click on the
// dark backdrop. Returns props to spread onto the `.dialog-backdrop` element.
//
// `active` defaults to true (push on mount, pop on unmount) which is right
// for dialogs that only exist in the DOM while open. SubwayScreen stays
// mounted while hidden (to keep its iframe alive), so it passes its own
// `visible` flag here to push/pop on show/hide instead of mount/unmount —
// otherwise it would occupy a stale slot in the stack from its first open
// onward and never correctly arbitrate topmost-dialog Esc after that.
export function useDialogDismiss(onDismiss: () => void, active = true) {
  // Kept in a ref so the key listener is installed once and still calls the
  // latest handler (the dialogs re-render on every keystroke).
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  const dialogIdRef = useRef<symbol | null>(null)
  useEffect(() => {
    if (!active) return
    const id = dismissStack.push()
    dialogIdRef.current = id
    return () => {
      dismissStack.pop(id)
      dialogIdRef.current = null
    }
  }, [active])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // A confirm prompt can open on top of another dialog (deleting a
      // sub-item from inside the edit modal) — only the topmost one should
      // close on Esc, not both at once.
      if (!dialogIdRef.current || !dismissStack.isTop(dialogIdRef.current)) return
      e.preventDefault()
      dismissRef.current()
    }
    // On document, so Esc works wherever focus happens to sit.
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // A press that starts inside the dialog (e.g. dragging to select text) still
  // fires a click on the backdrop when released out there — only dismiss when
  // both ends of the press were on the backdrop itself.
  const pressStartedOnBackdrop = useRef(false)

  return {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      pressStartedOnBackdrop.current = e.target === e.currentTarget
    },
    onClick: (e: MouseEvent<HTMLDivElement>) => {
      if (!pressStartedOnBackdrop.current || e.target !== e.currentTarget) return
      // A dialog rendered via portal is still a React child of whatever opened
      // it, so this click keeps bubbling through the React tree even though
      // DOM-wise it's on document.body — e.g. into the food-card's own
      // onClick, toggling selection a second time right after onDismiss does.
      e.stopPropagation()
      dismissRef.current()
    },
  }
}
