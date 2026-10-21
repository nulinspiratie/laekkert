// Browse state: what the recipe list shows, kept in the URL query string.

import { normalise } from './bar'
import { capitalise } from './format'
import type { Mark, RecipeSummary, Side } from './types'

export type FilterMark = Extract<Mark, 'favourite' | 'try_next'>
export type SortKey = 'time' | 'rating' | 'made' | 'name'
/** The Drinks views: what you can make, every drink, the mocktails, and the syrups and prep. */
export type DrinksView = 'can' | 'all' | 'mocktails' | 'syrups'

/** The views in display order. */
export const DRINKS_VIEWS: readonly DrinksView[] = ['can', 'all', 'mocktails', 'syrups']

/** Desktop labels. */
export const VIEW_LABELS: Record<DrinksView, string> = {
  can: 'Can make',
  all: 'All drinks',
  mocktails: 'Mocktails',
  syrups: 'Syrups & prep',
}

/** The views the page offers: all of them, or without Can make when the bar could not be read. */
export function availableViews(canMake: boolean): DrinksView[] {
  return DRINKS_VIEWS.filter((view) => canMake || view !== 'can')
}

/** Phone chip labels; the chips append the count. */
export const VIEW_CHIP_LABELS: Record<DrinksView, string> = {
  can: 'Can make',
  all: 'All',
  mocktails: 'Mocktails',
  syrups: 'Syrups',
}

export interface BrowseState {
  q: string
  /** Food only: drinks pick a view instead, so this is always null there. */
  category: string | null
  marks: FilterMark[]
  tags: string[]
  sort: SortKey
  /** Drinks only; always null on food. */
  show: DrinksView | null
  /** "What you have": ingredient terms, in the order given. Food only; always [] on drinks. */
  have: string[]
}

/** The server caps the list; the rest are ignored. */
export const MAX_HAVE_TERMS = 20

/** The sort choices the browse page offers, in display order. */
export const SORT_OPTIONS: readonly { key: SortKey; label: string }[] = [
  { key: 'time', label: 'Cooking time' },
  { key: 'rating', label: 'Rating' },
  { key: 'made', label: 'Recently made' },
  { key: 'name', label: 'A–Z' },
]

export const CATEGORIES: Record<Side, readonly string[]> = {
  food: ['mains', 'sides', 'desserts', 'sauces', 'prep'],
  drinks: ['cocktails', 'mocktails', 'syrups', 'prep'],
}

/** The marks the browse page filters on, in display order. */
export const FILTER_MARKS: readonly FilterMark[] = ['favourite', 'try_next']

export const MARK_LABELS: Record<FilterMark, string> = {
  favourite: 'Favourite',
  try_next: 'Try next',
}

/** What an old `cat=` link meant, as a view. */
const CAT_VIEWS: Record<string, DrinksView> = {
  cocktails: 'all',
  mocktails: 'mocktails',
  syrups: 'syrups',
  prep: 'syrups',
}

/** An old `tag=mocktail` or `tag=mocktails` (compared by name key): mocktails were tagged before they were a view. */
const isMocktailTag = (tag: string) => ['mocktail', 'mocktails'].includes(normalise(tag))

/** The view a drinks URL names with `show=`, if any. */
const shownView = (params: URLSearchParams) => DRINKS_VIEWS.find((view) => view === params.get('show'))

/**
 * Which view a drinks URL asks for: `show=`, else an old mocktail tag, else an old `cat=`, else
 * an old `bar=`, else Can make.
 */
function parseView(params: URLSearchParams): DrinksView {
  const show = shownView(params)
  if (show) return show
  if (params.getAll('tag').some(isMocktailTag)) return 'mocktails'
  const cat = params.get('cat')
  if (cat && Object.hasOwn(CAT_VIEWS, cat)) return CAT_VIEWS[cat]
  return 'can'
}

const isCocktailOrMocktail = (recipe: RecipeSummary) =>
  recipe.category === 'cocktails' || recipe.category === 'mocktails'

/** Is the recipe in the view? The bar covers cocktails and mocktails; syrups and prep have none. */
function inView(recipe: RecipeSummary, view: DrinksView): boolean {
  switch (view) {
    case 'can':
      return isCocktailOrMocktail(recipe) && recipe.bar?.status === 'can_make'
    case 'all':
      return isCocktailOrMocktail(recipe)
    case 'mocktails':
      return recipe.category === 'mocktails'
    case 'syrups':
      return recipe.category === 'syrups' || recipe.category === 'prep'
  }
}

/** The client's copy of the server's `name_key`: terms with the same key are one term. */
export function haveKey(term: string): string {
  return normalise(term)
}

/** Trims, drops blanks, keeps the first of terms sharing a key, and stops at the cap. */
function cleanTerms(terms: string[]): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const raw of terms) {
    const term = raw.trim()
    const key = haveKey(term)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    kept.push(term)
    if (kept.length === MAX_HAVE_TERMS) break
  }
  return kept
}

/** Adds a typed term; blank text, a repeat (by key) and a full list leave the state as it is. */
export function addTerm(state: BrowseState, text: string): BrowseState {
  const have = cleanTerms([...state.have, text])
  const added = have.length === state.have.length + 1
  return added ? { ...state, have } : state
}

/** Removes the term (matched by key); the state is returned as it was if it is not there. */
export function removeTerm(state: BrowseState, term: string): BrowseState {
  const key = haveKey(term)
  const have = state.have.filter((other) => haveKey(other) !== key)
  return have.length === state.have.length ? state : { ...state, have }
}

export function parseBrowse(side: Side, params: URLSearchParams): BrowseState {
  const cat = params.get('cat')
  const picked = params.getAll('mark')
  // With no view named, an old mocktail tag became the Mocktails view (see `parseView`).
  const oldMocktailTag = side === 'drinks' && !shownView(params) ? isMocktailTag : () => false
  return {
    q: params.get('q') ?? '',
    category: side === 'food' && cat && CATEGORIES.food.includes(cat) ? cat : null,
    marks: FILTER_MARKS.filter((mark) => picked.includes(mark)),
    tags: [...new Set(params.getAll('tag').filter((tag) => tag !== '' && !oldMocktailTag(tag)))],
    sort: SORT_OPTIONS.find(({ key }) => key === params.get('sort'))?.key ?? 'name',
    show: side === 'drinks' ? parseView(params) : null,
    have: side === 'food' ? cleanTerms(params.getAll('have')) : [],
  }
}

export function browseQuery(state: BrowseState): string {
  const params = new URLSearchParams()
  if (state.q) params.append('q', state.q)
  // Drinks pick a view instead of a category, so `cat=` is food's alone.
  if (state.category && state.show === null) params.append('cat', state.category)
  for (const mark of state.marks) params.append('mark', mark)
  for (const tag of state.tags) params.append('tag', tag)
  if (state.sort !== 'name') params.append('sort', state.sort)
  if (state.show && state.show !== 'can') params.append('show', state.show)
  for (const term of state.have) params.append('have', term)
  return params.toString()
}

/** The query a reset goes to; drinks keep the view they are on. */
export function defaultQuery(side: Side, show: DrinksView | null = null): string {
  if (side === 'food') return 'sort=time'
  return show && show !== 'can' ? `show=${show}` : ''
}

const byName = (a: RecipeSummary, b: RecipeSummary) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

const byTime = (a: RecipeSummary, b: RecipeSummary) => {
  if (a.time_minutes === b.time_minutes) return byName(a, b)
  if (a.time_minutes === null) return 1
  if (b.time_minutes === null) return -1
  return a.time_minutes - b.time_minutes || byName(a, b)
}

// Highest first; unrated last.
const byRating = (a: RecipeSummary, b: RecipeSummary) => {
  if (a.rating === b.rating) return byName(a, b)
  if (a.rating === null) return 1
  if (b.rating === null) return -1
  return b.rating - a.rating || byName(a, b)
}

// Newest first; never made last. The timestamps are UTC ISO 8601, so strings compare in time order.
const byMade = (a: RecipeSummary, b: RecipeSummary) => {
  if (a.last_made === b.last_made) return byName(a, b)
  if (a.last_made === null) return 1
  if (b.last_made === null) return -1
  return a.last_made < b.last_made ? 1 : -1
}

const SORTERS: Record<SortKey, (a: RecipeSummary, b: RecipeSummary) => number> = {
  time: byTime,
  rating: byRating,
  made: byMade,
  name: byName,
}

function matchesOtherFilters(recipe: RecipeSummary, state: BrowseState): boolean {
  return (
    (state.category === null || recipe.category === state.category) &&
    state.marks.every((mark) => recipe.marks.includes(mark)) &&
    state.tags.every((tag) => recipe.tags.includes(tag))
  )
}

export function applyBrowse(recipes: RecipeSummary[], state: BrowseState): RecipeSummary[] {
  const kept = recipes.filter(
    (recipe) => matchesOtherFilters(recipe, state) && (state.show === null || inView(recipe, state.show)),
  )
  // A search or a "what you have" list keeps the API's order (relevance, or fewest missing).
  if (state.q || state.have.length > 0) return kept
  return kept.sort(SORTERS[state.sort])
}

const SORT_DESCRIPTIONS: Record<SortKey, string> = {
  time: 'quickest first',
  rating: 'highest rated first',
  made: 'recently made first',
  name: 'A to Z',
}

export function describe(state: BrowseState): string {
  const parts: string[] = state.marks.map((mark) => MARK_LABELS[mark])
  if (state.have.length > 0) parts.push('fewest missing first')
  else if (state.q) parts.push('best match first')
  else parts.push(SORT_DESCRIPTIONS[state.sort])
  return parts.join(', ')
}

/**
 * The facets of a side's recipes. The view counts follow the other filters in `state`
 * (not the view itself), so each view shows what it would leave. On food the view counts are 0.
 */
export function facetCounts(
  side: Side,
  recipes: RecipeSummary[],
  state?: BrowseState,
): {
  categories: [string, number][]
  tags: string[]
  views: Record<DrinksView, number>
} {
  const categories = CATEGORIES[side].map(
    (name): [string, number] => [name, recipes.filter((r) => r.category === name).length],
  )
  const tagCounts = new Map<string, number>()
  for (const recipe of recipes) {
    for (const tag of new Set(recipe.tags)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  const tags = [...tagCounts.keys()].sort(
    (a, b) => tagCounts.get(b)! - tagCounts.get(a)! || a.localeCompare(b),
  )
  // Views are a drinks thing; food reports none.
  const candidates = state ? recipes.filter((r) => matchesOtherFilters(r, state)) : recipes
  const count = (view: DrinksView) =>
    side === 'drinks' ? candidates.filter((r) => inView(r, view)).length : 0
  const views = { can: count('can'), all: count('all'), mocktails: count('mocktails'), syrups: count('syrups') }
  return { categories, tags, views }
}

/**
 * On drinks with a search: the matches (other filters applied) the current view hides, and the
 * view that shows them. All drinks first, then Syrups & prep.
 */
export function hiddenMatches(
  recipes: RecipeSummary[],
  state: BrowseState,
): { view: 'all' | 'syrups'; count: number } | null {
  const { show } = state
  if (show === null || state.q === '') return null
  const hidden = recipes.filter((recipe) => matchesOtherFilters(recipe, state) && !inView(recipe, show))
  const inAll = hidden.filter((recipe) => inView(recipe, 'all')).length
  if (inAll > 0) return { view: 'all', count: inAll }
  const inSyrups = hidden.filter((recipe) => inView(recipe, 'syrups')).length
  return inSyrups > 0 ? { view: 'syrups', count: inSyrups } : null
}

/** The Food quick tags when the settings can't be read; the server's default too. */
export const DEFAULT_QUICK_TAGS: readonly string[] = ['breakfast', 'dinner', 'kid approved', 'quick', 'vegetarian']

/** A Food category tab; `category` null is All. */
export interface QuickTab {
  category: string | null
  label: string
  /** The recipes it would show with everything else that is on. */
  count: number
  on: boolean
  /** It would leave nothing, so a tap does nothing. Never true for one that is on, or for All. */
  disabled: boolean
}

/** A Food tag chip: a quick tag, or another tag that is on (`quick` false). */
export interface QuickChip {
  /** The spelling the recipes use, which is what the filter compares. */
  tag: string
  label: string
  /** Off: the recipes there would be with it on too. On: the recipes there are now. */
  count: number
  on: boolean
  /** Off and would leave nothing, so a tap does nothing. */
  disabled: boolean
  quick: boolean
}

/**
 * The recipes' spelling of each quick tag, in the configured order. A setting entry matches a
 * recipe tag by name key; the most common spelling wins (ties: A to Z). An entry no recipe uses
 * is left out, unless a tag that is on matches it (then that tag, so it can be undone).
 */
export function quickTagSpellings(
  recipes: RecipeSummary[],
  onTags: string[],
  quickTags: readonly string[],
): string[] {
  const used = new Map<string, Map<string, number>>()
  for (const recipe of recipes) {
    for (const tag of new Set(recipe.tags)) {
      const spellings = used.get(normalise(tag)) ?? new Map<string, number>()
      spellings.set(tag, (spellings.get(tag) ?? 0) + 1)
      used.set(normalise(tag), spellings)
    }
  }
  const seen = new Set<string>()
  const kept: string[] = []
  for (const entry of quickTags) {
    const key = normalise(entry)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    const spellings = used.get(key)
    const spelling = spellings
      ? [...spellings].sort(([a, n], [b, m]) => m - n || a.localeCompare(b))[0][0]
      : onTags.find((tag) => normalise(tag) === key)
    if (spelling !== undefined) kept.push(spelling)
  }
  return kept
}

/**
 * The Food page's category tabs and tag chips, from the recipes it loaded (already cut down by
 * the search and What you have). Tabs: All, then each category with a recipe or picked. Chips:
 * the quick tags in use, then any other tag that is on. `quick` holds the quick tags' spellings.
 */
export function quickFilters(
  recipes: RecipeSummary[],
  state: BrowseState,
  quickTags: readonly string[],
): { tabs: QuickTab[]; chips: QuickChip[]; quick: string[]; active: boolean } {
  const count = (patch: Partial<BrowseState>) =>
    recipes.filter((recipe) => matchesOtherFilters(recipe, { ...state, ...patch })).length
  const categories = CATEGORIES.food.filter(
    (name) => name === state.category || recipes.some((recipe) => recipe.category === name),
  )
  const tabs = [null, ...categories].map((category): QuickTab => {
    const on = state.category === category
    const n = count({ category })
    return {
      category,
      label: category === null ? 'All' : capitalise(category),
      count: n,
      on,
      // All is how a picked tab is undone, so it is never dimmed.
      disabled: !on && category !== null && n === 0,
    }
  })
  const quick = quickTagSpellings(recipes, state.tags, quickTags)
  const others = state.tags.filter((tag) => !quick.includes(tag))
  const chips = [...quick, ...others].map((tag): QuickChip => {
    const on = state.tags.includes(tag)
    const n = on ? count({}) : count({ tags: [...state.tags, tag] })
    return { tag, label: capitalise(tag), count: n, on, disabled: !on && n === 0, quick: quick.includes(tag) }
  })
  return { tabs, chips, quick, active: state.category !== null || state.tags.length > 0 }
}

/** Food's More tags: every tag (most used first) and any other that is on, without the quick tags. */
export function moreTags(tags: string[], onTags: string[], quick: string[]): string[] {
  return [...tags, ...onTags.filter((tag) => !tags.includes(tag))].filter((tag) => !quick.includes(tag))
}
