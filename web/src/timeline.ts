// Pure helpers for the History timeline: the wording of each entry and its date.

import type { Change, Mark, TimelineEntry } from './types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "12 Oct", or "12 Oct 2025" when it isn't the current year; in the browser's time zone. */
export function formatDate(at: string, now: Date = new Date()): string {
  const date = new Date(at)
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`
  return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`
}

// The order the editor lists its sections in.
const SECTIONS: readonly Change['section'][] = ['details', 'ingredients', 'method', 'notes', 'source', 'tags', 'photo']

const MARK_WORDS: Record<Mark, string> = { favourite: 'Favourite', try_next: 'Try next', tried: 'Tried' }

/** "a", "a and b", "a, b and c". */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

function title(entry: TimelineEntry, all: TimelineEntry[], now: Date): string {
  switch (entry.kind) {
    case 'created':
      return 'Created this recipe'
    case 'baseline':
      return 'Before the first edit in the app'
    case 'edit': {
      if (entry.restored_from !== null) {
        const source = all.find(
          (other) =>
            (other.kind === 'created' || other.kind === 'baseline' || other.kind === 'edit') &&
            other.version === entry.restored_from,
        )
        return source
          ? `Restored the version from ${formatDate(source.at, now)}`
          : `Restored version ${entry.restored_from}`
      }
      const sections = SECTIONS.filter((section) => entry.changes.some((change) => change.section === section))
      return sections.length === 0 ? 'Edited this recipe' : `Edited ${joinWords(sections)}`
    }
    case 'note':
      return 'Added a note'
    case 'rating':
      return entry.previous === null
        ? `Rated it ${entry.rating.toFixed(1)}`
        : `Changed the rating ${entry.previous.toFixed(1)} → ${entry.rating.toFixed(1)}`
    case 'made':
      return 'Made it'
    case 'marks': {
      const added = joinWords(entry.added.map((mark) => MARK_WORDS[mark]))
      const removed = joinWords(entry.removed.map((mark) => MARK_WORDS[mark]))
      if (added && removed) return `Marked it ${added} and took off ${removed}`
      return added ? `Marked it ${added}` : `Took off ${removed}`
    }
  }
}

/** What the entry says it did, e.g. "Edited ingredients and method". `all` finds a restore's source. */
export function entryTitle(entry: TimelineEntry, all: TimelineEntry[], now: Date = new Date()): string {
  const text = title(entry, all, now)
  return entry.via === 'claude' ? `${text} · via Claude` : text
}

/** The version "Restore this version" would bring back, or null when there is nothing to restore. */
export function restorableVersion(entry: TimelineEntry, currentVersion: number | null): number | null {
  if (entry.kind !== 'created' && entry.kind !== 'baseline' && entry.kind !== 'edit') return null
  return currentVersion === null || entry.version === currentVersion ? null : entry.version
}
