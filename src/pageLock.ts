// While any dialog is open the page behind it must stop being a page: it
// shouldn't scroll under the finger, and it shouldn't still be reachable by a
// screen reader's virtual cursor or the iOS rotor. useFocusTrap only holds
// Tab — everything else walked straight past it.
//
// Refcounted, because dialogs nest (a confirm prompt over the edit modal, or
// over the sub-items sheet): the page only comes back when the last one goes.
//
// Scoped to .page-scroll / .selection-bar rather than #root, because two of
// the dialogs (FoodModal, SubwayScreen) render inside the same React tree —
// inert on #root would disable the dialog along with the page.
const PAGE_SELECTOR = '.page-scroll, .selection-bar'

let depth = 0

function apply(locked: boolean) {
  document.documentElement.classList.toggle('has-dialog', locked)
  document.querySelectorAll<HTMLElement>(PAGE_SELECTOR).forEach((el) => {
    // `inert` also removes the subtree from the a11y tree and blocks pointer
    // events, which is exactly the rest of what "behind a modal" should mean.
    el.inert = locked
  })
}

export function lockPage() {
  depth += 1
  if (depth === 1) apply(true)
}

export function unlockPage() {
  if (depth === 0) return
  depth -= 1
  if (depth === 0) apply(false)
}
