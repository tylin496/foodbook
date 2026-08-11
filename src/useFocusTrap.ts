import { useEffect, useRef } from 'react'
import { createDialogStack } from './dialogStack'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'

// One stack shared by every useFocusTrap instance (not by useDialogDismiss's
// — see dialogStack.ts for why each concern needs its own).
const trapStack = createDialogStack()

// Keeps Tab/Shift+Tab cycling inside the dialog while `active`, moves focus in
// on open (unless something inside already grabbed it, e.g. autoFocus), and
// returns focus to whatever triggered the dialog on close — behaviour the
// plain-div dialogs here don't get for free from the browser.
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const trapIdRef = useRef<symbol | null>(null)

  useEffect(() => {
    if (!active) return
    const id = trapStack.push()
    trapIdRef.current = id
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null
    const container = containerRef.current
    if (container && !container.contains(document.activeElement)) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(first ?? container).focus()
    }
    return () => {
      trapStack.pop(id)
      trapIdRef.current = null
      previouslyFocusedRef.current?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      // A confirm prompt can trap Tab on top of another dialog (deleting a
      // sub-item from inside the edit modal) — only the topmost one should
      // cycle focus, or the outer dialog yanks focus back on every press.
      if (!trapIdRef.current || !trapStack.isTop(trapIdRef.current)) return
      const container = containerRef.current
      if (!container) return
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      } else if (!container.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
