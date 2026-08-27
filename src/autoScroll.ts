// None of the three drag-to-reorder systems (cards, sub-items, ingredients)
// scrolled their container when the pointer reached its edge. Past one
// screenful that isn't a rough edge, it's a wall: there is no way to drag the
// bottom card to the top, because the grab ends wherever the viewport does.
//
// Runs its own rAF loop rather than reacting to pointermove, so a held-still
// pointer at the edge keeps scrolling. `onTick` lets the caller re-run its
// drop-target check on each of those frames — content is moving under a
// stationary pointer, so the row it's over keeps changing with no pointer
// event to announce it.
const EDGE = 72
const MAX_SPEED = 16

export function createEdgeAutoScroll(onTick?: () => void) {
  let container: HTMLElement | null = null
  let pointerY = 0
  let frame: number | null = null

  const step = () => {
    frame = null
    if (!container) return
    const rect = container.getBoundingClientRect()
    const fromTop = pointerY - rect.top
    const fromBottom = rect.bottom - pointerY
    let delta = 0
    // Ramps with proximity, so easing off the edge slows down instead of
    // stopping dead, and resting just inside it barely creeps.
    if (fromTop < EDGE) delta = -MAX_SPEED * (1 - Math.max(0, fromTop) / EDGE)
    else if (fromBottom < EDGE) delta = MAX_SPEED * (1 - Math.max(0, fromBottom) / EDGE)
    if (delta !== 0) {
      const before = container.scrollTop
      container.scrollBy(0, delta)
      if (container.scrollTop !== before) onTick?.()
    }
    frame = requestAnimationFrame(step)
  }

  return {
    /** Call on every pointermove of a drag; `el` is the scroller to nudge. */
    update(el: HTMLElement | null, clientY: number) {
      container = el
      pointerY = clientY
      if (el && frame === null) frame = requestAnimationFrame(step)
    },
    stop() {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      container = null
    },
  }
}
