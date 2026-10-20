import { BULLET as BULLET_LINE } from './notes'

// Pure edits for the notes box. `start` and `end` are the textarea's selection; each helper
// returns the new text and the selection that keeps the same text selected.

export interface Edit {
  text: string
  start: number
  end: number
}

/** Wraps the selection in `marker`; with nothing selected, inserts the pair around the caret. */
export function wrap(text: string, start: number, end: number, marker: '**' | '*'): Edit {
  const n = marker.length
  return {
    text: text.slice(0, start) + marker + text.slice(start, end) + marker + text.slice(end),
    start: start + n,
    end: end + n,
  }
}

const MARKER = '- '

/**
 * Puts "- " at the start of every selected line, or takes the bullet off when they all have
 * one. A bullet is whatever the notes parser reads as one: "-", "*" or "•", after any spaces.
 * Blank lines are left alone and do not count either way.
 */
export function toggleBullets(text: string, start: number, end: number): Edit {
  // The lines the selection touches; one that it only reaches the very start of is not.
  const reach = end > start && text[end - 1] === '\n' ? end - 1 : end
  const lines: { at: number; text: string; cut: number }[] = []
  // lastIndexOf with -1 would clamp to 0 and find a newline at the very start.
  let at = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1
  for (;;) {
    const stop = text.indexOf('\n', at)
    const lineEnd = stop === -1 ? text.length : stop
    const line = text.slice(at, lineEnd)
    // What taking the bullet off removes: the spaces and the marker, up to the text.
    const bullet = BULLET_LINE.exec(line)
    lines.push({ at, text: line, cut: bullet ? line.length - bullet[1].length : 0 })
    if (lineEnd >= reach || stop === -1) break
    at = lineEnd + 1
  }

  const filled = lines.filter((line) => line.text.trim() !== '')
  if (filled.length === 0) return { text, start, end }
  const remove = filled.every((line) => line.cut > 0)

  // Where a position in the old text lands once the lines are changed.
  const shift = (position: number, isStart: boolean): number => {
    let moved = position
    for (const line of filled) {
      if (remove) {
        moved -= Math.min(line.cut, Math.max(0, position - line.at))
      } else if (line.at < position || (line.at === position && !(isStart && start < end))) {
        moved += MARKER.length
      }
    }
    return moved
  }

  const changed = new Set(filled)
  let result = text.slice(0, lines[0].at)
  lines.forEach((line, index) => {
    const body = !changed.has(line) ? line.text : remove ? line.text.slice(line.cut) : MARKER + line.text
    result += body + (index < lines.length - 1 ? '\n' : '')
  })
  result += text.slice(lines[lines.length - 1].at + lines[lines.length - 1].text.length)
  return { text: result, start: shift(start, true), end: shift(end, false) }
}
