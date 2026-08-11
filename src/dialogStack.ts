// Nested dialogs (a confirm prompt opened from inside the edit modal or the
// sub-items sheet) need Esc-dismiss and Tab-focus-trapping to only ever act
// for whichever dialog is topmost. Each concern gets its own independent
// stack via this factory — a dismiss-hook instance and a focus-trap instance
// belonging to the very same dialog push different symbols, so they must not
// share one stack or each would see the other's push as "on top of me".
export function createDialogStack() {
  let stack: symbol[] = []

  return {
    push(): symbol {
      const id = Symbol('dialog')
      stack = [...stack, id]
      return id
    },
    pop(id: symbol) {
      stack = stack.filter((s) => s !== id)
    },
    isTop(id: symbol): boolean {
      return stack.length > 0 && stack[stack.length - 1] === id
    },
  }
}
