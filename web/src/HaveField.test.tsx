import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { HaveField } from './HaveField'
import { haveBadge } from './haveBadge'

function setup(terms: string[] = []) {
  const onAdd = vi.fn()
  const onRemove = vi.fn()
  const onClear = vi.fn()
  render(<HaveField terms={terms} onAdd={onAdd} onRemove={onRemove} onClear={onClear} />)
  return { onAdd, onRemove, onClear, input: screen.getByPlaceholderText('Add an ingredient') as HTMLInputElement }
}

test('Enter adds the typed text as a term and clears the field', () => {
  const { onAdd, input } = setup()
  fireEvent.change(input, { target: { value: 'chicken' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onAdd).toHaveBeenCalledExactlyOnceWith('chicken')
  expect(input.value).toBe('')
})

test('a comma adds the text before it and clears the field', () => {
  const { onAdd, input } = setup()
  fireEvent.change(input, { target: { value: 'leeks,' } })
  expect(onAdd).toHaveBeenCalledExactlyOnceWith('leeks')
  expect(input.value).toBe('')
})

test('pasting a comma-separated list adds each term and keeps the tail', () => {
  const { onAdd, input } = setup()
  fireEvent.change(input, { target: { value: 'leeks, eggs,  , milk' } })
  expect(onAdd.mock.calls).toEqual([['leeks'], ['eggs']])
  expect(input.value).toBe('milk')
})

test('Enter on a blank field adds nothing', () => {
  const { onAdd, input } = setup()
  fireEvent.change(input, { target: { value: '   ' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onAdd).not.toHaveBeenCalled()
})

test('Backspace in an empty field removes the last term; in a typed field it does not', () => {
  const { onRemove, input } = setup(['chicken', 'leeks'])
  fireEvent.keyDown(input, { key: 'Backspace' })
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('leeks')
  onRemove.mockClear()
  fireEvent.change(input, { target: { value: 'e' } })
  fireEvent.keyDown(input, { key: 'Backspace' })
  expect(onRemove).not.toHaveBeenCalled()
})

test('Backspace with no terms does nothing', () => {
  const { onRemove, input } = setup()
  fireEvent.keyDown(input, { key: 'Backspace' })
  expect(onRemove).not.toHaveBeenCalled()
})

test('each term is a chip with its own remove button', () => {
  const { onRemove } = setup(['chicken', 'leeks'])
  expect(screen.getByText('chicken')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Remove chicken' }))
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('chicken')
  expect(screen.getByRole('button', { name: 'Remove leeks' })).toBeInTheDocument()
})

test('chips are not buttons nested in buttons', () => {
  setup(['chicken'])
  for (const button of screen.getAllByRole('button')) expect(button.querySelector('button')).toBeNull()
})

test('Clear shows only with terms and calls onClear', () => {
  const none = setup()
  expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  expect(none.onClear).not.toHaveBeenCalled()
})

test('Clear with terms calls onClear', () => {
  const { onClear } = setup(['chicken'])
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(onClear).toHaveBeenCalledOnce()
})

test('the hint shows only without terms', () => {
  const hint = "See what you can cook with what's in the fridge."
  const view = render(<HaveField terms={[]} onAdd={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />)
  expect(screen.getByText(hint)).toBeInTheDocument()
  view.rerender(<HaveField terms={['chicken']} onAdd={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />)
  expect(screen.queryByText(hint)).not.toBeInTheDocument()
})

test('the field is limited to 60 characters', () => {
  const { input } = setup()
  expect(input).toHaveAttribute('maxlength', '60')
})

test('haveBadge: nothing missing', () => {
  expect(haveBadge({ matched: ['eggs'], missing: [] })).toEqual({
    text: 'Have everything',
    label: 'Have everything',
    complete: true,
  })
})

test('haveBadge: one or two missing are all named', () => {
  expect(haveBadge({ matched: [], missing: ['a'] })).toEqual({ text: 'Missing: a', label: 'Missing: a', complete: false })
  expect(haveBadge({ matched: [], missing: ['a', 'b'] })).toEqual({
    text: 'Missing: a, b',
    label: 'Missing: a, b',
    complete: false,
  })
})

test('haveBadge: more than two show the first two and a count, the label has all', () => {
  expect(haveBadge({ matched: [], missing: ['a', 'b', 'c', 'd'] })).toEqual({
    text: 'Missing: a, b +2',
    label: 'Missing: a, b, c, d',
    complete: false,
  })
  expect(haveBadge({ matched: [], missing: ['a', 'b', 'c'] }).text).toBe('Missing: a, b +1')
})
