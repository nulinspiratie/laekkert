import { describe, expect, it } from 'vitest'
import {
  badge,
  fresh,
  groupByKind,
  KIND_LABELS,
  KINDS,
  matchItem,
  nameList,
  normalise,
  shelf,
  topFresh,
  unsorted,
  usedText,
} from './bar'
import type { BarItem, DrinkBar, RecipeSummary } from './types'

function item(over: Partial<BarItem> & { name: string }): BarItem {
  return {
    aliases: [],
    kind: 'spirits',
    fresh: false,
    state: 'have',
    used_in: [],
    recipe: null,
    ...over,
  }
}

function drinkBar(over: Partial<DrinkBar> = {}): DrinkBar {
  return { status: 'can_make', missing: [], unsorted: [], fresh: [], ...over }
}

function drink(slug: string, bar?: DrinkBar): RecipeSummary {
  return {
    slug,
    name: slug,
    side: 'drinks',
    category: 'cocktails',
    time_minutes: null,
    tags: [],
    marks: [],
    image: null,
    rating: null,
    last_made: null,
    bar,
  }
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

describe('shelf, fresh and unsorted', () => {
  const items = [
    item({ name: 'Gin' }),
    item({ name: 'Rum', state: 'dont' }),
    item({ name: 'Mezcal', state: null }),
    item({ name: 'Limes', fresh: true, state: null, kind: 'other' }),
  ]

  it('splits the items', () => {
    expect(shelf(items).map((i) => i.name)).toEqual(['Gin', 'Rum', 'Mezcal'])
    expect(fresh(items).map((i) => i.name)).toEqual(['Limes'])
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

  it('names what to buy fresh, shorter on a phone', () => {
    const bar = drinkBar({ status: 'fresh_only', fresh: ['limes'] })
    expect(badge(bar, false)).toEqual({ kind: 'fresh_only', text: 'Buy fresh: limes' })
    expect(badge(bar, true)).toEqual({ kind: 'fresh_only', text: 'Buy: limes' })
  })

  it('names what is missing', () => {
    const bar = drinkBar({ status: 'missing', missing: ['orgeat', 'rum', 'lime'] })
    expect(badge(bar, false)).toEqual({ kind: 'missing', text: 'Missing: orgeat, rum +1' })
  })

  it('names what is not sorted', () => {
    const bar = drinkBar({ status: 'unsorted', unsorted: ['falernum'] })
    expect(badge(bar, true)).toEqual({ kind: 'unsorted', text: 'Not sorted: falernum' })
  })

  it('says a drink can be made even when the lists are filled in', () => {
    expect(badge(drinkBar({ status: 'can_make', fresh: ['limes'] }), false).text).toBe('Can make now')
  })
})

describe('topFresh', () => {
  const needing = (...fresh: string[]) => drink(`d${Math.random()}`, drinkBar({ status: 'fresh_only', fresh }))

  it('is null when no drink needs only fresh items', () => {
    expect(topFresh([])).toBeNull()
    expect(topFresh([drink('a', drinkBar()), drink('b', drinkBar({ status: 'missing', missing: ['x'] }))])).toBeNull()
    expect(topFresh([drink('food')])).toBeNull()
  })

  it('returns the fresh item most of the fresh-only drinks need', () => {
    const list = [needing('limes'), needing('limes', 'mint'), needing('mint', 'limes'), needing('egg white')]
    expect(topFresh(list)).toEqual({ item: 'limes', count: 3 })
  })

  it('ignores drinks that are not fresh-only', () => {
    const list = [
      needing('mint'),
      drink('x', drinkBar({ status: 'missing', missing: ['rum'], fresh: ['limes'] })),
      drink('y', drinkBar({ status: 'can_make', fresh: ['limes'] })),
    ]
    expect(topFresh(list)).toEqual({ item: 'mint', count: 1 })
  })

  it('breaks ties by the first name alphabetically', () => {
    expect(topFresh([needing('mint'), needing('limes')])).toEqual({ item: 'limes', count: 1 })
  })
})
