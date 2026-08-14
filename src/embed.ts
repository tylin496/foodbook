// Foodbook embedded inside LiftOS — LiftOS's nutrition tab opens this app in an
// iframe so a meal can be totalled here and the numbers handed straight back to
// its intake fields, instead of being read off one screen and retyped into
// another. Same shape as the subway-calculator → Foodbook handoff this app
// already receives (see SubwayScreen): the embedded page posts its running
// selection, the host keeps the latest and applies it when the user commits.
//
// The one deliberate difference: the calculator posts to "*" because it and
// Foodbook share an origin. LiftOS does NOT, so the totals go to an explicit
// allowlisted parent — a wildcard here would hand them to any site that framed
// this page.
const LIFTOS_ORIGIN = 'https://liftos.pages.dev'
// Vite picks the next free port when 5173 is taken, so a dev entry can't be a
// fixed string. Any loopback port is allowed — reaching this page from one
// already means local code on the user's own machine.
const LOCAL_PARENT = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/

function isAllowedParent(origin: string): boolean {
  return origin === LIFTOS_ORIGIN || LOCAL_PARENT.test(origin)
}

export interface EmbedContext {
  parentOrigin: string
  /** LiftOS's theme can be manually overridden, so it can't be inferred from
      prefers-color-scheme here — an override would leave the frame disagreeing
      with the sheet around it. */
  theme: 'light' | 'dark' | null
}

function readEmbedContext(): EmbedContext | null {
  if (typeof window === 'undefined' || window.parent === window) return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('embed') !== 'liftos') return null
  const parentOrigin = params.get('parent') ?? ''
  if (!isAllowedParent(parentOrigin)) return null
  const theme = params.get('theme')
  return { parentOrigin, theme: theme === 'dark' || theme === 'light' ? theme : null }
}

/** Resolved once — neither the URL nor the framing can change without a reload. */
export const embedContext = readEmbedContext()

// Stamped at module load, before first paint, so the safe-area tokens are
// already zeroed when .page-scroll first lays out (see styles.css) — iOS WebKit
// hands an iframe the top-level page's insets, which inside LiftOS's sheet is a
// status bar of dead space under a header that isn't the status bar.
if (embedContext) document.documentElement.classList.add('is-embedded')

export interface SelectionTotals {
  count: number
  calories: number
  protein: number
  weight: number
}

export function postSelectionTotals(parentOrigin: string, totals: SelectionTotals) {
  window.parent.postMessage(
    { source: 'foodbook', type: 'selection', v: 1, ...totals },
    parentOrigin,
  )
}
