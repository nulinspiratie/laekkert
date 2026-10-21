import { describe as suite, expect, it } from 'vitest'
import {
  addTerm,
  applyBrowse,
  browseQuery,
  CATEGORIES,
  DEFAULT_QUICK_TAGS,
  defaultQuery,
  describe,
  DRINKS_VIEWS,
  facetCounts,
  haveKey,
  hiddenMatches,
  MARK_LABELS,
  moreTags,
  parseBrowse,
  quickFilters,
  quickTagSpellings,
  removeTerm,
  VIEW_CHIP_LABELS,
  VIEW_LABELS,
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
  return { q: '', category: null, marks: [], tags: [], sort: 'name', show: null, have: [], ...over }
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
    expect(parse('drinks', 'cat=cocktails').category).toBeNull()
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

  it('keeps the drinks view when given one', () => {
    expect(defaultQuery('drinks', 'mocktails')).toBe('show=mocktails')
    expect(defaultQuery('drinks', 'can')).toBe('')
    expect(defaultQuery('food', 'all')).toBe('sort=time')
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

const status = (kind: DrinkStatus): DrinkBar => ({ status: kind, missing: [], unsorted: [], untracked: [] })

const drinks = (): RecipeSummary[] => [
  recipe({ slug: 'daiquiri', side: 'drinks', category: 'cocktails', bar: status('can_make') }),
  recipe({ slug: 'negroni', side: 'drinks', category: 'cocktails', bar: status('missing'), marks: ['favourite'] }),
  recipe({ slug: 'virgin mojito', side: 'drinks', category: 'mocktails', bar: status('can_make') }),
  recipe({ slug: 'simple syrup', side: 'drinks', category: 'syrups', bar: null }),
  recipe({ slug: 'oleo', side: 'drinks', category: 'prep', bar: null }),
]

suite('drinks views', () => {
  it('lists the views in order with desktop and phone labels', () => {
    expect(DRINKS_VIEWS).toEqual(['can', 'all', 'mocktails', 'syrups'])
    expect(VIEW_LABELS).toEqual({
      can: 'Can make',
      all: 'All drinks',
      mocktails: 'Mocktails',
      syrups: 'Syrups & prep',
    })
    expect(VIEW_CHIP_LABELS).toEqual({ can: 'Can make', all: 'All', mocktails: 'Mocktails', syrups: 'Syrups' })
  })

  it.each([
    ['', 'can'],
    ['show=all', 'all'],
    ['show=nope', 'can'],
    ['bar=fresh', 'can'],
    ['bar=can', 'can'],
    ['cat=cocktails', 'all'],
    ['cat=mocktails', 'mocktails'],
    ['cat=prep', 'syrups'],
    ['cat=syrups', 'syrups'],
    ['bar=can&cat=mocktails', 'mocktails'],
    ['show=all&cat=syrups', 'all'],
  ])('parses %s as view %s', (query, view) => {
    expect(parse('drinks', query).show).toBe(view)
  })

  it('opens an old tag=mocktail link on Mocktails and drops the tag', () => {
    for (const query of ['tag=mocktail', 'tag=Mocktails', 'tag=MOCKTAIL&tag=sour', 'cat=cocktails&tag=mocktail']) {
      const parsed = parse('drinks', query)
      expect(parsed.show).toBe('mocktails')
      expect(parsed.tags).not.toContainEqual(expect.stringMatching(/mocktail/i))
    }
    expect(parse('drinks', 'tag=MOCKTAIL&tag=sour').tags).toEqual(['sour'])
    expect(browseQuery(parse('drinks', 'tag=mocktail&sort=rating'))).toBe('sort=rating&show=mocktails')
  })

  it('keeps a mocktail tag when the link names a view', () => {
    expect(parse('drinks', 'show=all&tag=mocktail')).toMatchObject({ show: 'all', tags: ['mocktail'] })
    expect(parse('food', 'tag=mocktail').tags).toEqual(['mocktail'])
  })

  it('never keeps a category on drinks', () => {
    expect(parse('drinks', 'cat=mocktails').category).toBeNull()
  })

  it('writes old params back as show', () => {
    const old = parse('drinks', 'bar=can&cat=mocktails')
    expect(browseQuery(old)).toBe('show=mocktails')
    expect(browseQuery({ ...old, show: 'can' })).toBe('')
  })

  it('never writes cat on drinks, whatever the state holds', () => {
    expect(browseQuery(state({ category: 'cocktails', show: 'all' }))).toBe('show=all')
    expect(browseQuery(state({ category: 'cocktails', show: 'can' }))).toBe('')
  })

  it('round-trips through the query', () => {
    const query = 'mark=favourite&tag=sour&sort=rating&show=syrups'
    expect(browseQuery(parse('drinks', query))).toBe(query)
  })

  it('has no view on food and never writes one', () => {
    expect(parse('food', 'show=all').show).toBeNull()
    expect(parse('food', 'show=all&cat=mains')).toEqual(state({ category: 'mains' }))
    expect(browseQuery(state({ show: 'all' }))).toBe('show=all')
    expect(browseQuery(parse('food', 'show=all&cat=mains'))).toBe('cat=mains')
  })

  it('filters by category and status', () => {
    const names = (show: BrowseState['show']) => applyBrowse(drinks(), state({ show })).map((r) => r.slug)
    expect(names('can')).toEqual(['daiquiri', 'virgin mojito'])
    expect(names('all')).toEqual(['daiquiri', 'negroni', 'virgin mojito'])
    expect(names('mocktails')).toEqual(['virgin mojito'])
    expect(names('syrups')).toEqual(['oleo', 'simple syrup'])
  })

  it('combines with the other filters', () => {
    const kept = applyBrowse(drinks(), state({ show: 'all', marks: ['favourite'] }))
    expect(kept.map((r) => r.slug)).toEqual(['negroni'])
  })

  it('counts each view with the other filters applied', () => {
    expect(facetCounts('drinks', drinks(), state({ show: 'can' })).views).toEqual({
      can: 2,
      all: 3,
      mocktails: 1,
      syrups: 2,
    })
    expect(facetCounts('drinks', drinks()).views).toEqual({ can: 2, all: 3, mocktails: 1, syrups: 2 })
    expect(facetCounts('drinks', []).views).toEqual({ can: 0, all: 0, mocktails: 0, syrups: 0 })
    // Views are a drinks thing: food reports none, even when its recipes would fit.
    expect(facetCounts('food', drinks()).views).toEqual({ can: 0, all: 0, mocktails: 0, syrups: 0 })
    expect(facetCounts('drinks', drinks(), state({ marks: ['favourite'] })).views).toEqual({
      can: 0,
      all: 1,
      mocktails: 0,
      syrups: 0,
    })
  })
})

suite('hiddenMatches', () => {
  const searching = (over: Partial<BrowseState>) => state({ q: 'x', show: 'can', ...over })

  it('points at All drinks first', () => {
    expect(hiddenMatches(drinks(), searching({ q: 'negroni' }))).toEqual({ view: 'all', count: 1 })
    expect(hiddenMatches(drinks(), searching({ show: 'mocktails' }))).toEqual({ view: 'all', count: 2 })
    expect(hiddenMatches(drinks(), searching({ show: 'syrups' }))).toEqual({ view: 'all', count: 3 })
  })

  it('then at Syrups & prep', () => {
    const syrups = drinks().filter((r) => r.category === 'syrups')
    expect(hiddenMatches(syrups, searching({ q: 'syrup' }))).toEqual({ view: 'syrups', count: 1 })
    const cocktails = drinks().filter((r) => r.slug !== 'negroni')
    expect(hiddenMatches(cocktails, searching({ show: 'all' }))).toEqual({ view: 'syrups', count: 2 })
  })

  it('applies the other filters', () => {
    expect(hiddenMatches(drinks(), searching({ marks: ['try_next'] }))).toBeNull()
    expect(hiddenMatches(drinks(), searching({ marks: ['favourite'] }))).toEqual({ view: 'all', count: 1 })
  })

  it('is null without a search, with nothing hidden, or on food', () => {
    expect(hiddenMatches(drinks(), state({ show: 'can' }))).toBeNull()
    expect(hiddenMatches(drinks().slice(0, 1), searching({}))).toBeNull()
    expect(hiddenMatches([], searching({}))).toBeNull()
    expect(hiddenMatches(drinks(), state({ q: 'x', show: null }))).toBeNull()
  })
})

suite('what you have', () => {
  it('round trips repeatable have params in order', () => {
    const parsed = parse('food', 'have=chicken&have=leeks')
    expect(parsed.have).toEqual(['chicken', 'leeks'])
    expect(browseQuery(parsed)).toBe('have=chicken&have=leeks')
  })

  it('writes nothing when there are no terms', () => {
    expect(browseQuery(state())).toBe('')
  })

  it('ignores have on drinks', () => {
    expect(parse('drinks', 'have=chicken').have).toEqual([])
  })

  it('trims terms and drops blanks', () => {
    expect(parse('food', 'have=&have=%20%20&have=%20leeks%20').have).toEqual(['leeks'])
  })

  it('keeps the first spelling of terms with the same key', () => {
    expect(parse('food', 'have=Leeks&have=leeks&have=LEEKS+').have).toEqual(['Leeks'])
  })

  it('counts at most 20 terms', () => {
    const query = Array.from({ length: 25 }, (_, i) => `have=item${i}`).join('&')
    const have = parse('food', query).have
    expect(have).toHaveLength(20)
    expect(have[19]).toBe('item19')
  })

  it('does not cut long terms', () => {
    const long = 'a'.repeat(80)
    expect(parse('food', `have=${long}`).have).toEqual([long])
  })

  it('makes a key that ignores case, accents and extra spaces', () => {
    expect(haveKey('  Crème   Fraîche ')).toBe('creme fraiche')
    expect(haveKey('Leeks')).toBe(haveKey('leeks'))
  })

  it('keeps the API order with terms, even with sort name', () => {
    const recipes = [recipe({ slug: 'b' }), recipe({ slug: 'a' }), recipe({ slug: 'c' })]
    const kept = applyBrowse(recipes, state({ have: ['leeks'], sort: 'name' }))
    expect(kept.map((r) => r.slug)).toEqual(['b', 'a', 'c'])
  })

  it('still filters by the other filters with terms', () => {
    const recipes = [recipe({ slug: 'b', category: 'sides' }), recipe({ slug: 'a' })]
    const kept = applyBrowse(recipes, state({ have: ['leeks'], category: 'mains' }))
    expect(kept.map((r) => r.slug)).toEqual(['a'])
  })

  it('describes the order as fewest missing first', () => {
    expect(describe(state({ have: ['leeks'] }))).toBe('fewest missing first')
    expect(describe(state({ have: ['leeks'], marks: ['favourite'], sort: 'time' }))).toBe(
      'Favourite, fewest missing first',
    )
  })

  it('says fewest missing first even when searching', () => {
    expect(describe(state({ have: ['leeks'], q: 'soup' }))).toBe('fewest missing first')
  })

  it('addTerm trims and appends', () => {
    expect(addTerm(state({ have: ['chicken'] }), '  leeks ').have).toEqual(['chicken', 'leeks'])
  })

  it('addTerm ignores blanks and duplicates by key', () => {
    const base = state({ have: ['Leeks'] })
    expect(addTerm(base, '   ')).toBe(base)
    expect(addTerm(base, 'leeks')).toBe(base)
  })

  it('addTerm stops at 20 terms', () => {
    const base = state({ have: Array.from({ length: 20 }, (_, i) => `item${i}`) })
    expect(addTerm(base, 'one more')).toBe(base)
  })

  it('removeTerm removes by key', () => {
    const base = state({ have: ['chicken', 'Leeks'] })
    expect(removeTerm(base, 'leeks').have).toEqual(['chicken'])
    expect(removeTerm(base, 'bogus')).toBe(base)
  })
})

suite('food quick filters', () => {
  // The eleven food recipes the spec's mockup uses.
  const meals = [
    recipe({ slug: 'apple-porridge', tags: ['breakfast', 'vegetarian'], marks: ['favourite'] }),
    recipe({ slug: 'pancakes', tags: ['breakfast'], marks: ['favourite'] }),
    recipe({ slug: 'carrot-buns', category: 'sides', tags: ['vegetarian', 'breakfast'] }),
    recipe({ slug: 'jambalaya', tags: ['dinner'] }),
    recipe({ slug: 'chutney-chicken', tags: ['dinner'] }),
    recipe({ slug: 'lemon-orzo', tags: ['dinner', 'kid approved', 'quick'] }),
    recipe({ slug: 'miso-mushrooms', category: 'sides', tags: ['breakfast', 'vegetarian'] }),
    recipe({ slug: 'overnight-oats', tags: ['breakfast', 'vegetarian'] }),
    recipe({ slug: 'pad-thai', tags: ['dinner'] }),
    recipe({ slug: 'chickpea-curry', tags: ['dinner', 'vegetarian', 'quick'] }),
    recipe({ slug: 'sesame-buns', category: 'sides', tags: ['vegetarian', 'breakfast'] }),
  ]
  const tabs = (s: BrowseState) =>
    quickFilters(meals, s, DEFAULT_QUICK_TAGS).tabs.map(({ label, count, on, disabled }) => [label, count, on, disabled])
  const chips = (s: BrowseState, recipes = meals, quick = DEFAULT_QUICK_TAGS) =>
    quickFilters(recipes, s, quick).chips.map(({ tag, count, on, disabled }) => [tag, count, on, disabled])

  it('counts with nothing on, leaving out empty categories', () => {
    expect(tabs(state())).toEqual([
      ['All', 11, true, false],
      ['Mains', 8, false, false],
      ['Sides', 3, false, false],
    ])
    expect(chips(state())).toEqual([
      ['breakfast', 6, false, false],
      ['dinner', 5, false, false],
      ['kid approved', 1, false, false],
      ['quick', 2, false, false],
      ['vegetarian', 6, false, false],
    ])
    expect(quickFilters(meals, state(), DEFAULT_QUICK_TAGS).active).toBe(false)
  })

  it('counts with a category on', () => {
    const mains = state({ category: 'mains' })
    expect(tabs(mains)).toEqual([
      ['All', 11, false, false],
      ['Mains', 8, true, false],
      ['Sides', 3, false, false],
    ])
    expect(chips(mains).map(([tag, n]) => [tag, n])).toEqual([
      ['breakfast', 3],
      ['dinner', 5],
      ['kid approved', 1],
      ['quick', 2],
      ['vegetarian', 3],
    ])
    expect(quickFilters(meals, mains, DEFAULT_QUICK_TAGS).active).toBe(true)
  })

  it('counts with two tags on, and the tabs follow the tags and marks', () => {
    const both = state({ tags: ['dinner', 'quick'] })
    expect(tabs(both)).toEqual([
      ['All', 2, true, false],
      ['Mains', 2, false, false],
      ['Sides', 0, false, true],
    ])
    expect(chips(both)).toEqual([
      ['breakfast', 0, false, true],
      ['dinner', 2, true, false],
      ['kid approved', 1, false, false],
      ['quick', 2, true, false],
      ['vegetarian', 1, false, false],
    ])
    expect(tabs(state({ marks: ['favourite'] }))[0]).toEqual(['All', 2, true, false])
  })

  it('dims an off chip that would leave nothing, never one that is on', () => {
    const breakfast = chips(state({ tags: ['breakfast'] }))
    expect(breakfast).toContainEqual(['kid approved', 0, false, true])
    expect(breakfast).toContainEqual(['breakfast', 6, true, false])
    // On and leaving nothing (a link can do that): still not dimmed.
    expect(chips(state({ tags: ['breakfast', 'kid approved'] }))).toContainEqual(['kid approved', 0, true, false])
  })

  it('never dims a picked tab or All', () => {
    const picked = tabs(state({ category: 'sides', tags: ['dinner'] }))
    expect(picked).toEqual([
      ['All', 5, false, false],
      ['Mains', 5, false, false],
      ['Sides', 0, true, false],
    ])
    expect(tabs(state({ category: 'desserts', tags: ['quick', 'breakfast'] }))).toEqual([
      ['All', 0, false, false],
      ['Mains', 0, false, true],
      ['Sides', 0, false, true],
      ['Desserts', 0, true, false],
    ])
  })

  it('keeps the configured order, leaves out unused quick tags and appends other tags that are on', () => {
    const quick = ['vegetarian', 'gluten free', 'breakfast']
    expect(chips(state({ tags: ['weeknight', 'breakfast'] }), meals, quick).map(([tag]) => tag)).toEqual([
      'vegetarian',
      'breakfast',
      'weeknight',
    ])
    const filters = quickFilters(meals, state({ tags: ['weeknight'] }), quick)
    expect(filters.chips.map(({ quick: q }) => q)).toEqual([true, true, false])
    expect(filters.quick).toEqual(['vegetarian', 'breakfast'])
    expect(filters.chips[2]).toMatchObject({ tag: 'weeknight', label: 'Weeknight', on: true, count: 0 })
  })

  it('shows no chips for an empty list', () => {
    expect(chips(state(), meals, [])).toEqual([])
  })

  it('matches setting entries to recipe tags by name key, using the most common spelling', () => {
    const recipes = [
      recipe({ slug: 'a', tags: ['Kid approved'] }),
      recipe({ slug: 'b', tags: ['kid  approved'] }),
      recipe({ slug: 'c', tags: ['Kid approved'] }),
      recipe({ slug: 'd', tags: ['Quick'] }),
      recipe({ slug: 'e', tags: ['quick'] }),
    ]
    expect(quickTagSpellings(recipes, [], ['KID APPROVED', 'quick', 'Kid Approved'])).toEqual(['Kid approved', 'quick'])
    const filters = quickFilters(recipes, state(), ['kid approved'])
    expect(filters.chips).toEqual([
      { tag: 'Kid approved', label: 'Kid approved', count: 2, on: false, disabled: false, quick: true },
    ])
  })

  it('keeps a quick tag that is on even when no recipe in the list has it', () => {
    expect(quickTagSpellings([], ['Breakfast'], DEFAULT_QUICK_TAGS)).toEqual(['Breakfast'])
    expect(quickTagSpellings([], [], DEFAULT_QUICK_TAGS)).toEqual([])
  })

  it('labels capitalise the first letter only', () => {
    const [chip] = quickFilters(meals, state(), ['kid approved']).chips
    expect(chip.label).toBe('Kid approved')
  })

  it('More tags leaves out the quick tags and keeps other tags that are on', () => {
    const { tags } = facetCounts('food', meals)
    const { quick } = quickFilters(meals, state(), DEFAULT_QUICK_TAGS)
    expect(moreTags([...tags, 'batch cook'], ['date night', 'breakfast'], quick)).toEqual(['batch cook', 'date night'])
    expect(moreTags(tags, [], quick)).toEqual([])
  })
})
