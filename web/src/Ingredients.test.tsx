import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, test } from 'vitest'
import { Ingredients } from './Ingredients'
import type { RecipeIngredient } from './types'

function ing(over: Partial<RecipeIngredient> & Pick<RecipeIngredient, 'item'>): RecipeIngredient {
  return {
    amount: 1,
    unit: 'g',
    note: '',
    no_scale: false,
    original: '',
    g_per_tsp: null,
    ...over,
  }
}

const chicken = ing({ item: 'chicken thighs', amount: 800 })
const leeks = ing({ item: 'leeks', amount: 2, unit: 'piece' })
const oil = ing({ item: 'olive oil', amount: 30, unit: 'ml' })
const paprika = ing({ item: 'smoked paprika', amount: null, original: '1 tsp', g_per_tsp: 2.3 })
const lemon = ing({ item: 'lemon', amount: 1, unit: 'piece', no_scale: true })
const salt = ing({ item: 'salt', amount: null, unit: 'to taste', no_scale: true })
const ginger = ing({ item: 'ginger', amount: 5, note: 'grated' })
const all = [chicken, leeks, oil, paprika, lemon, salt]

function renderIngredients(ingredients: RecipeIngredient[] = all, servings = 4) {
  return render(<Ingredients ingredients={ingredients} servings={servings} />)
}

const row = (item: string) => screen.getByText(item).closest('li')!
const fewer = () => screen.getByRole('button', { name: 'Fewer servings' })
const more = () => screen.getByRole('button', { name: 'More servings' })

test('starts at the recipe servings, in the singular and plural', () => {
  renderIngredients(all, 4)
  expect(screen.getByText('4 servings')).toHaveAttribute('aria-live', 'polite')
  fireEvent.click(fewer())
  fireEvent.click(fewer())
  fireEvent.click(fewer())
  expect(screen.getByText('1 serving')).toBeInTheDocument()
})

test('halving the servings halves the amounts but not the fixed rows', () => {
  renderIngredients()
  expect(within(row('chicken thighs')).getByText('800 g')).toBeInTheDocument()
  fireEvent.click(fewer())
  fireEvent.click(fewer())
  expect(screen.getByText('2 servings')).toBeInTheDocument()
  expect(within(row('chicken thighs')).getByText('400 g')).toBeInTheDocument()
  expect(within(row('leeks')).getByText('1')).toBeInTheDocument()
  expect(within(row('lemon')).getByText('1')).toBeInTheDocument()
})

test('the stepper stops at 1 and at 24', () => {
  renderIngredients(all, 2)
  fireEvent.click(fewer())
  expect(screen.getByText('1 serving')).toBeInTheDocument()
  expect(fewer()).toBeDisabled()
  fireEvent.click(fewer())
  expect(screen.getByText('1 serving')).toBeInTheDocument()

  for (let i = 0; i < 30; i++) fireEvent.click(more())
  expect(screen.getByText('24 servings')).toBeInTheDocument()
  expect(more()).toBeDisabled()
  expect(fewer()).toBeEnabled()
})

test('the unit toggle switches spoons to metric and is remembered', () => {
  const { unmount } = renderIngredients()
  const spoons = screen.getByRole('button', { name: 'tsp' })
  const metric = screen.getByRole('button', { name: 'g/ml' })
  expect(screen.getByRole('group', { name: 'Units' })).toBeInTheDocument()
  expect(spoons).toHaveAttribute('aria-pressed', 'true')
  expect(metric).toHaveAttribute('aria-pressed', 'false')
  expect(within(row('olive oil')).getByText('2 tbsp')).toBeInTheDocument()

  fireEvent.click(metric)
  expect(metric).toHaveAttribute('aria-pressed', 'true')
  expect(spoons).toHaveAttribute('aria-pressed', 'false')
  expect(within(row('olive oil')).getByText('30 ml')).toBeInTheDocument()
  expect(localStorage.getItem('laekkert.units')).toBe('metric')

  unmount()
  renderIngredients()
  expect(screen.getByRole('button', { name: 'g/ml' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(row('olive oil')).getByText('30 ml')).toBeInTheDocument()
})

test('an unconverted amount shows its original text with a marker', () => {
  renderIngredients()
  const li = row('smoked paprika')
  expect(within(li).getByText('1 tsp')).toBeInTheDocument()
  const marker = within(li).getByRole('img', { name: 'Not converted to metric yet' })
  expect(marker).toHaveAttribute('title', 'Not converted to metric yet')
})

test('a small gram amount without a spoon conversion is marked in spoon mode only', () => {
  renderIngredients([ginger])
  const li = row('ginger')
  expect(within(li).getByText('5 g')).toBeInTheDocument()
  expect(within(li).getByRole('img', { name: 'No tsp conversion yet' })).toHaveAttribute(
    'title',
    'No tsp conversion yet',
  )
  fireEvent.click(screen.getByRole('button', { name: 'g/ml' }))
  expect(within(li).queryByRole('img')).not.toBeInTheDocument()
})

test('notes follow the item and to-taste rows say so', () => {
  renderIngredients([ginger, salt])
  expect(row('ginger')).toHaveTextContent('ginger, grated')
  expect(row('salt')).toHaveTextContent('salt, to taste')
  expect(row('salt')).not.toHaveTextContent('to taste, to taste')
})

test('only no-scale rows get the fixed pill', () => {
  renderIngredients()
  expect(within(row('lemon')).getByText('fixed')).toBeInTheDocument()
  expect(within(row('salt')).getByText('fixed')).toBeInTheDocument()
  expect(within(row('chicken thighs')).queryByText('fixed')).not.toBeInTheDocument()
})

test('pinch and dash print their unit once', () => {
  renderIngredients([ing({ item: 'chilli flakes', amount: 1, unit: 'pinch' })])
  expect(within(row('chilli flakes')).getByText('1 pinch')).toBeInTheDocument()
})

test('food page has no bar', () => {
  // A food recipe never has bar fields; even if one did, the food side shows none of it.
  const withBar = ing({ item: 'olive oil', amount: 30, unit: 'ml', bar: { item: 'olive oil', state: 'have', fresh: false, recipe: null } })
  render(<Ingredients ingredients={[withBar, chicken]} servings={4} side="food" />)
  expect(screen.getByRole('group', { name: 'Servings' })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Drinks to make' })).not.toBeInTheDocument()
  expect(screen.queryByText(/in the bar/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/From your bar|Missing:|Buy fresh:/)).not.toBeInTheDocument()
  expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
    'Fewer servings',
    'More servings',
    'tsp',
    'g/ml',
  ])
  expect(row('olive oil').className).toBe('ingredient')
})

test('a drink written for more than 12 starts at 12', () => {
  render(
    <MemoryRouter>
      <Ingredients ingredients={[oil]} servings={16} side="drinks" />
    </MemoryRouter>,
  )
  expect(screen.getByText('12 drinks')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'More' })).toBeDisabled()
})
