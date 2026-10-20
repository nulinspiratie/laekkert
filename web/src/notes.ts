// Pure functions behind a recipe's notes: text in, blocks of styled spans out. The rules
// are in docs/superpowers/specs/2026-10-20-groups-and-notes-design.md ("Notes formatting").

export interface Span {
  text: string
  bold: boolean
  italic: boolean
}

export type Block = { kind: 'paragraph'; lines: Span[][] } | { kind: 'list'; items: Span[][] }

// Bold first (longest marker first), then italics; content may not start or end with a
// space or a star, so "2 * 3 * 4" and a lone "*" stay as written.
const INLINE = /(\*\*\*|\*\*|\*)(?![\s*])(.+?)(?<![\s*])\1/g

// A marker followed by whitespace; "**bold**" and "*soft*" are text.
const BULLET = /^\s*[-*•]\s+(.*)$/

function plain(text: string): Span {
  return { text, bold: false, italic: false }
}

/** One line split into plain, bold and italic spans; an unmatched marker stays as written. */
export function parseInline(line: string): Span[] {
  const spans: Span[] = []
  let last = 0
  for (const match of line.matchAll(INLINE)) {
    if (match.index > last) spans.push(plain(line.slice(last, match.index)))
    const marker = match[1]
    spans.push({ text: match[2], bold: marker.length >= 2, italic: marker.length !== 2 })
    last = match.index + match[0].length
  }
  if (last < line.length) spans.push(plain(line.slice(last)))
  return spans
}

/** Notes text as paragraphs and bullet lists. Blank text has no blocks. */
export function parseNotes(text: string): Block[] {
  const blocks: Block[] = []
  // The block lines are being added to; a blank line closes it.
  let open: Block | null = null
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') {
      open = null
      continue
    }
    const bullet = BULLET.exec(line)
    if (bullet) {
      if (open?.kind !== 'list') {
        open = { kind: 'list', items: [] }
        blocks.push(open)
      }
      open.items.push(parseInline(bullet[1]))
    } else {
      if (open?.kind !== 'paragraph') {
        open = { kind: 'paragraph', lines: [] }
        blocks.push(open)
      }
      open.lines.push(parseInline(line))
    }
  }
  return blocks
}
