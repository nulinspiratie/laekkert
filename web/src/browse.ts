// Browse state: what the recipe list shows, kept in the URL query string.

import type { Mark, RecipeSummary, Side } from './types'

export type FilterMark = Extract<Mark, 'favourite' | 'try_next'>
export type SortKey = 'time' | 'rating' | 'made' | 'name'

export interface BrowseState {
  q: string
  category: string | null
  marks: FilterMark[]
  tags: string[]
  sort: SortKey
}

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

export function parseBrowse(side: Side, params: URLSearchParams): BrowseState {
  const cat = params.get('cat')
  const picked = params.getAll('mark')
  return {
    q: params.get('q') ?? '',
    category: cat && CATEGORIES[side].includes(cat) ? cat : null,
    marks: FILTER_MARKS.filter((mark) => picked.includes(mark)),
    tags: [...new Set(params.getAll('tag').filter((tag) => tag !== ''))],
    sort: SORT_OPTIONS.find(({ key }) => key === params.get('sort'))?.key ?? 'name',
  }
}

export function browseQuery(state: BrowseState): string {
  const params = new URLSearchParams()
  if (state.q) params.append('q', state.q)
  if (state.category) params.append('cat', state.category)
  for (const mark of state.marks) params.append('mark', mark)
  for (const tag of state.tags) params.append('tag', tag)
  if (state.sort !== 'name') params.append('sort', state.sort)
  return params.toString()
}

export function defaultQuery(side: Side): string {
  return side === 'food' ? 'sort=time' : ''
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

export function applyBrowse(recipes: RecipeSummary[], state: BrowseState): RecipeSummary[] {
  const kept = recipes.filter(
    (recipe) =>
      (state.category === null || recipe.category === state.category) &&
      state.marks.every((mark) => recipe.marks.includes(mark)) &&
      state.tags.every((tag) => recipe.tags.includes(tag)),
  )
  // A search keeps the API's relevance order.
  if (state.q) return kept
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
  if (state.q) parts.push('best match first')
  else parts.push(SORT_DESCRIPTIONS[state.sort])
  return parts.join(', ')
}

export function facetCounts(
  side: Side,
  recipes: RecipeSummary[],
): { categories: [string, number][]; tags: string[] } {
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
  return { categories, tags }
}
