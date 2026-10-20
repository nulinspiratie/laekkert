import { describe, expect, test } from 'vitest'
import { toggleBullets, wrap } from './noteTools'

describe('wrap', () => {
  test('wraps the selection and keeps it on the same text', () => {
    expect(wrap('a soft b', 2, 6, '*')).toEqual({ text: 'a *soft* b', start: 3, end: 7 })
    expect(wrap('a soft b', 2, 6, '**')).toEqual({ text: 'a **soft** b', start: 4, end: 8 })
  })

  test('with nothing selected inserts the pair and puts the caret between', () => {
    expect(wrap('ab', 1, 1, '**')).toEqual({ text: 'a****b', start: 3, end: 3 })
    expect(wrap('ab', 1, 1, '*')).toEqual({ text: 'a**b', start: 2, end: 2 })
  })
})

describe('toggleBullets', () => {
  test('puts "- " on every selected line and keeps both lines selected', () => {
    expect(toggleBullets('x\ny', 0, 3)).toEqual({ text: '- x\n- y', start: 0, end: 7 })
  })

  test('applied again it takes them off', () => {
    expect(toggleBullets('- x\n- y', 0, 7)).toEqual({ text: 'x\ny', start: 0, end: 3 })
  })

  test('a selection inside one line of three bullets only takes it off that line', () => {
    const text = '- a\n- b\n- c'
    expect(toggleBullets(text, 6, 7)).toEqual({ text: '- a\nb\n- c', start: 4, end: 5 })
  })

  test('mixed lines all get a bullet', () => {
    expect(toggleBullets('- a\nb', 0, 5)).toEqual({ text: '- - a\n- b', start: 0, end: 9 })
  })

  test('knows every bullet the notes parser does, spaces included', () => {
    expect(toggleBullets('  - a', 0, 5)).toEqual({ text: 'a', start: 0, end: 1 })
    expect(toggleBullets('* x\n• y', 0, 7)).toEqual({ text: 'x\ny', start: 0, end: 3 })
  })

  test('a caret inside the marker lands at the start of the text', () => {
    expect(toggleBullets('  - a', 2, 2)).toEqual({ text: 'a', start: 0, end: 0 })
  })

  test('a caret alone bullets its line', () => {
    expect(toggleBullets('one\ntwo', 5, 5)).toEqual({ text: 'one\n- two', start: 7, end: 7 })
  })

  test('only touches lines the selection reaches, not the line after a trailing newline', () => {
    expect(toggleBullets('a\nb\nc', 0, 4)).toEqual({ text: '- a\n- b\nc', start: 0, end: 8 })
  })

  test('blank lines are left alone and ignored when deciding', () => {
    expect(toggleBullets('x\n\ny', 0, 4)).toEqual({ text: '- x\n\n- y', start: 0, end: 8 })
    expect(toggleBullets('- x\n\n- y', 0, 8)).toEqual({ text: 'x\n\ny', start: 0, end: 4 })
    expect(toggleBullets('x\n  \ny', 0, 6)).toEqual({ text: '- x\n  \n- y', start: 0, end: 10 })
  })

  test('a blank first line stays blank when the caret is at the very start', () => {
    expect(toggleBullets('\nx', 0, 0)).toEqual({ text: '\nx', start: 0, end: 0 })
  })
})
