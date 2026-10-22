import { describe, expect, test } from 'vitest'
import { pickerTags, tagChanges } from './tagPicker'

describe('pickerTags', () => {
  test('every tag once, A to Z, with the recipe spelling first', () => {
    expect(pickerTags(['Kid approved'], ['quick', 'kid approved', 'dinner', 'quick'], 'mains')).toEqual([
      'dinner',
      'Kid approved',
      'quick',
    ])
  })

  test('leaves out blanks and the category, plural or not', () => {
    expect(pickerTags([], ['main', 'Mains', ' ', 'quick'], 'mains')).toEqual(['quick'])
  })
})

describe('tagChanges', () => {
  test('nothing picked differently is no change', () => {
    expect(tagChanges(['dinner'], ['dinner'])).toEqual({ add: [], remove: [] })
  })

  test('adds the new ones and takes off with the recipe spelling', () => {
    expect(tagChanges(['Dinner', 'quick'], ['quick', 'kid approved'])).toEqual({
      add: ['kid approved'],
      remove: ['Dinner'],
    })
  })

  test('a tag picked in another spelling is the same tag', () => {
    expect(tagChanges(['Kid approved'], ['kid approved'])).toEqual({ add: [], remove: [] })
  })
})
