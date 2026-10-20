import { describe as suite, expect, it } from 'vitest'
import {
  applyBrowse,
  browseQuery,
  CATEGORIES,
  defaultQuery,
  describe,
  facetCounts,
  MARK_LABELS,
  parseBrowse,
  type BrowseState,
} from './browse'
import type { DrinkBar, DrinkStatus, RecipeSummary } from './types'

function recipe(over: Partial<RecipeSummary> & { slug: string }): RecipeSummary {
  return {
    name: over.slug,
    side: 'food',
    category: 'mains',
    time_minutes: null,
    tags: [],
    marks: [],
    image: null,
    rating: null,
    last_made: null,
    ...over,
  }
}

function state(over: Partial<BrowseState> = {}): BrowseState {
  return { q: '', category: null, marks: [], tags: [], sort: 'name', bar: null, ...over }
}

const parse = (side: 'food' | 'drinks', query: string) =>
  parseBrowse(side, new URLSearchParams(query))

suite('constants', () => {
  it('lists the categories per side in order', () => {
    expect(CATEGORIES.food).toEqual(['mains', 'sides', 'desserts', 'sauces', 'prep'])
    expect(CATEGORIES.drinks).toEqual(['cocktails', 'mocktails', 'syrups', 'prep'])
  })

  it('labels the filter marks', () => {
    expect(MARK_LABELS).toEqual({
      favourite: 'Favourite',
      try_next: 'Try next',
    })
  })
})

suite('parseBrowse', () => {
  it('returns the empty state for no params', () => {
    expect(parse('food', '')).toEqual(state())
  })

  it('reads every key', () => {
    expect(parse('food', 'q=pasta&cat=mains&mark=favourite&tag=quick&tag=batch+cook&sort=time')).toEqual(
      state({
        q: 'pasta',
        category: 'mains',
        marks: ['favourite'],
        tags: ['quick', 'batch cook'],
        sort: 'time',
      }),
    )
  })

  it('drops a category that does not belong to the side', () => {
    expect(parse('food', 'cat=soups').category).toBeNull()
    expect(parse('food', 'cat=cocktails').category).toBeNull()
    expect(parse('drinks', 'cat=cocktails').category).toBe('cocktails')
  })

  it('drops unknown marks, including marks that are not filters', () => {
    expect(parse('food', 'mark=bogus&mark=favourite').marks).toEqual(['favourite'])
    expect(parse('food', 'mark=tried').marks).toEqual([])
  })

  it('orders and dedupes marks in display order', () => {
    expect(parse('food', 'mark=try_next&mark=favourite&mark=try_next').marks).toEqual([
      'favourite',
      'try_next',
    ])
  })

  it('drops a stale kid_approved mark from an old link', () => {
    expect(parse('food', 'mark=kid_approved&mark=favourite&sort=time').marks).toEqual(['favourite'])
    expect(browseQuery(parse('food', 'mark=kid_approved&sort=time'))).toBe('sort=time')
  })

  it('dedupes tags and keeps URL order', () => {
    expect(parse('food', 'tag=b&tag=a&tag=b').tags).toEqual(['b', 'a'])
  })

  it('falls back to name for a missing or unknown sort', () => {
    expect(parse('food', '').sort).toBe('name')
    expect(parse('food', 'sort=bogus').sort).toBe('name')
  })

  it('parse keeps sort=rating and sort=made', () => {
    expect(parse('food', 'sort=rating').sort).toBe('rating')
    expect(parse('drinks', 'sort=made').sort).toBe('made')
    expect(browseQuery(state({ sort: 'rating' }))).toBe('sort=rating')
    expect(browseQuery(state({ sort: 'made' }))).toBe('sort=made')
  })

  it('treats empty q, cat and tag values as absent', () => {
    expect(parse('food', 'q=&cat=&tag=')).toEqual(state())
  })
})

suite('browseQuery', () => {
  it('is empty for the empty state', () => {
    expect(browseQuery(state())).toBe('')
  })

  it('emits keys in a stable order and repeats mark and tag', () => {
    expect(
      browseQuery(
        state({
          sort: 'time',
          tags: ['quick', 'batch cook'],
          marks: ['favourite', 'try_next'],
          category: 'mains',
          q: 'pasta',
        }),
      ),
    ).toBe('q=pasta&cat=mains&mark=favourite&mark=try_next&tag=quick&tag=batch+cook&sort=time')
  })

  it('omits sort when it is name', () => {
    expect(browseQuery(state({ sort: 'name', category: 'mains' }))).toBe('cat=mains')
  })

  it('round-trips the default queries', () => {
    for (const side of ['food', 'drinks'] as const) {
      expect(browseQuery(parse(side, defaultQuery(side)))).toBe(defaultQuery(side))
    }
  })

  it('round-trips a full query', () => {
    const query = 'q=a+b&cat=desserts&mark=try_next&tag=x&tag=y+z&sort=time'
    expect(browseQuery(parse('food', query))).toBe(query)
  })
})

suite('defaultQuery', () => {
  it('shows all food quickest first, and all drinks', () => {
    expect(defaultQuery('food')).toBe('sort=time')
    expect(defaultQuery('drinks')).toBe('')
  })
})

suite('applyBrowse', () => {
  const recipes = [
    recipe({ slug: 'a', name: 'Zucchini', category: 'sides', tags: ['quick'], marks: ['favourite'] }),
    recipe({
      slug: 'b',
      name: 'apple pie',
      category: 'desserts',
      time_minutes: 90,
      tags: ['quick', 'baking'],
      marks: ['favourite', 'try_next'],
    }),
    recipe({ slug: 'c', name: 'Bolognese', time_minutes: 45, tags: ['quick'], marks: ['try_next'] }),
    recipe({ slug: 'd', name: 'Carbonara', time_minutes: 20, marks: ['try_next', 'favourite'] }),
  ]

  it('returns everything for the empty state, sorted by name ignoring case', () => {
    expect(applyBrowse(recipes, state()).map((r) => r.slug)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('filters by category', () => {
    expect(applyBrowse(recipes, state({ category: 'mains' })).map((r) => r.slug)).toEqual(['c', 'd'])
  })

  it('requires every selected mark', () => {
    const out = applyBrowse(recipes, state({ marks: ['favourite', 'try_next'] }))
    expect(out.map((r) => r.slug)).toEqual(['b', 'd'])
  })

  it('requires every selected tag', () => {
    expect(applyBrowse(recipes, state({ tags: ['quick', 'baking'] })).map((r) => r.slug)).toEqual(['b'])
  })

  it('combines category, marks and tags with AND', () => {
    const s = state({ category: 'desserts', marks: ['try_next'], tags: ['quick'] })
    expect(applyBrowse(recipes, s).map((r) => r.slug)).toEqual(['b'])
    expect(applyBrowse(recipes, { ...s, category: 'mains', tags: ['baking'] })).toEqual([])
  })

  it('sorts by time with missing times last and ties by name', () => {
    const list = [
      recipe({ slug: 'n1', name: 'Nothing', time_minutes: null }),
      recipe({ slug: 't2', name: 'Beta', time_minutes: 30 }),
      recipe({ slug: 't1', name: 'Alpha', time_minutes: 30 }),
      recipe({ slug: 'fast', name: 'Zed', time_minutes: 5 }),
      recipe({ slug: 'n0', name: 'Also none', time_minutes: null }),
    ]
    expect(applyBrowse(list, state({ sort: 'time' })).map((r) => r.slug)).toEqual([
      'fast',
      't1',
      't2',
      'n0',
      'n1',
    ])
  })

  it('rating sort puts unrated last', () => {
    const list = [
      recipe({ slug: 'u1', name: 'Unrated b' }),
      recipe({ slug: 'r35', name: 'Three and a half', rating: 3.5 }),
      recipe({ slug: 'r5b', name: 'Beta', rating: 5 }),
      recipe({ slug: 'r5a', name: 'Alpha', rating: 5 }),
      recipe({ slug: 'u0', name: 'Unrated a' }),
    ]
    expect(applyBrowse(list, state({ sort: 'rating' })).map((r) => r.slug)).toEqual([
      'r5a',
      'r5b',
      'r35',
      'u0',
      'u1',
    ])
  })

  it('made sort is newest first, never-made last', () => {
    const list = [
      recipe({ slug: 'never-b', name: 'Never b' }),
      recipe({ slug: 'old', name: 'Old', last_made: '2026-01-02T10:00:00Z' }),
      recipe({ slug: 'new-b', name: 'Beta', last_made: '2026-10-01T09:00:00Z' }),
      recipe({ slug: 'new-a', name: 'Alpha', last_made: '2026-10-01T09:00:00Z' }),
      recipe({ slug: 'never-a', name: 'Never a' }),
    ]
    expect(applyBrowse(list, state({ sort: 'made' })).map((r) => r.slug)).toEqual([
      'new-a',
      'new-b',
      'old',
      'never-a',
      'never-b',
    ])
  })

  it('keeps the input order when q is set', () => {
    const out = applyBrowse(recipes, state({ q: 'x', sort: 'time' }))
    expect(out.map((r) => r.slug)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does not mutate its input', () => {
    const input = [...recipes]
    applyBrowse(input, state({ sort: 'time' }))
    applyBrowse(input, state())
    expect(input).toEqual(recipes)
  })
})

suite('describe', () => {
  it('names the mark and the sort', () => {
    expect(describe(state({ marks: ['try_next'], sort: 'time' }))).toBe('Try next, quickest first')
  })

  it('says A to Z for the empty state', () => {
    expect(describe(state())).toBe('A to Z')
  })

  it('names the new sorts', () => {
    expect(describe(state({ sort: 'rating' }))).toBe('highest rated first')
    expect(describe(state({ sort: 'made' }))).toBe('recently made first')
  })

  it('replaces the sort with best match first when q is set', () => {
    expect(describe(state({ q: 'x', marks: ['favourite', 'try_next'] }))).toBe(
      'Favourite, Try next, best match first',
    )
    expect(describe(state({ q: 'x', sort: 'time' }))).toBe('best match first')
  })

  it('leaves tags and category out', () => {
    expect(describe(state({ category: 'mains', tags: ['quick'], sort: 'time' }))).toBe('quickest first')
  })
})

suite('facetCounts', () => {
  it('lists categories in order, keeping zero counts', () => {
    const list = [
      recipe({ slug: 'a', category: 'desserts' }),
      recipe({ slug: 'b', category: 'mains' }),
      recipe({ slug: 'c', category: 'mains' }),
    ]
    expect(facetCounts('food', list).categories).toEqual([
      ['mains', 2],
      ['sides', 0],
      ['desserts', 1],
      ['sauces', 0],
      ['prep', 0],
    ])
    expect(facetCounts('drinks', []).categories.map(([c]) => c)).toEqual([
      'cocktails',
      'mocktails',
      'syrups',
      'prep',
    ])
  })

  it('orders tags by frequency, then name', () => {
    const list = [
      recipe({ slug: 'a', tags: ['quick', 'baking'] }),
      recipe({ slug: 'b', tags: ['quick', 'zesty'] }),
      recipe({ slug: 'c', tags: ['apple', 'quick'] }),
      recipe({ slug: 'd', tags: ['zesty'] }),
    ]
    expect(facetCounts('food', list).tags).toEqual(['quick', 'zesty', 'apple', 'baking'])
  })
})

const status = (kind: DrinkStatus): DrinkBar => ({ status: kind, missing: [], unsorted: [], fresh: [] })

const drinks = (): RecipeSummary[] => [
  recipe({ slug: 'a', side: 'drinks', category: 'cocktails', bar: status('can_make') }),
  recipe({ slug: 'b', side: 'drinks', category: 'cocktails', bar: status('fresh_only') }),
  recipe({ slug: 'c', side: 'drinks', category: 'mocktails', bar: status('fresh_only'), marks: ['favourite'] }),
  recipe({ slug: 'd', side: 'drinks', category: 'cocktails', bar: status('missing') }),
  recipe({ slug: 'e', side: 'drinks', category: 'syrups', bar: status('unsorted') }),
]

suite('the bar filter', () => {
  it('reads bar on drinks', () => {
    expect(parse('drinks', 'bar=can').bar).toBe('can')
    expect(parse('drinks', 'bar=fresh').bar).toBe('fresh')
    expect(parse('drinks', '').bar).toBeNull()
    expect(parse('drinks', 'bar=other').bar).toBeNull()
  })

  it('ignores bar on food and never writes it', () => {
    expect(parse('food', 'bar=can').bar).toBeNull()
    expect(browseQuery(state({ bar: 'can' }))).toBe('bar=can')
    expect(browseQuery(parse('food', 'bar=can&cat=mains'))).toBe('cat=mains')
  })

  it('round-trips through the query', () => {
    const query = 'cat=cocktails&mark=favourite&tag=sour&sort=rating&bar=fresh'
    expect(browseQuery(parse('drinks', query))).toBe(query)
  })

  it('keeps only the drinks the bar filter names', () => {
    const names = (bar: BrowseState['bar']) => applyBrowse(drinks(), state({ bar })).map((r) => r.slug)
    expect(names(null)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(names('can')).toEqual(['a'])
    expect(names('fresh')).toEqual(['b', 'c'])
  })

  it('combines with the other filters', () => {
    const kept = applyBrowse(drinks(), state({ bar: 'fresh', category: 'cocktails' }))
    expect(kept.map((r) => r.slug)).toEqual(['b'])
  })

  it('counts every drink, the makeable ones and the fresh-only ones', () => {
    expect(facetCounts('drinks', drinks()).bar).toEqual({ all: 5, can: 1, fresh: 2 })
    expect(facetCounts('drinks', []).bar).toEqual({ all: 0, can: 0, fresh: 0 })
  })

  it('counts with the other filters applied but not the bar filter', () => {
    const counts = (over: Partial<BrowseState>) => facetCounts('drinks', drinks(), state(over)).bar
    expect(counts({ category: 'cocktails' })).toEqual({ all: 3, can: 1, fresh: 1 })
    expect(counts({ marks: ['favourite'] })).toEqual({ all: 1, can: 0, fresh: 1 })
    expect(counts({ bar: 'can' })).toEqual({ all: 5, can: 1, fresh: 2 })
  })
})
