import { describe, expect, test } from 'vitest'
import { parseInline, parseNotes } from './notes'

const plain = (text: string) => ({ text, bold: false, italic: false })

describe('parseInline', () => {
  test('bold', () => {
    expect(parseInline('**Keep** it')).toEqual([{ text: 'Keep', bold: true, italic: false }, plain(' it')])
  })

  test('italic', () => {
    expect(parseInline('*soft*')).toEqual([{ text: 'soft', bold: false, italic: true }])
  })

  test('three stars are bold and italic', () => {
    expect(parseInline('***both***')).toEqual([{ text: 'both', bold: true, italic: true }])
  })

  test('italics inside bold', () => {
    expect(parseInline('**Tip: use *fresh* basil**')).toEqual([
      { text: 'Tip: use ', bold: true, italic: false },
      { text: 'fresh', bold: true, italic: true },
      { text: ' basil', bold: true, italic: false },
    ])
  })

  test.each(['2 * 3 * 4', '5*', '** a**', '**open', '*', ''])('%j stays as written', (line) => {
    expect(parseInline(line)).toEqual(line === '' ? [] : [plain(line)])
  })

  test('several runs in one line', () => {
    expect(parseInline('a **b** c *d*')).toEqual([
      plain('a '),
      { text: 'b', bold: true, italic: false },
      plain(' c '),
      { text: 'd', bold: false, italic: true },
    ])
  })

  test('markup is left as text', () => {
    expect(parseInline('<b>hi</b>')).toEqual([plain('<b>hi</b>')])
  })
})

describe('parseNotes', () => {
  test('blank text has no blocks', () => {
    expect(parseNotes('')).toEqual([])
    expect(parseNotes('  \n \n')).toEqual([])
  })

  test('lines join into a paragraph and a blank line ends it', () => {
    expect(parseNotes('a\nb\n\nc')).toEqual([
      { kind: 'paragraph', lines: [[plain('a')], [plain('b')]] },
      { kind: 'paragraph', lines: [[plain('c')]] },
    ])
  })

  test('bullets with any marker form one list and lose the marker', () => {
    expect(parseNotes('- x\n* y\n• z')).toEqual([
      { kind: 'list', items: [[plain('x')], [plain('y')], [plain('z')]] },
    ])
  })

  test('an indented bullet is still a bullet', () => {
    expect(parseNotes('  - x')).toEqual([{ kind: 'list', items: [[plain('x')]] }])
  })

  test('a blank line between bullets makes two lists', () => {
    expect(parseNotes('- x\n\n- y')).toEqual([
      { kind: 'list', items: [[plain('x')]] },
      { kind: 'list', items: [[plain('y')]] },
    ])
  })

  test('text, a list and text again', () => {
    expect(parseNotes('intro\n- x\nafter')).toEqual([
      { kind: 'paragraph', lines: [[plain('intro')]] },
      { kind: 'list', items: [[plain('x')]] },
      { kind: 'paragraph', lines: [[plain('after')]] },
    ])
  })

  test('a line that starts with bold or italics is text, not a bullet', () => {
    expect(parseNotes('**Note** this\n*soft* too')).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [{ text: 'Note', bold: true, italic: false }, plain(' this')],
          [{ text: 'soft', bold: false, italic: true }, plain(' too')],
        ],
      },
    ])
  })

  test('inline markup works inside a bullet', () => {
    expect(parseNotes('- **hot**')).toEqual([{ kind: 'list', items: [[{ text: 'hot', bold: true, italic: false }]] }])
  })

  test('windows line endings are handled', () => {
    expect(parseNotes('a\r\n- b')).toEqual([
      { kind: 'paragraph', lines: [[plain('a')]] },
      { kind: 'list', items: [[plain('b')]] },
    ])
  })
})
