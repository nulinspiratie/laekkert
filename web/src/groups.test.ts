import { describe, expect, test } from 'vitest'
import { runs } from './groups'

const rows = (...groups: string[]) => groups.map((group) => ({ group }))

describe('runs', () => {
  test('no items, no runs', () => {
    expect(runs([])).toEqual([])
  })

  test('items without a group are one run', () => {
    const items = rows('', '', '')
    expect(runs(items)).toEqual([{ group: '', start: 0, items }])
  })

  test('a run starts at its first item', () => {
    const result = runs(rows('', 'A', 'A', 'B'))
    expect(result.map((run) => run.start)).toEqual([0, 1, 3])
    expect(result.map((run) => run.group)).toEqual(['', 'A', 'B'])
    expect(result.map((run) => run.items.length)).toEqual([1, 2, 1])
  })

  test('a group that comes back is a new run', () => {
    const result = runs(rows('A', 'B', 'A'))
    expect(result.map((run) => [run.group, run.start])).toEqual([
      ['A', 0],
      ['B', 1],
      ['A', 2],
    ])
  })

  test('the items are the originals, in order', () => {
    const items = [{ group: 'A', n: 1 }, { group: 'A', n: 2 }]
    expect(runs(items)[0].items[1]).toBe(items[1])
  })
})
