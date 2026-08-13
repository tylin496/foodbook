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
const ALLOWED_PARENTS = [
  'https://liftos.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

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
  if (!ALLOWED_PARENTS.includes(parentOrigin)) return null
  const theme = params.get('theme')
  return { parentOrigin, theme: theme === 'dark' || theme === 'light' ? theme : null }
}

/** Resolved once — neither the URL nor the framing can change without a reload. */
export const embedContext = readEmbedContext()

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
