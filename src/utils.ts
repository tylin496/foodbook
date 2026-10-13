import type { FoodItem, FoodSubItem, IngredientOverrides, SubItemOverrides } from './types'
import {
  getEffectiveBaseQty,
  getEffectiveIngredientQty,
  getEffectiveSubItemQty,
  getFoodTotals,
  getSubItemTotals,
} from './types'

export function formatSubItemName(sub: { name: string; qty?: number }): string {
  const qty = sub.qty ?? 1
  return qty !== 1 ? `${sub.name} ×${formatAmount(qty)}` : sub.name
}

export function toNumber(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// Summing decimal inputs leaves float noise (124.20000000000002); one decimal
// place is also all the precision these values are ever entered with.
export function roundAmount(value: number): number {
  return Math.round(value * 10) / 10
}

export function formatAmount(value: number): string {
  return String(roundAmount(value))
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Keeps checked rows grouped above unchecked ones (stable otherwise) — mirrors
// the move-to-bottom that happens live when a row gets unchecked in the edit
// form, so a record saved with stale ordering doesn't reopen looking wrong.
export function sortBySelected<T extends { selected?: boolean }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.selected !== false) - Number(a.selected !== false))
}

type Totals = { weight: number; protein: number; calories: number }

function sameTotals(a: Totals, b: Totals): boolean {
  return (
    roundAmount(a.weight) === roundAmount(b.weight) &&
    roundAmount(a.calories) === roundAmount(b.calories) &&
    roundAmount(a.protein) === roundAmount(b.protein)
  )
}

// One line per row, nested with tree branches (├ └ │) so a pasted list keeps
// its levels even where indentation collapses. Only what's counted is copied:
// an unchecked sub-item or ingredient adds nothing to the totals above it, so
// listing it read as part of the meal.
type TextNode = { label: string; children: TextNode[] }

function formatStats(t: Totals): string {
  return `${formatAmount(t.weight)}g ${formatAmount(t.calories)}kcal/${formatAmount(t.protein)}g`
}

function renderTree(nodes: TextNode[], prefix: string, lines: string[]) {
  nodes.forEach((node, i) => {
    const last = i === nodes.length - 1
    lines.push(`${prefix}${last ? '└ ' : '├ '}${node.label}`)
    renderTree(node.children, `${prefix}${last ? '   ' : '│  '}`, lines)
  })
}

export function formatItemsAsText(
  items: FoodItem[],
  overridesByItem?: Record<string, SubItemOverrides>,
  ingredientOverridesByItem?: Record<string, IngredientOverrides>,
): string {
  const blocks: string[] = []

  items.forEach((item) => {
    const overrides = overridesByItem?.[item.id]
    const ingredientOverrides = ingredientOverridesByItem?.[item.id]
    const totals = getFoodTotals(item, overrides, ingredientOverrides)
    const subItems = item.subItems ?? []

    const ingredientNodes = (sub: FoodSubItem, parentQty: number): TextNode[] =>
      (sub.ingredients ?? []).flatMap((ing) => {
        const ownQty = getEffectiveIngredientQty(ing, ingredientOverrides)
        if (ownQty <= 0) return []
        const qty = ownQty * parentQty
        return [
          {
            label: `${formatSubItemName({ ...ing, qty: ownQty })} ${formatStats({
              weight: ing.weight * qty,
              calories: ing.calories * qty,
              protein: ing.protein * qty,
            })}`,
            children: [],
          },
        ]
      })

    // A single counted sub-item that carries the item's whole numbers just
    // restates the header line — fold its name into the item's and let its
    // ingredients (if any) hang straight off the item instead.
    // Child lines are priced at one portion of the item, matching the sheet;
    // only the header line carries the item's own 份數, which its ×N names.
    const baseQty = getEffectiveBaseQty(item, overrides)
    const lone = subItems.length === 1 ? subItems[0] : null
    const loneQty = lone ? getEffectiveSubItemQty(lone, overrides) : 0
    const folded =
      lone && loneQty > 0 && sameTotals(getSubItemTotals(lone, loneQty * baseQty, ingredientOverrides), totals)
        ? lone
        : null

    const foldedName = folded && folded.name !== item.name ? formatSubItemName({ ...folded, qty: loneQty }) : null
    // The totals already carry the item's own portions; without the ×N the
    // doubled numbers would arrive unexplained.
    const itemName = formatSubItemName({ ...item, qty: baseQty })
    const lines = [`${foldedName ? `${itemName}（${foldedName}）` : itemName} ${formatStats(totals)}`]

    const children = folded
      ? ingredientNodes(folded, loneQty)
      : subItems.flatMap((sub) => {
          const qty = getEffectiveSubItemQty(sub, overrides)
          if (qty <= 0) return []
          return [
            {
              label: `${formatSubItemName({ ...sub, qty })} ${formatStats(getSubItemTotals(sub, qty, ingredientOverrides))}`,
              children: ingredientNodes(sub, qty),
            },
          ]
        })
    renderTree(children, '', lines)
    blocks.push(lines.join('\n'))
  })

  // A blank line between items, so where one meal ends is plain at a glance.
  return blocks.join('\n\n')
}

// navigator.clipboard exists only on secure origins. Served over plain http —
// which is how the app is reached from a phone on the LAN during development —
// the whole `clipboard` object is undefined, so reaching straight for
// `.writeText` throws before anything after the call can run. Keep the throw
// in here, and fall back to the old textarea + execCommand path so the copy
// still lands on those origins.
//
// Resolves to whether the text actually reached the clipboard. The write is
// only knowable a tick late, which is why the caller shows its tick straight
// away and corrects it from this — waiting on the answer would put the delay
// back into the one piece of feedback that has to be immediate.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Safari refuses the write when the document isn't focused. The gesture
    // execCommand needs is spent by the time that rejection lands, so the
    // path below almost certainly fails too — it runs anyway so the answer
    // comes from an attempt rather than an assumption.
  }

  let area: HTMLTextAreaElement | null = null
  try {
    area = document.createElement('textarea')
    area.value = text
    // readonly so focusing it can't raise the iOS keyboard, and 1×1 rather
    // than off-screen so scroll position stays put.
    area.setAttribute('readonly', '')
    area.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;opacity:0'
    document.body.appendChild(area)

    // iOS ignores .select() here and copies the document's own selection, so
    // the range has to be set explicitly; .select() after it is what focuses
    // the field everywhere else, which is what execCommand reads from there.
    const range = document.createRange()
    range.selectNodeContents(area)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    area.setSelectionRange(0, text.length)
    area.select()

    const ok = document.execCommand('copy')
    selection?.removeAllRanges()
    return ok
  } catch {
    return false
  } finally {
    // In the finally, not after execCommand: it throws in some browsers rather
    // than returning false, and every throw would otherwise leave its own 1×1
    // textarea behind in the body for good.
    area?.remove()
  }
}
