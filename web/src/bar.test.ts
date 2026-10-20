import { describe, expect, it } from 'vitest'
import {
  badge,
  groupByKind,
  KIND_LABELS,
  KINDS,
  matchItem,
  nameList,
  normalise,
  shelf,
  TRACKED_KINDS,
  unsorted,
  untracked,
  usedText,
  withBar,
} from './bar'
import type { Bar, BarItem, DrinkBar, Recipe } from './types'

function item(over: Partial<BarItem> & { name: string }): BarItem {
  return {
    aliases: [],
    kind: 'spirits',
    tracked: true,
    untracked_because: null,
    state: 'have',
    used_in: [],
    recipe: null,
    ...over,
  }
}

function drinkBar(over: Partial<DrinkBar> = {}): DrinkBar {
  return { status: 'can_make', missing: [], unsorted: [], untracked: [], ...over }
}

describe('kinds', () => {
  it('has the fixed order and the spec labels', () => {
    expect(KINDS).toEqual(['spirits', 'liqueurs', 'aperitifs', 'bitters', 'syrups', 'other'])
    expect(KIND_LABELS).toEqual({
      spirits: 'Spirits',
      liqueurs: 'Liqueurs',
      aperitifs: 'Aperitifs and vermouth',
      bitters: 'Bitters',
      syrups: 'Syrups',
      other: 'Other',
    })
  })
})

describe('tracked kinds', () => {
  it('is the kinds without syrups', () => {
    expect(TRACKED_KINDS).toEqual(['spirits', 'liqueurs', 'aperitifs', 'bitters', 'other'])
  })
})

describe('normalise', () => {
  it('lower-cases, strips accents and collapses whitespace', () => {
    expect(normalise('  Crème   de  Violette ')).toBe('creme de violette')
    expect(normalise('Crème de violette')).toBe(normalise('creme  de violette'))
  })

  it('folds compatibility forms', () => {
    expect(normalise('ＧＩＮ')).toBe('gin')
  })
})

describe('matchItem', () => {
  const gin = item({ name: 'Gin', aliases: ['London dry gin', 'Génévrier'] })

  it('matches everything for an empty search', () => {
    expect(matchItem(gin, '')).toEqual({ ok: true, alias: null })
    expect(matchItem(gin, '   ')).toEqual({ ok: true, alias: null })
  })

  it('matches the name by substring, ignoring case and accents', () => {
    expect(matchItem(item({ name: 'Crème de cassis' }), 'CREME')).toEqual({ ok: true, alias: null })
    expect(matchItem(gin, 'gi')).toEqual({ ok: true, alias: null })
  })

  it('falls back to an alias and returns it as written', () => {
    expect(matchItem(gin, 'london')).toEqual({ ok: true, alias: 'London dry gin' })
    expect(matchItem(gin, 'genev')).toEqual({ ok: true, alias: 'Génévrier' })
  })

  it('prefers the name over an alias', () => {
    expect(matchItem(gin, 'gin')).toEqual({ ok: true, alias: null })
  })

  it('does not match anything else', () => {
    expect(matchItem(gin, 'rum')).toEqual({ ok: false, alias: null })
  })
})

describe('usedText', () => {
  it('counts drinks', () => {
    expect(usedText(0)).toBe('Not in any drink yet')
    expect(usedText(1)).toBe('Used in 1 drink')
    expect(usedText(4)).toBe('Used in 4 drinks')
  })
})

describe('shelf, untracked and unsorted', () => {
  const items = [
    item({ name: 'Gin' }),
    item({ name: 'Rum', state: 'dont' }),
    item({ name: 'Mezcal', state: null }),
    item({ name: 'Limes', tracked: false, untracked_because: 'marked', state: null, kind: 'other' }),
    item({ name: 'Simple syrup', tracked: false, untracked_because: 'syrups', state: null, kind: 'syrups' }),
  ]

  it('splits the items', () => {
    expect(shelf(items).map((i) => i.name)).toEqual(['Gin', 'Rum', 'Mezcal'])
    expect(untracked(items).map((i) => i.name)).toEqual(['Limes', 'Simple syrup'])
    expect(unsorted(items).map((i) => i.name)).toEqual(['Mezcal'])
  })
})

describe('groupByKind', () => {
  it('groups in the fixed order, drops empty groups and counts what is in', () => {
    const items = [
      item({ name: 'Cointreau', kind: 'liqueurs' }),
      item({ name: 'Salt', kind: 'other', state: 'dont' }),
      item({ name: 'Gin', kind: 'spirits' }),
      item({ name: 'Rum', kind: 'spirits', state: 'dont' }),
    ]
    expect(groupByKind(items).map((g) => [g.kind, g.items.map((i) => i.name), g.have])).toEqual([
      ['spirits', ['Gin', 'Rum'], 1],
      ['liqueurs', ['Cointreau'], 1],
      ['other', ['Salt'], 0],
    ])
  })

  it('has no group for syrups', () => {
    const items = [item({ name: 'Gin' }), item({ name: 'Grenadine', kind: 'syrups', tracked: false })]
    expect(groupByKind(items).map((g) => g.kind)).toEqual(['spirits'])
  })

  it('is empty for no items', () => {
    expect(groupByKind([])).toEqual([])
  })
})

describe('nameList', () => {
  it('lists up to two names', () => {
    expect(nameList(['a'])).toBe('a')
    expect(nameList(['a', 'b'])).toBe('a, b')
  })

  it('shows the first two and the rest as +N', () => {
    expect(nameList(['a', 'b', 'c'])).toBe('a, b +1')
    expect(nameList(['a', 'b', 'c', 'd', 'e'])).toBe('a, b +3')
  })

  it('takes another maximum', () => {
    expect(nameList(['a', 'b', 'c'], 3)).toBe('a, b, c')
    expect(nameList(['a', 'b', 'c', 'd'], 1)).toBe('a +3')
  })
})

describe('badge', () => {
  it('says a drink can be made', () => {
    expect(badge(drinkBar(), false)).toEqual({ kind: 'can_make', text: 'Can make now' })
    expect(badge(drinkBar(), true)).toEqual({ kind: 'can_make', text: 'Can make now' })
  })

  it('says Also needs when untracked items are left', () => {
    expect(badge(drinkBar({ untracked: ['lime juice', 'mint', 'soda'] }), false)).toEqual({
      kind: 'also',
      text: 'Also needs: lime juice, mint +1',
    })
    expect(badge(drinkBar({ untracked: ['limes'] }), true)).toEqual({ kind: 'also', text: 'Also needs: limes' })
  })

  it('names what is missing', () => {
    const bar = drinkBar({ status: 'missing', missing: ['orgeat', 'rum', 'lime'] })
    expect(badge(bar, false)).toEqual({ kind: 'missing', text: 'Missing: orgeat, rum +1' })
  })

  it('names what is not sorted', () => {
    const bar = drinkBar({ status: 'unsorted', unsorted: ['falernum'] })
    expect(badge(bar, true)).toEqual({ kind: 'unsorted', text: 'Not sorted: falernum' })
  })

  it('keeps missing ahead of untracked items', () => {
    const bar = drinkBar({ status: 'missing', missing: ['rum'], untracked: ['limes'] })
    expect(badge(bar, false).kind).toBe('missing')
  })
})

describe('withBar', () => {
  const ing = (item: string, bar: Recipe['ingredients'][number]['bar']) => ({
    amount: 30,
    unit: 'ml' as const,
    item,
    note: '',
    no_scale: false,
    original: item,
    g_per_tsp: null,
    bar,
  })
  const recipe = (category: string, ingredients: Recipe['ingredients']): Recipe => ({
    slug: 'x',
    name: 'x',
    side: 'drinks',
    category,
    time_minutes: null,
    tags: [],
    marks: [],
    image: null,
    rating: null,
    last_made: null,
    format_version: 1,
    servings: 1,
    ingredients,
    steps: [],
    source: null,
    version: 1,
    bar: null,
  })
  const bar: Bar = {
    set_up: true,
    counts: { can_make: 0, missing: 0, unsorted: 0, total: 0 },
    items: [
      item({ name: 'Rum', state: 'dont' }),
      item({ name: 'Gin', state: null }),
      item({ name: 'Limes', tracked: false, untracked_because: 'marked', state: null, kind: 'other' }),
    ],
  }
  const rows = () => [
    ing('rum', { item: 'Rum', state: 'have', tracked: true, recipe: null }),
    ing('gin', { item: 'Gin', state: 'have', tracked: true, recipe: null }),
    ing('limes', { item: 'Limes', state: null, tracked: true, recipe: null }),
  ]

  it('recomputes the bar from the new items', () => {
    const result = withBar(recipe('cocktails', rows()), bar)
    expect(result.bar).toEqual({ status: 'missing', missing: ['Rum'], unsorted: ['Gin'], untracked: ['Limes'] })
    expect(result.ingredients.map((i) => i.bar?.tracked)).toEqual([true, true, false])
  })

  it('can make once only untracked items are left', () => {
    const only = [ing('limes', { item: 'Limes', state: null, tracked: true, recipe: null })]
    expect(withBar(recipe('mocktails', only), bar).bar).toEqual({
      status: 'can_make',
      missing: [],
      unsorted: [],
      untracked: ['Limes'],
    })
  })

  it('leaves syrups and prep without a bar', () => {
    expect(withBar(recipe('syrups', rows()), bar).bar).toBeNull()
    expect(withBar(recipe('prep', rows()), bar).bar).toBeNull()
  })
})
