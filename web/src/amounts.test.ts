import { describe, expect, test } from 'vitest'
import { formatAmount, fraction } from './amounts'
import type { RecipeIngredient } from './types'

function ing(over: Partial<RecipeIngredient>): RecipeIngredient {
  return {
    amount: 1,
    unit: 'g',
    item: 'thing',
    note: '',
    no_scale: false,
    original: '',
    g_per_tsp: null,
    ...over,
  }
}

describe('metric', () => {
  test.each([
    [250, 1, '250 g'],
    [250, 0.25, '63 g'],
    [6, 0.5, '3 g'],
    [3, 1 / 3, '1 g'],
    [0.4, 1, '0.5 g'],
    [2.5, 1, '2.5 g'],
    [412, 1, '410 g'],
  ])('%s g x%s -> %s', (amount, factor, text) => {
    expect(formatAmount(ing({ amount }), factor, 'metric')).toEqual({ text, flag: null })
  })

  test('ml keeps its unit', () => {
    expect(formatAmount(ing({ amount: 30, unit: 'ml' }), 1, 'metric').text).toBe('30 ml')
  })
})

describe('pieces', () => {
  test.each([
    [1, 1.5, '1½'],
    [3, 7 / 4, '5'],
    [1, 0.25, '¼'],
    [2, 0.3, '½'],
    [1, 0.1, '¼'],
  ])('%s piece x%s -> %s', (amount, factor, text) => {
    expect(formatAmount(ing({ amount, unit: 'piece' }), factor, 'metric')).toEqual({
      text,
      flag: null,
    })
  })

  test('pinch and dash add their unit word', () => {
    expect(formatAmount(ing({ amount: 1, unit: 'pinch' }), 0.5, 'metric').text).toBe('½ pinch')
    expect(formatAmount(ing({ amount: 2, unit: 'dash' }), 1, 'metric').text).toBe('2 dash')
  })
})

describe('spoons', () => {
  test.each([
    [30, 'ml', '2 tbsp'],
    [2.5, 'ml', '½ tsp'],
    [100, 'ml', '100 ml'],
    [3.75, 'ml', '¾ tsp'],
    [14, 'ml', '2¾ tsp'],
  ] as const)('%s %s in spoons -> %s', (amount, unit, text) => {
    expect(formatAmount(ing({ amount, unit }), 1, 'spoons')).toEqual({ text, flag: null })
  })

  test('an amount that rounds up to 3 tsp shows as tbsp', () => {
    expect(formatAmount(ing({ amount: 14.5, unit: 'ml' }), 1, 'spoons').text).toBe('1 tbsp')
  })

  test('exact boundaries land on the spoon side', () => {
    // 27.6 / 2.3 is 12.000000000000002 in floating point: still 4 tbsp, not "28 g".
    const spice = ing({ amount: 27.6, g_per_tsp: 2.3 })
    expect(formatAmount(spice, 1, 'spoons')).toEqual({ text: '4 tbsp', flag: null })
    // 6.9 / 2.3 is 3.0000000000000004: 1 tbsp, not "3 tsp".
    expect(formatAmount(ing({ amount: 6.9, g_per_tsp: 2.3 }), 1, 'spoons').text).toBe('1 tbsp')
  })

  test('grams convert with g_per_tsp', () => {
    const paprika = ing({ amount: 2.3, item: 'smoked paprika', g_per_tsp: 2.3 })
    expect(formatAmount(paprika, 1, 'spoons')).toEqual({ text: '1 tsp', flag: null })
    expect(formatAmount(paprika, 1, 'metric')).toEqual({ text: '2.5 g', flag: null })
  })

  test('grams without g_per_tsp stay metric, flagged when small', () => {
    expect(formatAmount(ing({ amount: 5, item: 'ginger' }), 1, 'spoons')).toEqual({
      text: '5 g',
      flag: 'no-spoon-conversion',
    })
    expect(formatAmount(ing({ amount: 400 }), 1, 'spoons')).toEqual({ text: '400 g', flag: null })
  })

  test('pieces are untouched in spoons mode', () => {
    expect(formatAmount(ing({ amount: 2, unit: 'piece' }), 1, 'spoons').text).toBe('2')
  })
})

describe('special rows', () => {
  test.each(['metric', 'spoons'] as const)('unparsed amount keeps original (%s)', (mode) => {
    const row = ing({ amount: null, original: '1 tsp' })
    expect(formatAmount(row, 2, mode)).toEqual({ text: '1 tsp', flag: 'not-metric' })
  })

  test('no_scale ignores the factor', () => {
    const lemon = ing({ amount: 1, unit: 'piece', item: 'lemon', no_scale: true })
    expect(formatAmount(lemon, 3, 'metric').text).toBe('1')
  })

  test('to taste wins over an original string', () => {
    const salt = ing({ amount: null, unit: 'to taste', item: 'salt', original: 'salt to taste' })
    expect(formatAmount(salt, 1, 'metric')).toEqual({ text: '', flag: null })
  })

  test('to taste has no amount text', () => {
    const salt = ing({ amount: null, unit: 'to taste', item: 'salt' })
    expect(formatAmount(salt, 3, 'metric')).toEqual({ text: '', flag: null })
  })
})

describe('fraction', () => {
  test.each([
    [5, '5'],
    [1.5, '1½'],
    [0.25, '¼'],
    [0.75, '¾'],
    [2.25, '2¼'],
  ])('%s -> %s', (n, text) => {
    expect(fraction(n)).toBe(text)
  })
})
