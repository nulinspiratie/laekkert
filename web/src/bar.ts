// The bar's display helpers: grouping, search and the badges drinks wear.

import { ApiError } from './api'
import type { Bar, BarItem, DrinkBar, DrinkStatus, Kind, Recipe, RecipeIngredient } from './types'

/** The kinds in the order the bar shows them. */
export const KINDS: readonly Kind[] = ['spirits', 'liqueurs', 'aperitifs', 'bitters', 'syrups', 'other']

/** The kinds the bar tracks: syrups have no state, so the bar has no group for them. */
export const TRACKED_KINDS: readonly Kind[] = KINDS.filter((kind) => kind !== 'syrups')

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

/** The tracked kinds that have items, in the fixed order, with how many of each are in the bar. */
export function groupByKind(items: BarItem[]): { kind: Kind; items: BarItem[]; have: number }[] {
  return TRACKED_KINDS.map((kind) => {
    const inKind = items.filter((item) => item.kind === kind)
    return { kind, items: inKind, have: inKind.filter((item) => item.state === 'have').length }
  }).filter((group) => group.items.length > 0)
}

/** Bottles and the like: everything tracked, sorted or not. */
export const shelf = (items: BarItem[]): BarItem[] => items.filter((item) => item.tracked)

export const untracked = (items: BarItem[]): BarItem[] => items.filter((item) => !item.tracked)

export const unsorted = (items: BarItem[]): BarItem[] =>
  items.filter((item) => item.tracked && item.state === null)

/** "a, b" for up to `max` names; more shows the first `max` and "+N". */
export function nameList(names: string[], max = 2): string {
  const shown = names.slice(0, max).join(', ')
  return names.length > max ? `${shown} +${names.length - max}` : shown
}

/**
 * The line a drink's card shows about the bar; `also` is a drink you can make that uses untracked
 * items. `text` is the one-line version (two names and "+N"); `label` names everything.
 */
export function badge(bar: DrinkBar): { kind: DrinkStatus | 'also'; text: string; label: string } {
  const named = (prefix: string, names: string[]) => ({
    text: `${prefix}: ${nameList(names)}`,
    label: `${prefix}: ${names.join(', ')}`,
  })
  switch (bar.status) {
    case 'can_make':
      return bar.untracked.length > 0
        ? { kind: 'also', ...named('Also needs', bar.untracked) }
        : { kind: 'can_make', text: 'Can make now', label: 'Can make now' }
    case 'missing':
      return { kind: 'missing', ...named('Missing', bar.missing) }
    case 'unsorted':
      return { kind: 'unsorted', ...named('Not sorted', bar.unsorted) }
  }
}

/** What the bar says about a drink with these ingredients; the server's rule in `BarView.status`. */
function drinkBar(ingredients: RecipeIngredient[]): DrinkBar {
  const missing: string[] = []
  const unsorted: string[] = []
  const untracked: string[] = []
  for (const ing of ingredients) {
    // No bar item: one saved since the bar was read, so an unsorted bottle.
    const name = ing.bar?.item ?? ing.item
    const state = ing.bar?.state ?? null
    const group = ing.bar && !ing.bar.tracked ? untracked : state === 'dont' ? missing : state === null ? unsorted : null
    if (group && !group.includes(name)) group.push(name)
  }
  const status: DrinkStatus = missing.length ? 'missing' : unsorted.length ? 'unsorted' : 'can_make'
  return { status, missing, unsorted, untracked }
}

/**
 * A drink with a bar the server just returned laid over its ingredients, and its summary to match.
 * Syrups and prep have no bar; theirs stays null.
 */
export function withBar(recipe: Recipe, bar: Bar): Recipe {
  if (recipe.category === 'syrups' || recipe.category === 'prep') return { ...recipe, bar: null }
  const items = new Map(bar.items.map((item) => [normalise(item.name), item]))
  const ingredients = recipe.ingredients.map((ing) => {
    const item = ing.bar ? items.get(normalise(ing.bar.item)) : undefined
    return ing.bar && item ? { ...ing, bar: { ...ing.bar, state: item.state, tracked: item.tracked } } : ing
  })
  return { ...recipe, ingredients, bar: drinkBar(ingredients) }
}

/** What a bar write says when no answer came: no network, or Cloudflare Access wanting a login. */
export const UNREACHABLE = "Couldn't reach Lækkert. Nothing was changed."

/** The sentence to show for a failed bar write: the server's own, or that it was never reached. */
export const messageOf = (err: unknown): string => (err instanceof ApiError ? err.message : UNREACHABLE)
