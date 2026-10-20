// Pure helper for grouped lists (ingredients, steps): consecutive rows with the same group.

export interface Run<T> {
  group: string
  /** The index in the original list of the run's first item. */
  start: number
  items: T[]
}

/**
 * Splits `items` into runs of consecutive items with the same `group`. Nothing is
 * re-sorted: `A, B, A` is three runs, and a group that returns gets its own run.
 */
export function runs<T extends { group: string }>(items: T[]): Run<T>[] {
  const result: Run<T>[] = []
  items.forEach((item, index) => {
    const last = result[result.length - 1]
    if (last && last.group === item.group) last.items.push(item)
    else result.push({ group: item.group, start: index, items: [item] })
  })
  return result
}
