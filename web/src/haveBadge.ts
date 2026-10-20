// The words on a "what you have" badge (RecipeCard).

import type { HaveMatch } from './types'

/** How many missing ingredients a badge names before it says "+N". */
const BADGE_NAMES = 2

/**
 * The "what you have" badge: `text` is the one-line version, `label` names everything
 * missing (the badge's title and accessible name), `complete` is true when nothing is.
 */
export function haveBadge(have: HaveMatch): { text: string; label: string; complete: boolean } {
  if (have.missing.length === 0) return { text: 'Have everything', label: 'Have everything', complete: true }
  const named = have.missing.slice(0, BADGE_NAMES).join(', ')
  const more = have.missing.length - BADGE_NAMES
  return {
    text: `Missing: ${named}${more > 0 ? ` +${more}` : ''}`,
    label: `Missing: ${have.missing.join(', ')}`,
    complete: false,
  }
}
