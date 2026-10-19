import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import App from './App'
import type { RecipeSummary } from './types'

function recipe(over: Partial<RecipeSummary> & Pick<RecipeSummary, 'slug' | 'name'>): RecipeSummary {
  return {
    side: 'food',
    category: 'mains',
    time_minutes: 30,
    tags: [],
    marks: [],
    image: null,
    ...over,
  }
}

const traybake = recipe({
  slug: 'chicken-leek-traybake',
  name: 'Chicken and leek traybake',
  time_minutes: 45,
  tags: ['weeknight'],
  marks: ['kid_approved', 'favourite'],
  image: 'photo.jpg',
})
const quesadillas = recipe({
  slug: 'veggie-quesadillas',
  name: 'Veggie quesadillas',
  time_minutes: 20,
  tags: ['weeknight', 'vegetarian'],
  marks: ['kid_approved', 'tried'],
})
const dal = recipe({
  slug: 'red-lentil-dal',
  name: 'Red lentil dal',
  time_minutes: 35,
  tags: ['vegetarian'],
  marks: ['favourite'],
})
const brownies = recipe({
  slug: 'brownies',
  name: 'Brownies',
  category: 'desserts',
  time_minutes: 40,
  marks: ['try_next'],
})
const food = [traybake, quesadillas, dal, brownies]

const daiquiri = recipe({
  slug: 'daiquiri',
  name: 'Daiquiri',
  side: 'drinks',
  category: 'cocktails',
  time_minutes: 5,
  marks: ['favourite', 'kid_rejected'],
})

const DEFAULT_FOOD = '/food?mark=kid_approved&sort=time'

function listing(recipes: RecipeSummary[]) {
  return new Response(JSON.stringify({ recipes }), { status: 200 })
}

function stubFetch(recipes: RecipeSummary[] = food) {
  const fetch = vi.fn(async (_url: string) => listing(recipes))
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

function Location() {
  const { pathname, search } = useLocation()
  return <output aria-label="location">{pathname + search}</output>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Location />
    </MemoryRouter>,
  )
}

const location = () => screen.getByLabelText('location').textContent
const recipeNames = () =>
  screen
    .getAllByRole('link')
    .map((link) => link.getAttribute('href') ?? '')
    .filter((href) => /^\/(food|drinks)\/[^?]+$/.test(href))

afterEach(() => {
  vi.useRealTimers()
})

test('the default food view lists only kid-approved recipes, quickest first', async () => {
  const fetch = stubFetch()
  renderAt(DEFAULT_FOOD)
  expect(await screen.findByText('Kid approved, quickest first · 2 recipes')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=food')
  expect(recipeNames()).toEqual(['/food/veggie-quesadillas', '/food/chicken-leek-traybake'])
  expect(screen.getByRole('heading', { level: 1, name: 'Food' })).toBeInTheDocument()
})

test('the subtitle says "1 recipe" in the singular', async () => {
  stubFetch()
  renderAt('/food?tag=vegetarian&tag=weeknight')
  expect(await screen.findByText('A to Z · 1 recipe')).toBeInTheDocument()
})

test('removing the chip shows all recipes', async () => {
  stubFetch()
  renderAt(DEFAULT_FOOD)
  await screen.findByText('Kid approved, quickest first · 2 recipes')
  fireEvent.click(screen.getByRole('button', { name: 'Remove Kid approved filter' }))
  expect(await screen.findByText('quickest first · 4 recipes')).toBeInTheDocument()
  expect(location()).toBe('/food?sort=time')
  expect(recipeNames()).toHaveLength(4)
  expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument()
})

test('bare /food means no filters and A to Z', async () => {
  stubFetch()
  renderAt('/food')
  expect(await screen.findByText('A to Z · 4 recipes')).toBeInTheDocument()
  expect(recipeNames()[0]).toBe('/food/brownies')
})

test('clicking a tag filters and updates the URL', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  const tag = screen.getByRole('button', { name: 'vegetarian' })
  expect(tag).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(tag)
  expect(await screen.findByText('A to Z · 2 recipes')).toBeInTheDocument()
  expect(location()).toBe('/food?tag=vegetarian')
  expect(screen.getByRole('button', { name: 'vegetarian' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Remove vegetarian filter' })).toBeInTheDocument()
  expect(recipeNames()).toEqual(['/food/red-lentil-dal', '/food/veggie-quesadillas'])
})

test('marks and categories filter through the side panel', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  fireEvent.click(screen.getByRole('button', { name: 'Favourite' }))
  expect(location()).toBe('/food?mark=favourite')
  fireEvent.click(screen.getByRole('button', { name: 'Mains 3' }))
  expect(location()).toBe('/food?cat=mains&mark=favourite')
  expect(await screen.findByText('Favourite, A to Z · 2 recipes')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove Mains filter' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'All 4' }))
  expect(location()).toBe('/food?mark=favourite')
})

test('categories without recipes are left out of the panel', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  expect(screen.getByRole('button', { name: 'Desserts 1' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Sauces/ })).not.toBeInTheDocument()
})

test('the sort select changes the sort in the URL', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  const select = screen.getByRole('combobox', { name: 'Sort' })
  expect(select).toHaveValue('name')
  fireEvent.change(select, { target: { value: 'time' } })
  expect(location()).toBe('/food?sort=time')
  expect(await screen.findByText('quickest first · 4 recipes')).toBeInTheDocument()
  expect(recipeNames()[0]).toBe('/food/veggie-quesadillas')
})

test('typing in search fetches once after the debounce and writes q to the URL', async () => {
  const fetch = stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  fetch.mockClear()

  vi.useFakeTimers()
  const input = screen.getByRole('searchbox', { name: 'Search food' })
  fireEvent.change(input, { target: { value: 'l' } })
  fireEvent.change(input, { target: { value: 'le' } })
  fireEvent.change(input, { target: { value: 'leek ' } })
  expect(location()).toBe('/food?q=leek')
  expect(input).toHaveValue('leek ')
  await act(async () => {
    vi.advanceTimersByTime(199)
  })
  expect(fetch).not.toHaveBeenCalled()
  await act(async () => {
    vi.advanceTimersByTime(1)
  })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=food&q=leek')
})

test('whitespace-only search writes no q', async () => {
  const fetch = stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  fetch.mockClear()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search food' }), { target: { value: '   ' } })
  expect(location()).toBe('/food')
  expect(fetch).not.toHaveBeenCalled()
})

test('a search in the URL is fetched on first load and keeps the API order', async () => {
  const fetch = stubFetch([dal, brownies, quesadillas])
  renderAt('/food?q=lentil')
  expect(await screen.findByText('best match first · 3 recipes')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=food&q=lentil')
  expect(screen.getByRole('searchbox', { name: 'Search food' })).toHaveValue('lentil')
  expect(recipeNames()).toEqual(['/food/red-lentil-dal', '/food/brownies', '/food/veggie-quesadillas'])
})

test('clearing the search goes back to the unfiltered list', async () => {
  const fetch = vi.fn(async (url: string) => listing(url.includes('q=') ? [dal] : food))
  vi.stubGlobal('fetch', fetch)
  renderAt('/food?q=lentil')
  await screen.findByText('best match first · 1 recipe')
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search food' }), { target: { value: '' } })
  expect(location()).toBe('/food')
  expect(await screen.findByText('A to Z · 4 recipes')).toBeInTheDocument()
  expect(fetch).toHaveBeenLastCalledWith('/api/recipes?side=food')
})

test('a slower earlier response does not overwrite a newer one', async () => {
  const pending = new Map<string, (r: RecipeSummary[]) => void>()
  const fetch = vi.fn(
    (url: string) =>
      new Promise<Response>((resolve) => {
        pending.set(url, (recipes) => resolve(listing(recipes)))
      }),
  )
  vi.stubGlobal('fetch', fetch)
  renderAt('/food')
  await act(async () => pending.get('/api/recipes?side=food')!(food))
  await screen.findByText('A to Z · 4 recipes')

  const input = screen.getByRole('searchbox', { name: 'Search food' })
  vi.useFakeTimers()
  fireEvent.change(input, { target: { value: 'a' } })
  await act(async () => {
    vi.advanceTimersByTime(200)
  })
  fireEvent.change(input, { target: { value: 'ab' } })
  await act(async () => {
    vi.advanceTimersByTime(200)
  })
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=food&q=a')
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=food&q=ab')
  vi.useRealTimers()

  await act(async () => pending.get('/api/recipes?side=food&q=ab')!([brownies]))
  await act(async () => pending.get('/api/recipes?side=food&q=a')!([dal, quesadillas]))
  expect(recipeNames()).toEqual(['/food/brownies'])
})

test('the list toggle switches the markup and is remembered', async () => {
  stubFetch()
  const first = renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  const grid = screen.getByRole('list', { name: 'Recipes' })
  expect(grid).toHaveAttribute('data-view', 'grid')
  fireEvent.click(screen.getByRole('button', { name: 'List view' }))
  expect(screen.getByRole('list', { name: 'Recipes' })).toHaveAttribute('data-view', 'list')
  expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true')
  expect(localStorage.getItem('laekkert.view')).toBe('list')
  first.unmount()

  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  expect(screen.getByRole('list', { name: 'Recipes' })).toHaveAttribute('data-view', 'list')
})

test('a recipe card has category, name, time and the marks that matter', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  const card = screen.getByRole('link', { name: /Chicken and leek traybake/ })
  expect(card).toHaveAttribute('href', '/food/chicken-leek-traybake')
  expect(within(card).getByText('Mains')).toBeInTheDocument()
  expect(within(card).getByText('45 min')).toBeInTheDocument()
  expect(within(card).getByRole('img', { name: 'Favourite' })).toBeInTheDocument()
  expect(within(card).getByRole('img', { name: 'Kid approved' })).toBeInTheDocument()
  expect(within(card).queryByRole('img', { name: 'Try next' })).not.toBeInTheDocument()
  const tried = screen.getByRole('link', { name: /Veggie quesadillas/ })
  expect(within(tried).queryByRole('img', { name: /tried/i })).not.toBeInTheDocument()
  const next = screen.getByRole('link', { name: /Brownies/ })
  expect(within(next).getByRole('img', { name: 'Try next' })).toBeInTheDocument()
})

test('a recipe with an image shows it lazily; one without shows a tile and no img', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  const withImage = screen.getByRole('link', { name: /Chicken and leek traybake/ })
  const img = withImage.querySelector('img')!
  expect(img).toHaveAttribute('src', '/api/recipes/food/chicken-leek-traybake/files/photo.jpg')
  expect(img).toHaveAttribute('alt', '')
  expect(img).toHaveAttribute('loading', 'lazy')

  const without = screen.getByRole('link', { name: /Brownies/ })
  expect(without.querySelector('img')).toBeNull()
  expect(without.querySelector('.photo-tile svg')).not.toBeNull()
})

test('the list view shows a table-like row per recipe', async () => {
  stubFetch()
  localStorage.setItem('laekkert.view', 'list')
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  const row = screen.getByRole('link', { name: /Chicken and leek traybake/ })
  expect(within(row).getByText('Mains')).toBeInTheDocument()
  expect(within(row).getByText('45 min')).toBeInTheDocument()
  expect(within(row).getByRole('img', { name: 'Favourite' })).toBeInTheDocument()
  expect(row.querySelector('img')).not.toBeNull()
})

test('an empty result offers Clear filters, which goes to the bare side', async () => {
  stubFetch()
  renderAt('/food?tag=nope&mark=kid_approved')
  expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(location()).toBe('/food')
  expect(await screen.findByText('A to Z · 4 recipes')).toBeInTheDocument()
  expect(screen.queryByText('Nothing matches these filters.')).not.toBeInTheDocument()
})

test('a side with no recipes says so', async () => {
  stubFetch([])
  renderAt('/food')
  expect(await screen.findByText('No recipes yet.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
})

test('a failed load shows the error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
  renderAt('/food')
  expect(await screen.findByRole('alert')).toHaveTextContent('listing food failed: 500')
})

test('visiting a side remembers it', async () => {
  stubFetch([daiquiri])
  renderAt('/drinks')
  await screen.findByRole('link', { name: /Daiquiri/ })
  expect(localStorage.getItem('laekkert.side')).toBe('drinks')
})

test('drinks has the bar heading, its own categories and no kid approved mark', async () => {
  const fetch = stubFetch([daiquiri])
  renderAt('/drinks')
  expect(await screen.findByText('A to Z · 1 recipe')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=drinks')
  expect(screen.getByText('The bar')).toBeInTheDocument()
  expect(screen.getByRole('searchbox', { name: 'Search drinks' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cocktails 1' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Kid approved' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Favourite' })).toBeInTheDocument()
  const card = screen.getByRole('link', { name: /Daiquiri/ })
  expect(within(card).getByRole('img', { name: 'Favourite' })).toBeInTheDocument()
  expect(within(card).queryByRole('img', { name: /reject/i })).not.toBeInTheDocument()
})

test('M1 leaves out ratings, avatar and recipe creation', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  expect(screen.queryByText(/rating|recently made|new recipe|cook with what you have/i)).toBeNull()
  expect(screen.queryByRole('option', { name: /rating/i })).toBeNull()
})

// ---- phone ----

test('on a phone the filter button says how many filters are active', async () => {
  stubViewport(false)
  stubFetch()
  const view = renderAt(DEFAULT_FOOD)
  expect(await screen.findByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument()
  view.unmount()

  renderAt('/food?sort=time&q=leek')
  expect(await screen.findByRole('button', { name: 'Filters' })).toBeInTheDocument()
})

test('phone filter count adds marks, tags and category; not sort or search', async () => {
  stubViewport(false)
  stubFetch()
  renderAt('/food?cat=mains&mark=favourite&mark=kid_approved&tag=weeknight&sort=time&q=x')
  expect(await screen.findByRole('button', { name: 'Filters, 4 active' })).toBeInTheDocument()
})

test('the phone has no side panel, desktop search field or header toggle', async () => {
  stubViewport(false)
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'View mode' })).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
})

test('the phone filter sheet filters live, resets and closes with the count', async () => {
  stubViewport(false)
  stubFetch()
  renderAt(DEFAULT_FOOD)
  fireEvent.click(await screen.findByRole('button', { name: 'Filters, 1 active' }))

  const sheet = screen.getByRole('dialog', { name: 'Filters' })
  expect(within(sheet).getByRole('heading', { name: 'Filters' })).toBeInTheDocument()
  expect(within(sheet).getByRole('button', { name: 'Kid approved' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(within(sheet).getByRole('button', { name: 'vegetarian' }))
  expect(location()).toBe('/food?mark=kid_approved&tag=vegetarian&sort=time')
  expect(within(sheet).getByRole('button', { name: 'Show 1 recipe' })).toBeInTheDocument()

  fireEvent.click(within(sheet).getByRole('radio', { name: 'A–Z' }))
  expect(location()).toBe('/food?mark=kid_approved&tag=vegetarian')
  expect(within(sheet).getByRole('radio', { name: 'A–Z' })).toBeChecked()

  fireEvent.click(within(sheet).getByRole('radio', { name: 'Mains' }))
  expect(location()).toBe('/food?cat=mains&mark=kid_approved&tag=vegetarian')

  fireEvent.click(within(sheet).getByRole('button', { name: 'Reset' }))
  expect(location()).toBe(DEFAULT_FOOD)

  fireEvent.click(within(sheet).getByRole('button', { name: 'Show 2 recipes' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument()
})

test('the phone view button switches between grid and list rows', async () => {
  stubViewport(false)
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  expect(screen.getByRole('list', { name: 'Recipes' })).toHaveAttribute('data-view', 'grid')
  fireEvent.click(screen.getByRole('button', { name: 'Switch to list view' }))
  expect(screen.getByRole('list', { name: 'Recipes' })).toHaveAttribute('data-view', 'list')
  expect(localStorage.getItem('laekkert.view')).toBe('list')
  expect(screen.getByRole('button', { name: 'Switch to grid view' })).toBeInTheDocument()
})

test('the phone search button opens a search field', async () => {
  stubViewport(false)
  const fetch = stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Search food' }))
  const input = screen.getByRole('searchbox', { name: 'Search food' })
  expect(input).toHaveFocus()
  fetch.mockClear()
  fireEvent.change(input, { target: { value: 'dal' } })
  expect(location()).toBe('/food?q=dal')
})

test('the phone drinks page puts the masthead heading and cards on the Drinks theme', async () => {
  stubViewport(false)
  stubFetch([daiquiri])
  const { container } = renderAt('/drinks')
  await screen.findByRole('link', { name: /Daiquiri/ })
  expect(container.querySelector('[data-side="drinks"]')).not.toBeNull()
  expect(screen.getByText('The bar')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Search drinks' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
})
