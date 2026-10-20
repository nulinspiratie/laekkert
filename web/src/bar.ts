// The bar's display helpers: grouping, search and the badges drinks wear.

import type { BarItem, DrinkBar, DrinkStatus, Kind, RecipeSummary } from './types'

/** The kinds in the order the bar shows them. */
export const KINDS: readonly Kind[] = ['spirits', 'liqueurs', 'aperitifs', 'bitters', 'syrups', 'other']

export const KIND_LABELS: Record<Kind, string> = {
  spirits: 'Spirits',
  liqueurs: 'Liqueurs',
  aperitifs: 'Aperitifs and vermouth',
  bitters: 'Bitters',
  syrups: 'Syrups',
  other: 'Other',
}

/** The server's name key: accents, case and extra spaces do not matter. */
export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Does `q` match the item's name, or failing that one of its other names? */
export function matchItem(item: BarItem, q: string): { ok: boolean; alias: string | null } {
  const needle = normalise(q)
  if (needle === '' || normalise(item.name).includes(needle)) return { ok: true, alias: null }
  const alias = item.aliases.find((other) => normalise(other).includes(needle))
  return alias === undefined ? { ok: false, alias: null } : { ok: true, alias }
}

export function usedText(n: number): string {
  if (n === 0) return 'Not in any drink yet'
  return n === 1 ? 'Used in 1 drink' : `Used in ${n} drinks`
}

/** The kinds that have items, in the fixed order, with how many of each are in the bar. */
export function groupByKind(items: BarItem[]): { kind: Kind; items: BarItem[]; have: number }[] {
  return KINDS.map((kind) => {
    const inKind = items.filter((item) => item.kind === kind)
    return { kind, items: inKind, have: inKind.filter((item) => item.state === 'have').length }
  }).filter((group) => group.items.length > 0)
}

/** Bottles and the like: everything tracked, sorted or not. */
export const shelf = (items: BarItem[]): BarItem[] => items.filter((item) => !item.fresh)

export const fresh = (items: BarItem[]): BarItem[] => items.filter((item) => item.fresh)

export const unsorted = (items: BarItem[]): BarItem[] =>
  items.filter((item) => !item.fresh && item.state === null)

/** "a, b" for up to `max` names; more shows the first `max` and "+N". */
export function nameList(names: string[], max = 2): string {
  const shown = names.slice(0, max).join(', ')
  return names.length > max ? `${shown} +${names.length - max}` : shown
}

/** The line a drink's card shows about the bar. */
export function badge(bar: DrinkBar, phone: boolean): { kind: DrinkStatus; text: string } {
  switch (bar.status) {
    case 'can_make':
      return { kind: 'can_make', text: 'Can make now' }
    case 'fresh_only':
      return { kind: 'fresh_only', text: `${phone ? 'Buy' : 'Buy fresh'}: ${nameList(bar.fresh)}` }
    case 'missing':
      return { kind: 'missing', text: `Missing: ${nameList(bar.missing)}` }
    case 'unsorted':
      return { kind: 'unsorted', text: `Not sorted: ${nameList(bar.unsorted)}` }
  }
}

/** Of the drinks that need only fresh items, the fresh item most of them need. */
export function topFresh(recipes: RecipeSummary[]): { item: string; count: number } | null {
  const counts = new Map<string, number>()
  for (const recipe of recipes) {
    if (recipe.bar?.status !== 'fresh_only') continue
    for (const name of new Set(recipe.bar.fresh)) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  let top: { item: string; count: number } | null = null
  for (const [item, count] of counts) {
    if (top === null || count > top.count || (count === top.count && item.localeCompare(top.item) < 0)) {
      top = { item, count }
    }
  }
  return top
}
