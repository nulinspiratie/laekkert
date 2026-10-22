// The recipe page's tag picker: which tags it offers and the change it saves.

import { normalise } from './bar'

/**
 * Every tag in `used` and the recipe's own, one per name key, A to Z. The recipe's spelling
 * wins. A tag that only repeats the category ("main" on a main) is left out, as the server
 * drops it.
 */
export function pickerTags(own: string[], used: string[], category: string): string[] {
  const skip = new Set([normalise(category), normalise(category.replace(/s$/, ''))])
  const byKey = new Map<string, string>()
  for (const tag of [...own, ...used]) {
    const key = normalise(tag)
    if (key !== '' && !skip.has(key) && !byKey.has(key)) byKey.set(key, tag)
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b))
}

/** What saving `picked` changes on a recipe with `own`; taking off sends the recipe's spelling. */
export function tagChanges(own: string[], picked: string[]): { add: string[]; remove: string[] } {
  const ownKeys = new Set(own.map(normalise))
  const pickedKeys = new Set(picked.map(normalise))
  return {
    add: picked.filter((tag) => !ownKeys.has(normalise(tag))),
    remove: own.filter((tag) => !pickedKeys.has(normalise(tag))),
  }
}
