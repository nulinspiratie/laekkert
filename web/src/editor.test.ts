import { describe, expect, test } from 'vitest'
import { emptyState, isDirty, move, parseAmount, stateFromRecipe, toDraft, validate, type EditorState } from './editor'
import type { Recipe } from './types'

const recipe: Recipe = {
  format_version: 2,
  slug: 'dal',
  side: 'food',
  name: 'Red lentil dal',
  category: 'mains',
  servings: 4,
  time_minutes: 35,
  ingredients: [
    { amount: 250, unit: 'g', item: 'red lentils', note: 'rinsed', no_scale: false, original: '', g_per_tsp: null },
    { amount: null, unit: 'g', item: 'flour', note: '', no_scale: false, original: '1 cup', g_per_tsp: null },
    { amount: 0.5, unit: 'piece', item: 'lime', note: '', no_scale: true, original: '', g_per_tsp: null },
  ],
  steps: ['Cook.', 'Serve.'],
  source: { url: 'https://example.com/dal', photo: null },
  tags: ['weeknight'],
  marks: [],
  image: 'dal.jpg',
  rating: null,
  last_made: null,
}

/** A valid state to break one field at a time. */
function valid(): EditorState {
  const state = emptyState('food')
  state.name = 'Soup'
  state.rows[0] = { ...state.rows[0], amount: '2', unit: 'g', item: 'salt' }
  return state
}

describe('parseAmount', () => {
  test.each([
    ['2.5', 2.5],
    ['2,5', 2.5],
    ['½', 0.5],
    ['1½', 1.5],
    ['1 ½', 1.5],
    ['1/2', 0.5],
    ['1 1/2', 1.5],
    [' 3 ', 3],
    ['.5', 0.5],
    ['0', 0],
    ['', null],
    ['   ', null],
  ])('%j is %j', (text, expected) => {
    expect(parseAmount(text)).toBe(expected)
  })

  test.each(['abc', '-1', '1/0', '1 2', '2..5', '1/', '1,2,3'])('%j is invalid', (text) => {
    expect(parseAmount(text)).toBe('invalid')
  })
})

describe('emptyState', () => {
  test('food starts with the first category, 4 servings, a blank row and a blank step', () => {
    const state = emptyState('food')
    expect(state.category).toBe('mains')
    expect(state.servings).toBe('4')
    expect(state.rows).toHaveLength(1)
    expect(state.steps).toHaveLength(1)
    expect(state.steps[0].text).toBe('')
    expect(state.sourceMode).toBe('none')
  })

  test('drinks start with cocktails and 1 serving', () => {
    const state = emptyState('drinks')
    expect(state.category).toBe('cocktails')
    expect(state.servings).toBe('1')
  })
})

describe('stateFromRecipe', () => {
  test('puts every field in as text', () => {
    const state = stateFromRecipe(recipe)
    expect(state).toMatchObject({
      name: 'Red lentil dal',
      category: 'mains',
      servings: '4',
      time: '35',
      sourceMode: 'link',
      sourceUrl: 'https://example.com/dal',
      sourcePhoto: null,
      tags: ['weeknight'],
      image: 'dal.jpg',
    })
    expect(state.rows.map((r) => [r.amount, r.unit, r.item, r.note, r.no_scale, r.original])).toEqual([
      ['250', 'g', 'red lentils', 'rinsed', false, ''],
      ['', 'g', 'flour', '', false, '1 cup'],
      ['0.5', 'piece', 'lime', '', true, ''],
    ])
    expect(state.steps.map((s) => s.text)).toEqual(['Cook.', 'Serve.'])
    expect(new Set(state.rows.map((r) => r.key)).size).toBe(3)
  })

  test('a photo source and a missing time', () => {
    const state = stateFromRecipe({ ...recipe, time_minutes: null, source: { url: null, photo: 'page.jpg' } })
    expect(state).toMatchObject({ time: '', sourceMode: 'photo', sourcePhoto: 'page.jpg', sourceUrl: '' })
    expect(stateFromRecipe({ ...recipe, source: null }).sourceMode).toBe('none')
  })
})

describe('validate', () => {
  test('a good state has no errors', () => {
    expect(validate(valid())).toEqual([])
  })

  test('needs a name', () => {
    const state = { ...valid(), name: '  ' }
    expect(validate(state)).toEqual(['Give the recipe a name'])
  })

  test('needs at least one ingredient; blank rows do not count', () => {
    const state = valid()
    state.rows = [{ ...state.rows[0], amount: '', item: '' }]
    expect(validate(state)).toEqual(['Add at least one ingredient'])
  })

  test('numbers ingredient problems by their place in the form', () => {
    const state = valid()
    const row = state.rows[0]
    state.rows = [
      row,
      { ...row, key: 'b', item: '' },
      { ...row, key: 'c', unit: 'tsp', amount: '' },
      { ...row, key: 'd', unit: 'tbsp', amount: '0' },
      { ...row, key: 'e', amount: 'lots' },
      { ...row, key: 'f', amount: '' },
      { ...row, key: 'g', amount: '0' },
      { ...row, key: 'h', amount: '100001' },
    ]
    expect(validate(state)).toEqual([
      'Ingredient 2 needs a name',
      'Ingredient 3 needs an amount in tsp',
      'Ingredient 4 needs an amount above 0',
      'Ingredient 5 needs a number for the amount',
      'Ingredient 6 needs an amount in g',
      'Ingredient 7 needs an amount above 0',
      "Ingredient 8's amount is too large",
    ])
  })

  test('a row with only an original passes; a to taste row needs no amount', () => {
    const state = valid()
    const row = state.rows[0]
    state.rows = [
      { ...row, amount: '', original: '1 cup' },
      { ...row, key: 'b', amount: '', unit: 'to taste' },
      { ...row, key: 'c', amount: '', unit: 'pinch' },
    ]
    expect(validate(state)).toEqual([])
  })

  test('servings bounds', () => {
    expect(validate({ ...valid(), servings: '' })).toEqual(['Servings must be at least 1'])
    expect(validate({ ...valid(), servings: '0' })).toEqual(['Servings must be at least 1'])
    expect(validate({ ...valid(), servings: '1001' })).toEqual(['Servings can be at most 1000'])
    expect(validate({ ...valid(), servings: '2.5' })).toEqual(['Servings must be a whole number'])
    expect(validate({ ...valid(), servings: '1000' })).toEqual([])
  })

  test('time bounds', () => {
    expect(validate({ ...valid(), time: '' })).toEqual([])
    expect(validate({ ...valid(), time: '0' })).toEqual([])
    expect(validate({ ...valid(), time: '10080' })).toEqual([])
    expect(validate({ ...valid(), time: '-5' })).toEqual(["Cooking time can't be negative"])
    expect(validate({ ...valid(), time: '10081' })).toEqual(['Cooking time can be at most a week'])
    expect(validate({ ...valid(), time: '1.5' })).toEqual(['Cooking time must be a whole number of minutes'])
  })

  test('a source link must start with http:// or https://', () => {
    const link = { ...valid(), sourceMode: 'link' as const }
    expect(validate({ ...link, sourceUrl: 'example.com' })).toEqual([
      'The source link must start with http:// or https://',
    ])
    expect(validate({ ...link, sourceUrl: ' HTTPS://example.com ' })).toEqual([])
    expect(validate({ ...link, sourceUrl: '' })).toEqual([])
    // A link typed and then switched away from is not sent, so it is not checked.
    expect(validate({ ...valid(), sourceMode: 'none', sourceUrl: 'example.com' })).toEqual([])
  })
})

describe('toDraft', () => {
  test('a recipe round-trips into exactly the draft fields', () => {
    expect(toDraft(stateFromRecipe(recipe))).toEqual({
      name: 'Red lentil dal',
      category: 'mains',
      servings: 4,
      time_minutes: 35,
      ingredients: [
        { amount: 250, unit: 'g', item: 'red lentils', note: 'rinsed', no_scale: false, original: '' },
        { amount: null, unit: 'g', item: 'flour', note: '', no_scale: false, original: '1 cup' },
        { amount: 0.5, unit: 'piece', item: 'lime', note: '', no_scale: true, original: '' },
      ],
      steps: ['Cook.', 'Serve.'],
      source: { url: 'https://example.com/dal', photo: null },
      tags: ['weeknight'],
      image: 'dal.jpg',
    })
  })

  test('drops blank rows and steps, and trims', () => {
    const state = valid()
    state.name = '  Soup '
    state.time = ''
    state.rows.push({ ...state.rows[0], key: 'blank', amount: '', item: ' ', note: '' })
    state.steps = [
      { key: 'a', text: '  Stir. ' },
      { key: 'b', text: '   ' },
    ]
    const draft = toDraft(state)
    expect(draft.name).toBe('Soup')
    expect(draft.time_minutes).toBeNull()
    expect(draft.ingredients).toHaveLength(1)
    expect(draft.steps).toEqual(['Stir.'])
  })

  test('typing an amount clears the original; leaving it blank keeps it', () => {
    const state = stateFromRecipe(recipe)
    expect(toDraft(state).ingredients[1]).toMatchObject({ amount: null, original: '1 cup' })
    state.rows[1] = { ...state.rows[1], amount: '1½' }
    expect(toDraft(state).ingredients[1]).toMatchObject({ amount: 1.5, original: '' })
  })

  test('tsp and tbsp are sent as they are for the server to convert', () => {
    const state = valid()
    state.rows[0] = { ...state.rows[0], amount: '2', unit: 'tsp' }
    expect(toDraft(state).ingredients[0]).toMatchObject({ amount: 2, unit: 'tsp' })
  })

  test('the source follows the mode', () => {
    const base: EditorState = { ...valid(), sourceUrl: ' https://a.example ', sourcePhoto: 'page.jpg' }
    expect(toDraft({ ...base, sourceMode: 'none' }).source).toBeNull()
    expect(toDraft({ ...base, sourceMode: 'link' }).source).toEqual({ url: 'https://a.example', photo: null })
    expect(toDraft({ ...base, sourceMode: 'photo' }).source).toEqual({ url: null, photo: 'page.jpg' })
    expect(toDraft({ ...base, sourceMode: 'photo', sourcePhoto: null }).source).toBeNull()
    expect(toDraft({ ...base, sourceMode: 'link', sourceUrl: ' ' }).source).toBeNull()
  })

  test('keeps the tags and the image', () => {
    const state = { ...valid(), tags: ['a', 'b'], image: 'up.png' }
    const draft = toDraft(state)
    expect(draft.tags).toEqual(['a', 'b'])
    expect(draft.image).toBe('up.png')
  })
})

describe('move', () => {
  test('swaps with a neighbour without changing the original', () => {
    const list = ['a', 'b', 'c']
    expect(move(list, 1, -1)).toEqual(['b', 'a', 'c'])
    expect(move(list, 1, 1)).toEqual(['a', 'c', 'b'])
    expect(list).toEqual(['a', 'b', 'c'])
  })

  test('does nothing past either end', () => {
    expect(move(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(move(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
})

describe('isDirty', () => {
  test('a copy is clean; keys do not count', () => {
    const initial = stateFromRecipe(recipe)
    expect(isDirty(initial, stateFromRecipe(recipe))).toBe(false)
  })

  test('any edit is dirty', () => {
    const initial = stateFromRecipe(recipe)
    expect(isDirty(initial, { ...initial, name: 'Dal' })).toBe(true)
    expect(isDirty(initial, { ...initial, tags: [] })).toBe(true)
    expect(isDirty(initial, { ...initial, rows: move(initial.rows, 0, 1) })).toBe(true)
    expect(isDirty(initial, { ...initial, image: null })).toBe(true)
  })

  test('a new form is clean until something is typed', () => {
    const initial = emptyState('food')
    expect(isDirty(initial, emptyState('food'))).toBe(false)
    expect(isDirty(initial, { ...initial, name: 'x' })).toBe(true)
  })
})
