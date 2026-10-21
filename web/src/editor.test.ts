import { describe, expect, test } from 'vitest'
import {
  blankHeading,
  emptyState,
  grouped,
  isDirty,
  isHeading,
  move,
  parseAmount,
  stateFromRecipe,
  toDraft,
  validate,
  type EditorHeading,
  type EditorRow,
  type EditorStep,
  type EditorState,
} from './editor'
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
    { amount: 250, unit: 'g', item: 'red lentils', note: 'rinsed', no_scale: false, original: '', group: '', g_per_tsp: null },
    { amount: null, unit: 'g', item: 'flour', note: '', no_scale: false, original: '1 cup', group: '', g_per_tsp: null },
    { amount: 0.5, unit: 'piece', item: 'lime', note: '', no_scale: true, original: '', group: '', g_per_tsp: null },
  ],
  steps: [
    { text: 'Cook.', group: '' },
    { text: 'Serve.', group: '' },
  ],
  notes: '',
  source: { url: 'https://example.com/dal', photo: null },
  tags: ['weeknight'],
  marks: [],
  image: 'dal.jpg',
  rating: null,
  last_made: null,
  version: 0,
}

/** The ingredient rows of a state, without its headings. */
function rowsOf(state: EditorState): EditorRow[] {
  return state.rows.filter((entry): entry is EditorRow => !isHeading(entry))
}

/** The steps of a state, without its headings. */
function stepsOf(state: EditorState): EditorStep[] {
  return state.steps.filter((entry): entry is EditorStep => !isHeading(entry))
}

function heading(name: string): EditorHeading {
  return { ...blankHeading(), name }
}

/** A valid state to break one field at a time. */
function valid(): EditorState {
  const state = emptyState('food')
  state.name = 'Soup'
  state.rows[0] = { ...rowsOf(state)[0], amount: '2', unit: 'g', item: 'salt' }
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
    expect(stepsOf(state)[0].text).toBe('')
    expect(state.sourceMode).toBe('none')
  })

  test('starts with empty notes and no headings', () => {
    const state = emptyState('food')
    expect(state.notes).toBe('')
    expect(state.rows.some(isHeading)).toBe(false)
    expect(state.steps.some(isHeading)).toBe(false)
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
    expect(rowsOf(state).map((r) => [r.amount, r.unit, r.item, r.note, r.no_scale, r.original])).toEqual([
      ['250', 'g', 'red lentils', 'rinsed', false, ''],
      ['', 'g', 'flour', '', false, '1 cup'],
      ['0.5', 'piece', 'lime', '', true, ''],
    ])
    expect(stepsOf(state).map((s) => s.text)).toEqual(['Cook.', 'Serve.'])
    expect(new Set(rowsOf(state).map((r) => r.key)).size).toBe(3)
  })

  test('puts a heading before each run of a group, and a blank one where a run has none', () => {
    const groups = ['', 'A', 'A', '']
    const state = stateFromRecipe({
      ...recipe,
      ingredients: groups.map((group, i) => ({ ...recipe.ingredients[0], item: `item ${i}`, group })),
      steps: [
        { text: 'One.', group: 'Day before' },
        { text: 'Two.', group: 'Day before' },
        { text: 'Three.', group: 'To serve' },
      ],
      notes: 'Keeps a week.',
    })
    expect(state.rows.map((e) => (isHeading(e) ? `# ${e.name}` : e.item))).toEqual([
      'item 0',
      '# A',
      'item 1',
      'item 2',
      '# ',
      'item 3',
    ])
    expect(state.steps.map((e) => (isHeading(e) ? `# ${e.name}` : e.text))).toEqual([
      '# Day before',
      'One.',
      'Two.',
      '# To serve',
      'Three.',
    ])
    expect(state.notes).toBe('Keeps a week.')
    const keys = [...state.rows, ...state.steps].map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('a recipe with no groups gets no headings', () => {
    const state = stateFromRecipe(recipe)
    expect(state.rows.some(isHeading)).toBe(false)
    expect(state.steps.some(isHeading)).toBe(false)
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
    state.rows = [{ ...rowsOf(state)[0], amount: '', item: '' }]
    expect(validate(state)).toEqual(['Add at least one ingredient'])
  })

  test('numbers ingredient problems by their place in the form', () => {
    const state = valid()
    const row = rowsOf(state)[0]
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
    const row = rowsOf(state)[0]
    state.rows = [
      { ...row, amount: '', original: '1 cup' },
      { ...row, key: 'b', amount: '', unit: 'to taste' },
      { ...row, key: 'c', amount: '', unit: 'pinch' },
    ]
    expect(validate(state)).toEqual([])
  })

  test('ingredient numbers skip headings', () => {
    const state = valid()
    state.rows = [heading('Sauce'), { ...rowsOf(state)[0], key: 'b', item: '' }]
    expect(validate(state)).toEqual(['Ingredient 1 needs a name'])
  })

  test('a group name can be at most 60 characters, counted once spaces are collapsed', () => {
    const state = valid()
    state.rows = [heading('x'.repeat(60)), ...state.rows]
    expect(validate(state)).toEqual([])
    state.rows = [heading('x'.repeat(61)), ...state.rows.slice(1)]
    expect(validate(state)).toEqual(['A group name can be at most 60 characters'])
    state.rows = [heading(`${'x'.repeat(58)}   y`), ...state.rows.slice(1)]
    expect(validate(state)).toEqual([])
    state.rows = state.rows.slice(1)
    state.steps = [heading('y'.repeat(61)), ...state.steps]
    expect(validate(state)).toEqual(['A group name can be at most 60 characters'])
  })

  test('the notes can be at most 5000 characters', () => {
    const state = valid()
    state.notes = 'n'.repeat(5000)
    expect(validate(state)).toEqual([])
    state.notes = 'n'.repeat(5001)
    expect(validate(state)).toEqual(['The notes can be at most 5000 characters'])
    // Trailing spaces and the ends are tidied by the server before it counts.
    state.notes = `${'n'.repeat(5000)}   \n\n`
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

  test('a number box holding unreadable text is an error, not a blank', () => {
    expect(validate(valid(), { servings: true })).toEqual(['Servings must be a whole number'])
    expect(validate(valid(), { time: true })).toEqual(['Cooking time must be a whole number of minutes'])
    expect(validate({ ...valid(), servings: '' }, { servings: true })).toEqual(['Servings must be a whole number'])
    expect(validate(valid(), { servings: false, time: false })).toEqual([])
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
        { amount: 250, unit: 'g', item: 'red lentils', note: 'rinsed', no_scale: false, original: '', group: '' },
        { amount: null, unit: 'g', item: 'flour', note: '', no_scale: false, original: '1 cup', group: '' },
        { amount: 0.5, unit: 'piece', item: 'lime', note: '', no_scale: true, original: '', group: '' },
      ],
      steps: [
        { text: 'Cook.', group: '' },
        { text: 'Serve.', group: '' },
      ],
      notes: '',
      source: { url: 'https://example.com/dal', photo: null },
      tags: ['weeknight'],
      image: 'dal.jpg',
    })
  })

  test('drops blank rows and steps, and trims', () => {
    const state = valid()
    state.name = '  Soup '
    state.time = ''
    state.rows.push({ ...rowsOf(state)[0], key: 'blank', amount: '', item: ' ', note: '' })
    state.steps = [
      { key: 'a', text: '  Stir. ' },
      { key: 'b', text: '   ' },
    ]
    const draft = toDraft(state)
    expect(draft.name).toBe('Soup')
    expect(draft.time_minutes).toBeNull()
    expect(draft.ingredients).toHaveLength(1)
    expect(draft.steps).toEqual([{ text: 'Stir.', group: '' }])
  })

  test('a heading names the group of the rows under it, with its spaces collapsed', () => {
    const state = valid()
    const row = (key: string, item: string): EditorRow => ({ ...rowsOf(state)[0], key, item })
    state.rows = [
      row('a', 'salt'),
      heading('  Sauce  x '),
      row('b', 'tomato'),
      row('c', 'basil'),
      heading('   '),
      row('d', 'water'),
    ]
    const draft = toDraft(state)
    expect(draft.ingredients.map((i) => [i.item, i.group])).toEqual([
      ['salt', ''],
      ['tomato', 'Sauce x'],
      ['basil', 'Sauce x'],
      ['water', ''],
    ])
  })

  test('a heading with no rows under it vanishes, and blank rows do not hold one up', () => {
    const state = valid()
    const row = rowsOf(state)[0]
    state.rows = [
      heading('Empty'),
      heading('Blank only'),
      { ...row, key: 'blank', amount: '', item: '' },
      heading('Real'),
      { ...row, key: 'r', item: 'rice' },
      heading('Trailing'),
    ]
    state.steps = [heading('Empty'), { key: 's', text: '  ' }, heading('Later'), { key: 't', text: 'Stir.' }, heading('End')]
    const draft = toDraft(state)
    expect(draft.ingredients.map((i) => [i.item, i.group])).toEqual([['rice', 'Real']])
    expect(draft.steps).toEqual([{ text: 'Stir.', group: 'Later' }])
  })

  test('steps are sent with their group and notes as typed', () => {
    const state = valid()
    state.steps = [
      { key: 'a', text: ' First. ' },
      heading('To serve'),
      { key: 'b', text: 'Plate.' },
    ]
    state.notes = ' Keeps  \n\n- a week '
    const draft = toDraft(state)
    expect(draft.steps).toEqual([
      { text: 'First.', group: '' },
      { text: 'Plate.', group: 'To serve' },
    ])
    expect(draft.notes).toBe(' Keeps  \n\n- a week ')
  })

  test('groups and notes survive a load and save', () => {
    const groups = ['', 'Marinade', 'Marinade', 'Sauce', '']
    const grouped: Recipe = {
      ...recipe,
      ingredients: groups.map((group, i) => ({ ...recipe.ingredients[0], item: `item ${i}`, group })),
      steps: [
        { text: 'Soak.', group: 'Day before' },
        { text: 'Serve.', group: 'To serve' },
      ],
      notes: 'Keeps a week.\n\n- freeze',
    }
    const draft = toDraft(stateFromRecipe(grouped))
    expect(draft.ingredients.map((i) => [i.item, i.group])).toEqual(grouped.ingredients.map((i) => [i.item, i.group]))
    expect(draft.steps).toEqual(grouped.steps)
    expect(draft.notes).toBe(grouped.notes)
    expect(isDirty(stateFromRecipe(grouped), stateFromRecipe(grouped))).toBe(false)
  })

  test('typing an amount clears the original; leaving it blank keeps it', () => {
    const state = stateFromRecipe(recipe)
    expect(toDraft(state).ingredients[1]).toMatchObject({ amount: null, original: '1 cup' })
    state.rows[1] = { ...rowsOf(state)[1], amount: '1½' }
    expect(toDraft(state).ingredients[1]).toMatchObject({ amount: 1.5, original: '' })
  })

  test('tsp and tbsp are sent as they are for the server to convert', () => {
    const state = valid()
    state.rows[0] = { ...rowsOf(state)[0], amount: '2', unit: 'tsp' }
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

  test('headings and notes count, their keys do not', () => {
    const initial = stateFromRecipe({ ...recipe, ingredients: recipe.ingredients.map((i) => ({ ...i, group: 'A' })) })
    expect(isDirty(initial, stateFromRecipe({ ...recipe, ingredients: recipe.ingredients.map((i) => ({ ...i, group: 'A' })) }))).toBe(false)
    const renamed = initial.rows.map((e) => (isHeading(e) ? { ...e, name: 'B' } : e))
    expect(isDirty(initial, { ...initial, rows: renamed })).toBe(true)
    expect(isDirty(initial, { ...initial, steps: [heading('X'), ...initial.steps] })).toBe(true)
    expect(isDirty(initial, { ...initial, notes: 'x' })).toBe(true)
  })

  test('a new form is clean until something is typed', () => {
    const initial = emptyState('food')
    expect(isDirty(initial, emptyState('food'))).toBe(false)
    expect(isDirty(initial, { ...initial, name: 'x' })).toBe(true)
  })
})

describe('grouped', () => {
  test('pairs each entry with the nearest heading above it, collapsed; blank means none', () => {
    const entries = [
      { key: 'a', text: 'a' },
      heading('  Big   pot '),
      { key: 'b', text: 'b' },
      heading(' '),
      { key: 'c', text: 'c' },
    ]
    expect(grouped(entries).map(({ entry, group }) => [entry.text, group])).toEqual([
      ['a', ''],
      ['b', 'Big pot'],
      ['c', ''],
    ])
  })
})
