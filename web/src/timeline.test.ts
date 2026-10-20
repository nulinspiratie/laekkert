import { describe, expect, test } from 'vitest'
import { entryTitle, formatDate, restorableVersion } from './timeline'
import type { TimelineEntry } from './types'

const base = { id: 'a1b2c3d4e5f6', at: '2026-10-12T12:00:00Z', via: 'app' as const }

const created: TimelineEntry = { ...base, kind: 'created', version: 1, at: '2026-09-03T12:00:00Z' }
const baseline: TimelineEntry = { ...base, kind: 'baseline', version: 1 }
const edit: TimelineEntry = {
  ...base,
  kind: 'edit',
  version: 2,
  at: '2026-09-28T12:00:00Z',
  changes: [
    { section: 'method', kind: 'changed', text: 'step 2' },
    { section: 'ingredients', kind: 'added', text: '1 lime, juiced' },
    { section: 'ingredients', kind: 'removed', text: 'chili flakes' },
  ],
  restored_from: null,
}
const all: TimelineEntry[] = [edit, created]

describe('entryTitle', () => {
  test('created and baseline', () => {
    expect(entryTitle(created, all)).toBe('Created this recipe')
    expect(entryTitle(baseline, [baseline])).toBe('Before the first edit in the app')
  })

  test('an edit joins its changed sections in the page order', () => {
    expect(entryTitle(edit, all)).toBe('Edited ingredients and method')
  })

  test('an edit of one, three or six sections', () => {
    const only = (...sections: Array<'details' | 'ingredients' | 'method' | 'source' | 'tags' | 'photo'>) =>
      entryTitle(
        { ...edit, changes: sections.map((section) => ({ section, kind: 'changed' as const, text: 'x' })) },
        all,
      )
    expect(only('tags')).toBe('Edited tags')
    expect(only('photo', 'method', 'details')).toBe('Edited details, method and photo')
    expect(only('tags', 'source', 'photo', 'method', 'ingredients', 'details')).toBe(
      'Edited details, ingredients, method, source, tags and photo',
    )
  })

  test('an edit with no listed changes still reads as an edit', () => {
    expect(entryTitle({ ...edit, changes: [] }, all)).toBe('Edited this recipe')
  })

  test('a restore names the date of the version it brought back', () => {
    const restored: TimelineEntry = { ...edit, version: 3, changes: [], restored_from: 1, at: '2026-10-05T12:00:00Z' }
    expect(entryTitle(restored, [restored, edit, created], new Date('2026-10-20T09:00:00Z'))).toBe(
      'Restored the version from 3 Sep',
    )
  })

  test('a restore of a version that is not in the list falls back to its number', () => {
    const restored: TimelineEntry = { ...edit, version: 3, changes: [], restored_from: 7 }
    expect(entryTitle(restored, [restored, edit, created])).toBe('Restored version 7')
  })

  test('note, made it', () => {
    expect(entryTitle({ ...base, kind: 'note', text: 'Lovely' }, all)).toBe('Added a note')
    expect(entryTitle({ ...base, kind: 'made', rating: null, note: '' }, all)).toBe('Made it')
  })

  test('a first rating and a changed rating show one decimal', () => {
    expect(entryTitle({ ...base, kind: 'rating', rating: 4.5, previous: null }, all)).toBe('Rated it 4.5')
    expect(entryTitle({ ...base, kind: 'rating', rating: 4.5, previous: 4 }, all)).toBe(
      'Changed the rating 4.0 → 4.5',
    )
    expect(entryTitle({ ...base, kind: 'rating', rating: 5, previous: null }, all)).toBe('Rated it 5.0')
  })

  test('marks added, removed, or both', () => {
    const marks = (added: Array<'tried' | 'favourite' | 'try_next'>, removed: Array<'tried' | 'favourite' | 'try_next'>) =>
      entryTitle({ ...base, kind: 'marks', added, removed }, all)
    expect(marks(['favourite'], [])).toBe('Marked it Favourite')
    expect(marks([], ['try_next'])).toBe('Took off Try next')
    expect(marks(['favourite', 'tried'], [])).toBe('Marked it Favourite and Tried')
    expect(marks(['favourite'], ['try_next'])).toBe('Marked it Favourite and took off Try next')
  })

  test('an entry made by Claude says so', () => {
    expect(entryTitle({ ...base, via: 'claude', kind: 'note', text: 'x' }, all)).toBe(
      'Added a note · via Claude',
    )
  })
})

describe('formatDate', () => {
  const now = new Date('2026-10-20T09:00:00Z')

  test('this year has no year', () => {
    expect(formatDate('2026-10-12T12:00:00Z', now)).toBe('12 Oct')
    expect(formatDate('2026-09-03T12:00:00Z', now)).toBe('3 Sep')
  })

  test('another year shows the year', () => {
    expect(formatDate('2025-10-12T12:00:00Z', now)).toBe('12 Oct 2025')
  })

  test('defaults to now', () => {
    const year = new Date().getFullYear()
    expect(formatDate(`${year}-06-15T12:00:00Z`)).toBe('15 Jun')
  })
})

describe('restorableVersion', () => {
  test('created, baseline and edit entries can be restored', () => {
    expect(restorableVersion(created, 2)).toBe(1)
    expect(restorableVersion(baseline, 2)).toBe(1)
    expect(restorableVersion(edit, 3)).toBe(2)
  })

  test('not the current version', () => {
    expect(restorableVersion(edit, 2)).toBeNull()
  })

  test('not notes, ratings, made it or marks', () => {
    expect(restorableVersion({ ...base, kind: 'note', text: 'x' }, 2)).toBeNull()
    expect(restorableVersion({ ...base, kind: 'rating', rating: 4, previous: null }, 2)).toBeNull()
    expect(restorableVersion({ ...base, kind: 'made', rating: null, note: '' }, 2)).toBeNull()
    expect(restorableVersion({ ...base, kind: 'marks', added: ['favourite'], removed: [] }, 2)).toBeNull()
  })

  test('without a current version nothing is restorable', () => {
    expect(restorableVersion(created, null)).toBeNull()
  })
})
