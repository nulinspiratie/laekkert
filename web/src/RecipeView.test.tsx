import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, type To } from 'react-router'
import { describe, expect, test, vi } from 'vitest'
import App from './App'
import type { Recipe, RecipeSummary } from './types'

const traybake: Recipe = {
  format_version: 1,
  slug: 'chicken-leek-traybake',
  side: 'food',
  name: 'Chicken and leek traybake',
  category: 'mains',
  servings: 4,
  time_minutes: 45,
  ingredients: [
    { amount: 800, unit: 'g', item: 'chicken thighs', note: '', no_scale: false, original: '', g_per_tsp: null },
    { amount: 30, unit: 'ml', item: 'olive oil', note: '', no_scale: false, original: '', g_per_tsp: null },
    { amount: null, unit: 'g', item: 'smoked paprika', note: '', no_scale: false, original: '1 tsp', g_per_tsp: 2.3 },
    { amount: 1, unit: 'piece', item: 'lemon', note: '', no_scale: true, original: '', g_per_tsp: null },
    { amount: null, unit: 'to taste', item: 'salt', note: '', no_scale: true, original: '', g_per_tsp: null },
  ],
  steps: ['Heat the oven.', 'Roast everything.'],
  source: null,
  tags: ['batch cook', 'kid approved'],
  marks: ['tried'],
  image: null,
  rating: null,
  last_made: null,
}

const daiquiri: Recipe = {
  ...traybake,
  slug: 'daiquiri',
  side: 'drinks',
  name: 'Daiquiri',
  category: 'cocktails',
  time_minutes: 5,
  tags: [],
  marks: [],
}

function summary(recipe: Recipe): RecipeSummary {
  const { format_version: _f, servings: _s, ingredients: _i, steps: _st, source: _so, ...rest } = recipe
  return rest
}

/** Answers the listing and recipe routes; any other recipe is a 404. */
function stubApi(...recipes: Recipe[]) {
  const fetch = vi.fn(async (url: string) => {
    if (url.startsWith('/api/recipes?')) {
      return new Response(JSON.stringify({ recipes: recipes.map(summary) }), { status: 200 })
    }
    const slug = decodeURIComponent(url.split('/').pop()!)
    const found = recipes.find((r) => r.slug === slug && url.includes(`/${r.side}/`))
    if (!found) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    return new Response(JSON.stringify(found), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function stubViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: desktop && query === '(min-width: 768px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
}

function renderAt(entry: To | { pathname: string; state: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <App />
    </MemoryRouter>,
  )
}

const TRAYBAKE_PATH = '/food/chicken-leek-traybake'

async function loaded() {
  return screen.findByRole('heading', { level: 1, name: 'Chicken and leek traybake' })
}

test('shows the title, category, time, servings and the method', async () => {
  const fetch = stubApi(traybake)
  renderAt(TRAYBAKE_PATH)
  await loaded()
  expect(fetch).toHaveBeenCalledWith('/api/recipes/food/chicken-leek-traybake')
  expect(screen.getByText('Mains')).toBeInTheDocument()
  expect(screen.getByText('45 min')).toBeInTheDocument()
  expect(screen.getByText('Serves 4')).toBeInTheDocument()
  const method = screen.getByRole('region', { name: 'Method' })
  const steps = within(method).getAllByRole('listitem')
  expect(steps.map((li) => li.textContent)).toEqual(['1Heat the oven.', '2Roast everything.'])
  expect(screen.getByRole('region', { name: 'Ingredients' })).toBeInTheDocument()
})

test('shows nothing, not "Not found", while the recipe loads', async () => {
  stubApi(traybake)
  renderAt(TRAYBAKE_PATH)
  expect(screen.queryByText('Not found')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  await loaded()
})

test('the ingredients scale with the servings', async () => {
  stubApi(traybake)
  renderAt(TRAYBAKE_PATH)
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Fewer servings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Fewer servings' }))
  const li = screen.getByText('chicken thighs').closest('li')!
  expect(within(li).getByText('400 g')).toBeInTheDocument()
})

test('tags link to the browse page filtered by that tag', async () => {
  stubApi(traybake)
  renderAt(TRAYBAKE_PATH)
  await loaded()
  expect(screen.getByRole('link', { name: 'batch cook' })).toHaveAttribute('href', '/food?tag=batch+cook')
})

test('marks show as read-only pills in a fixed order', async () => {
  stubApi({ ...traybake, marks: ['tried', 'try_next', 'favourite'] })
  renderAt(TRAYBAKE_PATH)
  await loaded()
  const marks = screen.getByRole('list', { name: 'Marks' })
  expect(within(marks).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    'Favourite',
    'Try next',
    'Tried',
  ])
  expect(within(marks).queryByRole('button')).not.toBeInTheDocument()
})

test('a kid approved tag is a plain tag link, not a mark', async () => {
  stubApi(traybake)
  renderAt(TRAYBAKE_PATH)
  await loaded()
  expect(screen.getByRole('link', { name: 'kid approved' })).toHaveAttribute('href', '/food?tag=kid+approved')
  const marks = screen.getByRole('list', { name: 'Marks' })
  expect(within(marks).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Tried'])
})

test('a recipe without marks has no marks list', async () => {
  stubApi({ ...traybake, marks: [] })
  renderAt(TRAYBAKE_PATH)
  await loaded()
  expect(screen.queryByRole('list', { name: 'Marks' })).not.toBeInTheDocument()
})

test('the hero is the recipe photo when it has one', async () => {
  stubApi({ ...traybake, image: 'photo.jpg' })
  const { container } = renderAt(TRAYBAKE_PATH)
  await loaded()
  expect(container.querySelector('img')).toHaveAttribute(
    'src',
    '/api/recipes/food/chicken-leek-traybake/files/photo.jpg',
  )
})

test('the hero is the category tile without a photo', async () => {
  stubApi(traybake)
  const { container } = renderAt(TRAYBAKE_PATH)
  await loaded()
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('.photo-tile--hero.photo-tile--plain')).not.toBeNull()
})

test('M1 leaves out ratings, history, notes and editing', async () => {
  stubApi(traybake)
  renderAt(TRAYBAKE_PATH)
  await loaded()
  expect(screen.queryByText(/rating|history|note|edit|restore/i)).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument()
})

describe('back link', () => {
  test('the back link goes to the side', async () => {
    stubApi(traybake)
    renderAt(TRAYBAKE_PATH)
    await loaded()
    expect(screen.getByRole('link', { name: 'Back to Food' })).toHaveAttribute('href', '/food')
  })

  test('the back link says Drinks on the drinks side', async () => {
    stubApi(daiquiri)
    renderAt('/drinks/daiquiri')
    await screen.findByRole('heading', { level: 1, name: 'Daiquiri' })
    expect(screen.getByRole('link', { name: 'Back to Drinks' })).toHaveAttribute('href', '/drinks')
  })

  test('the back link keeps the browse query it came from', async () => {
    stubApi(traybake)
    renderAt({ pathname: TRAYBAKE_PATH, state: { browse: '?mark=favourite&sort=time' } })
    await loaded()
    expect(screen.getByRole('link', { name: 'Back to Food' })).toHaveAttribute(
      'href',
      '/food?mark=favourite&sort=time',
    )
  })

  test('an empty browse query goes back to the bare side', async () => {
    stubApi(traybake)
    renderAt({ pathname: TRAYBAKE_PATH, state: { browse: '' } })
    await loaded()
    expect(screen.getByRole('link', { name: 'Back to Food' })).toHaveAttribute('href', '/food')
  })

  test('opening a recipe from the browse page remembers the filters', async () => {
    stubApi(traybake)
    renderAt('/food?tag=batch+cook')
    fireEvent.click(await screen.findByRole('link', { name: /Chicken and leek traybake/ }))
    await loaded()
    expect(screen.getByRole('link', { name: 'Back to Food' })).toHaveAttribute(
      'href',
      '/food?tag=batch+cook',
    )
  })
})

test('on a phone the back button sits on the hero and there is no bottom bar', async () => {
  stubViewport(false)
  stubApi(traybake)
  renderAt(TRAYBAKE_PATH)
  await loaded()
  const back = screen.getByRole('link', { name: 'Back to Food' })
  expect(back).toHaveClass('round-btn')
  expect(screen.queryByRole('navigation', { name: 'Food or drinks' })).not.toBeInTheDocument()
  expect(screen.getByText('Mains · 45 min · Serves 4')).toBeInTheDocument()
})

test('on desktop the shell header stays and the back link is a text link', async () => {
  stubViewport(true)
  stubApi(traybake)
  renderAt(TRAYBAKE_PATH)
  await loaded()
  expect(screen.getByRole('navigation', { name: 'Food or drinks' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to Food' })).not.toHaveClass('round-btn')
})

test('a source URL is a link that opens in a new tab', async () => {
  stubApi({ ...traybake, source: { url: 'https://www.example.com/recipes/traybake', photo: null } })
  renderAt(TRAYBAKE_PATH)
  await loaded()
  const source = screen.getByRole('region', { name: 'Source' })
  const link = within(source).getByRole('link', { name: 'example.com' })
  expect(link).toHaveAttribute('href', 'https://www.example.com/recipes/traybake')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  expect(within(source).queryByText('View photo')).not.toBeInTheDocument()
})

test('a source that is not a web address is shown as text, not linked', async () => {
  stubApi({ ...traybake, source: { url: 'javascript:alert(1)', photo: null } })
  renderAt(TRAYBAKE_PATH)
  await loaded()
  const source = screen.getByRole('region', { name: 'Source' })
  expect(within(source).getByText('javascript:alert(1)')).toBeInTheDocument()
  expect(within(source).queryByRole('link')).not.toBeInTheDocument()
})

test('a source photo has a View photo link to the image', async () => {
  stubApi({ ...traybake, source: { url: null, photo: 'page 1.jpg' } })
  renderAt(TRAYBAKE_PATH)
  await loaded()
  const link = screen.getByRole('link', { name: 'View photo' })
  expect(link).toHaveAttribute('href', '/api/recipes/food/chicken-leek-traybake/files/page%201.jpg')
  expect(link).toHaveAttribute('target', '_blank')
})

test('a recipe with no source has no source card', async () => {
  stubApi(traybake)
  renderAt(TRAYBAKE_PATH)
  await loaded()
  expect(screen.queryByRole('region', { name: 'Source' })).not.toBeInTheDocument()
})

test('an unknown recipe shows not found inside the shell', async () => {
  stubApi(traybake)
  renderAt('/drinks/nope')
  expect(await screen.findByText('Not found')).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Food or drinks' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to Drinks' })).toHaveAttribute('href', '/drinks')
})

test('an API error shows an alert inside the shell', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
  renderAt(TRAYBAKE_PATH)
  expect(await screen.findByRole('alert')).toHaveTextContent('loading food/chicken-leek-traybake failed: 500')
  expect(screen.getByRole('navigation', { name: 'Food or drinks' })).toBeInTheDocument()
  expect(screen.queryByText('Not found')).not.toBeInTheDocument()
})
