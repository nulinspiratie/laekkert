import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import App from './App'
import type { Bar, BarItem, DrinkBar, RecipeSummary } from './types'

function recipe(over: Partial<RecipeSummary> & Pick<RecipeSummary, 'slug' | 'name'>): RecipeSummary {
  return {
    side: 'food',
    category: 'mains',
    time_minutes: 30,
    tags: [],
    marks: [],
    image: null,
    rating: null,
    last_made: null,
    ...over,
  }
}

const traybake = recipe({
  slug: 'chicken-leek-traybake',
  name: 'Chicken and leek traybake',
  time_minutes: 45,
  tags: ['weeknight', 'kid approved'],
  marks: ['favourite'],
  image: 'photo.jpg',
})
const quesadillas = recipe({
  slug: 'veggie-quesadillas',
  name: 'Veggie quesadillas',
  time_minutes: 20,
  tags: ['weeknight', 'vegetarian', 'kid approved'],
  marks: ['tried'],
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
  marks: ['favourite'],
})

const DEFAULT_FOOD = '/food?sort=time'

const drinkBar = (over: Partial<DrinkBar> = {}): DrinkBar => ({
  status: 'can_make',
  missing: [],
  unsorted: [],
  fresh: [],
  ...over,
})

function drink(slug: string, name: string, bar: DrinkBar, over: Partial<RecipeSummary> = {}): RecipeSummary {
  return recipe({ slug, name, side: 'drinks', category: 'cocktails', time_minutes: 5, bar, ...over })
}

const negroni = drink('negroni', 'Negroni', drinkBar(), { marks: ['favourite'] })
const gimlet = drink('gimlet', 'Gimlet', drinkBar({ status: 'fresh_only', fresh: ['lime juice'] }), {
  marks: ['favourite'],
})
const paloma = drink(
  'paloma',
  'Paloma',
  drinkBar({ status: 'fresh_only', fresh: ['grapefruit', 'lime juice', 'soda water'] }),
)
const maiTai = drink('mai-tai', 'Mai tai', drinkBar({ status: 'missing', missing: ['orgeat'], fresh: ['lime juice'] }))
const cornNOil = drink('corn-n-oil', "Corn 'n' oil", drinkBar({ status: 'unsorted', unsorted: ['falernum'] }))
const drinks = [negroni, gimlet, paloma, maiTai, cornNOil]

function barItem(name: string, state: BarItem['state'], over: Partial<BarItem> = {}): BarItem {
  return { name, aliases: [], kind: 'spirits', fresh: false, state, used_in: [], recipe: null, ...over }
}

function bar(items: BarItem[]): Bar {
  return {
    items,
    set_up: items.some((item) => item.state !== null),
    counts: { can_make: 0, fresh_only: 0, missing: 0, unsorted: 0, total: 0 },
  }
}

/** Set up, everything sorted. */
const SORTED_BAR = bar([barItem('gin', 'have'), barItem('orgeat', 'dont'), barItem('limes', null, { fresh: true })])

function listing(recipes: RecipeSummary[]) {
  return new Response(JSON.stringify({ recipes }), { status: 200 })
}

/** The list for any recipes URL; `barBody` for /api/bar ('fail' answers 503). */
function stubFetch(recipes: RecipeSummary[] = food, barBody: Bar | 'fail' = SORTED_BAR) {
  const fetch = vi.fn(async (url: string) => {
    if (url !== '/api/bar') return listing(recipes)
    if (barBody === 'fail') return new Response(JSON.stringify({ error: 'The bar could not be read.' }), { status: 503 })
    return new Response(JSON.stringify(barBody), { status: 200 })
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

function Location() {
  const { pathname, search } = useLocation()
  return <output aria-label="location">{pathname + search}</output>
}

// A data router, because the editor (one test navigates to it) needs one.
function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <>
            <App />
            <Location />
          </>
        ),
      },
    ],
    { initialEntries: [path] },
  )
  return render(<RouterProvider router={router} />)
}

const location = () => screen.getByLabelText('location').textContent
const recipeNames = () =>
  screen
    .getAllByRole('link')
    .map((link) => link.getAttribute('href') ?? '')
    .filter((href) => /^\/(food|drinks)\/(?!new$)[^?]+$/.test(href))

afterEach(() => {
  vi.useRealTimers()
})

test('the default food view lists all food, quickest first', async () => {
  const fetch = stubFetch()
  renderAt(DEFAULT_FOOD)
  expect(await screen.findByText('quickest first · 4 recipes')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=food')
  expect(recipeNames()).toEqual([
    '/food/veggie-quesadillas',
    '/food/red-lentil-dal',
    '/food/brownies',
    '/food/chicken-leek-traybake',
  ])
  expect(screen.getByRole('heading', { level: 1, name: 'Food' })).toBeInTheDocument()
})

test('the subtitle says "1 recipe" in the singular', async () => {
  stubFetch()
  renderAt('/food?tag=vegetarian&tag=weeknight')
  expect(await screen.findByText('A to Z · 1 recipe')).toBeInTheDocument()
})

test('removing the chip shows all recipes', async () => {
  stubFetch()
  renderAt('/food?mark=favourite&sort=time')
  await screen.findByText('Favourite, quickest first · 2 recipes')
  fireEvent.click(screen.getByRole('button', { name: 'Remove Favourite filter' }))
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
  expect(within(card).queryByRole('img', { name: /kid/i })).not.toBeInTheDocument()
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
  renderAt('/food?tag=nope&mark=favourite')
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

test('drinks has the bar heading, its own categories and the same two marks', async () => {
  const fetch = stubFetch([daiquiri])
  renderAt('/drinks')
  expect(await screen.findByText('1 drink · 0 you can make right now')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=drinks')
  expect(document.querySelector('.page-heading-eyebrow')).toHaveTextContent('The bar')
  expect(screen.getByRole('searchbox', { name: 'Search drinks' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cocktails 1' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Kid approved' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Favourite' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try next' })).toBeInTheDocument()
  const card = screen.getByRole('link', { name: /Daiquiri/ })
  expect(within(card).getByRole('img', { name: 'Favourite' })).toBeInTheDocument()
})

test('the sort select offers cooking time, rating, recently made and A to Z', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  const options = within(screen.getByRole('combobox', { name: 'Sort' })).getAllByRole('option')
  expect(options.map((option) => option.textContent)).toEqual(['Cooking time', 'Rating', 'Recently made', 'A–Z'])
  expect(screen.queryByText(/cook with what you have/i)).toBeNull()
})

test('sorting by rating and recently made reorders the list and the subtitle', async () => {
  stubFetch([
    { ...traybake, rating: 4, last_made: '2026-10-01T18:00:00Z' },
    { ...dal, rating: 5, last_made: '2026-08-01T18:00:00Z' },
    brownies,
  ])
  renderAt('/food')
  await screen.findByText('A to Z · 3 recipes')
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'rating' } })
  expect(location()).toBe('/food?sort=rating')
  expect(await screen.findByText('highest rated first · 3 recipes')).toBeInTheDocument()
  expect(recipeNames()).toEqual(['/food/red-lentil-dal', '/food/chicken-leek-traybake', '/food/brownies'])
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'made' } })
  expect(await screen.findByText('recently made first · 3 recipes')).toBeInTheDocument()
  expect(recipeNames()).toEqual(['/food/chicken-leek-traybake', '/food/red-lentil-dal', '/food/brownies'])
})

test('card shows rating', async () => {
  stubFetch([{ ...traybake, rating: 4.5 }, { ...dal, rating: 4 }, brownies])
  renderAt('/food')
  await screen.findByText('A to Z · 3 recipes')
  const rated = screen.getByRole('link', { name: /Chicken and leek traybake/ })
  const label = within(rated).getByLabelText('Rated 4.5 out of 5')
  expect(label).toHaveTextContent('4.5')
  expect(within(screen.getByRole('link', { name: /Red lentil dal/ })).getByLabelText('Rated 4.0 out of 5')).toHaveTextContent('4.0')
  const unrated = screen.getByRole('link', { name: /Brownies/ })
  expect(within(unrated).queryByLabelText(/^Rated/)).not.toBeInTheDocument()
})

test('list views show the rating too', async () => {
  stubFetch([{ ...traybake, rating: 3.5 }])
  localStorage.setItem('laekkert.view', 'list')
  renderAt('/food')
  await screen.findByText('A to Z · 1 recipe')
  expect(within(screen.getByRole('link', { name: /Chicken/ })).getByLabelText('Rated 3.5 out of 5')).toBeInTheDocument()
})

test('New recipe link goes to the editor', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  fireEvent.click(screen.getByRole('link', { name: 'New recipe' }))
  expect(location()).toBe('/food/new')
})

test('the drinks page links to a new drink in the editor', async () => {
  stubFetch([daiquiri])
  renderAt('/drinks')
  await screen.findByRole('link', { name: /Daiquiri/ })
  expect(screen.getByRole('link', { name: 'New recipe' })).toHaveAttribute('href', '/drinks/new')
})

// ---- phone ----

test('on a phone the filter button says how many filters are active', async () => {
  stubViewport(false)
  stubFetch()
  const view = renderAt('/food?mark=favourite&sort=time')
  expect(await screen.findByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument()
  view.unmount()

  renderAt(DEFAULT_FOOD + '&q=leek')
  expect(await screen.findByRole('button', { name: 'Filters' })).toBeInTheDocument()
})

test('phone filter count adds marks, tags and category; not sort or search', async () => {
  stubViewport(false)
  stubFetch()
  renderAt('/food?cat=mains&mark=favourite&mark=try_next&tag=weeknight&sort=time&q=x')
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

test('the phone bar has a New recipe button that goes to the editor', async () => {
  stubViewport(false)
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  const add = screen.getByRole('link', { name: 'New recipe' })
  expect(add).toHaveAttribute('href', '/food/new')
  expect(add.textContent).toBe('')
  fireEvent.click(add)
  expect(location()).toBe('/food/new')
})

test('the phone filter sheet filters live, resets and closes with the count', async () => {
  stubViewport(false)
  stubFetch()
  renderAt('/food?mark=favourite&sort=time')
  fireEvent.click(await screen.findByRole('button', { name: 'Filters, 1 active' }))

  const sheet = screen.getByRole('dialog', { name: 'Filters' })
  expect(within(sheet).getByRole('heading', { name: 'Filters' })).toBeInTheDocument()
  expect(within(sheet).getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(within(sheet).getByRole('button', { name: 'vegetarian' }))
  expect(location()).toBe('/food?mark=favourite&tag=vegetarian&sort=time')
  expect(within(sheet).getByRole('button', { name: 'Show 1 recipe' })).toBeInTheDocument()

  fireEvent.click(within(sheet).getByRole('radio', { name: 'A–Z' }))
  expect(location()).toBe('/food?mark=favourite&tag=vegetarian')
  expect(within(sheet).getByRole('radio', { name: 'A–Z' })).toBeChecked()

  fireEvent.click(within(sheet).getByRole('radio', { name: 'Mains' }))
  expect(location()).toBe('/food?cat=mains&mark=favourite&tag=vegetarian')

  fireEvent.click(within(sheet).getByRole('button', { name: 'Reset' }))
  expect(location()).toBe(DEFAULT_FOOD)

  fireEvent.click(within(sheet).getByRole('button', { name: 'Show 4 recipes' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
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

// ---- the bar ----

const radio = (name: string) => screen.getByRole('radio', { name })

test('filters drinks by what the bar can make', async () => {
  stubFetch(drinks)
  renderAt('/drinks')
  expect(await screen.findByText('5 drinks · 1 you can make right now')).toBeInTheDocument()
  const group = screen.getByRole('radiogroup', { name: 'Inventory' })
  expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
    'Everything 5',
    'Can make now 1',
    'Only need fresh items 2',
  ])
  expect(radio('Everything 5')).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('link', { name: 'Edit the bar' })).toHaveAttribute('href', '/bar')

  fireEvent.click(radio('Can make now 1'))
  expect(location()).toBe('/drinks?bar=can')
  expect(await screen.findByText('Can make now · 1 drink')).toBeInTheDocument()
  expect(recipeNames()).toEqual(['/drinks/negroni'])
  expect(radio('Can make now 1')).toHaveAttribute('aria-checked', 'true')

  fireEvent.click(radio('Only need fresh items 2'))
  expect(location()).toBe('/drinks?bar=fresh')
  expect(await screen.findByText('Only need fresh items · 2 drinks')).toBeInTheDocument()
  expect(recipeNames()).toEqual(['/drinks/gimlet', '/drinks/paloma'])

  fireEvent.click(radio('Everything 5'))
  expect(location()).toBe('/drinks')
})

test('the bar counts follow the other filters', async () => {
  stubFetch(drinks)
  renderAt('/drinks?mark=favourite&bar=can')
  expect(await screen.findByText('Can make now · 1 drink')).toBeInTheDocument()
  expect(radio('Everything 2')).toHaveAttribute('aria-checked', 'false')
  expect(radio('Can make now 1')).toHaveAttribute('aria-checked', 'true')
  expect(radio('Only need fresh items 1')).toBeInTheDocument()
})

test('on a phone the bar filter is chips under the heading', async () => {
  stubViewport(false)
  stubFetch(drinks)
  renderAt('/drinks')
  await screen.findByRole('link', { name: /Negroni/ })
  const group = screen.getByRole('radiogroup', { name: 'From your bar' })
  expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
    'All 5',
    'Can make 1',
    'Fresh only 2',
  ])
  expect(radio('All 5')).toHaveAttribute('aria-checked', 'true')
  fireEvent.click(radio('Fresh only 2'))
  expect(location()).toBe('/drinks?bar=fresh')
  expect(radio('Fresh only 2')).toHaveAttribute('aria-checked', 'true')
  expect(recipeNames()).toEqual(['/drinks/gimlet', '/drinks/paloma'])
  // The chips are not filters the sheet counts.
  expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'The bar' })).toHaveAttribute('href', '/bar')
})

test('food has no bar filter', async () => {
  const fetch = stubFetch()
  renderAt('/food?bar=can')
  expect(await screen.findByText('A to Z · 4 recipes')).toBeInTheDocument()
  expect(screen.queryByRole('radiogroup', { name: 'Inventory' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Edit the bar' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'The bar' })).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalledWith('/api/bar', expect.anything())
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('food on a phone has no bar chips or bar button', async () => {
  stubViewport(false)
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  expect(screen.queryByRole('radiogroup', { name: 'From your bar' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'The bar' })).not.toBeInTheDocument()
})

const UNSORTED_BAR = bar([barItem('gin', 'have'), barItem('falernum', null), barItem('mezcal', null)])

test('shows the unsorted banner', async () => {
  stubFetch(drinks, UNSORTED_BAR)
  const view = renderAt('/drinks')
  const banner = await screen.findByRole('link', { name: /not sorted yet/ })
  expect(banner).toHaveAccessibleName('2 bottles not sorted yet. Drinks that use them count as missing. Sort them')
  expect(banner).toHaveAttribute('href', '/bar')
  view.unmount()

  stubViewport(false)
  renderAt('/drinks')
  const phone = await screen.findByRole('link', { name: /not sorted yet/ })
  expect(phone).toHaveAccessibleName('2 new bottles not sorted yet Sort')
  expect(phone).toHaveAttribute('href', '/bar')
})

test('the unsorted banner says one bottle in the singular', async () => {
  stubFetch(drinks, bar([barItem('gin', 'have'), barItem('falernum', null)]))
  renderAt('/drinks')
  expect(await screen.findByRole('link', { name: /not sorted yet/ })).toHaveAccessibleName(
    '1 bottle not sorted yet. Drinks that use it count as missing. Sort them',
  )
})

test('no unsorted banner when everything is sorted or the bar is not set up', async () => {
  stubFetch(drinks)
  const view = renderAt('/drinks')
  await screen.findByText('5 drinks · 1 you can make right now')
  expect(screen.queryByRole('link', { name: /not sorted yet/ })).not.toBeInTheDocument()
  view.unmount()

  stubFetch(drinks, bar([barItem('gin', null), barItem('falernum', null)]))
  renderAt('/drinks')
  expect(await screen.findByRole('link', { name: 'Set up the bar' })).toHaveAttribute('href', '/bar')
  expect(screen.queryByRole('link', { name: /not sorted yet/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Edit the bar' })).not.toBeInTheDocument()
})

test('shows card badges', async () => {
  stubFetch(drinks)
  const view = renderAt('/drinks')
  await screen.findByText('5 drinks · 1 you can make right now')
  const card = (name: RegExp) => screen.getByRole('link', { name })
  expect(within(card(/Negroni/)).getByText('Can make now')).toBeInTheDocument()
  expect(within(card(/Gimlet/)).getByText('Buy fresh: lime juice')).toBeInTheDocument()
  expect(within(card(/Paloma/)).getByText('Buy fresh: grapefruit, lime juice +1')).toBeInTheDocument()
  expect(within(card(/Mai tai/)).getByText('Missing: orgeat')).toBeInTheDocument()
  expect(within(card(/Corn 'n' oil/)).getByText('Not sorted: falernum')).toBeInTheDocument()
  view.unmount()

  stubViewport(false)
  renderAt('/drinks')
  await screen.findByRole('link', { name: /Gimlet/ })
  expect(within(card(/Gimlet/)).getByText('Buy: lime juice')).toBeInTheDocument()
  expect(within(card(/Negroni/)).getByText('Can make now')).toBeInTheDocument()
})

test('list views show the badges too', async () => {
  stubFetch(drinks)
  localStorage.setItem('laekkert.view', 'list')
  const view = renderAt('/drinks')
  await screen.findByText('5 drinks · 1 you can make right now')
  expect(within(screen.getByRole('link', { name: /Mai tai/ })).getByText('Missing: orgeat')).toBeInTheDocument()
  view.unmount()

  stubViewport(false)
  renderAt('/drinks')
  await screen.findByRole('link', { name: /Gimlet/ })
  expect(within(screen.getByRole('link', { name: /Gimlet/ })).getByText('Buy: lime juice')).toBeInTheDocument()
})

const NEW_BAR = bar([barItem('gin', null), barItem('orgeat', null)])
const unsortedDrinks = [
  drink('negroni', 'Negroni', drinkBar({ status: 'unsorted', unsorted: ['gin'] })),
  drink('mai-tai', 'Mai tai', drinkBar({ status: 'unsorted', unsorted: ['orgeat'] })),
]

test('shows the set-up empty state', async () => {
  stubFetch(unsortedDrinks, NEW_BAR)
  const view = renderAt('/drinks?bar=can')
  expect(await screen.findByRole('heading', { name: 'Set up your bar first' })).toBeInTheDocument()
  expect(screen.getByText(/Mark each bottle as have or don't have\./)).toHaveTextContent(
    "Lækkert doesn't know what's in your cabinet yet, so nothing can show here. Mark each bottle as have or don't have. It takes about a minute.",
  )
  expect(screen.getByText('Can make now · 0 drinks')).toBeInTheDocument()
  // One in the filter panel, one in the empty state.
  for (const link of screen.getAllByRole('link', { name: 'Set up the bar' })) {
    expect(link).toHaveAttribute('href', '/bar')
  }
  fireEvent.click(screen.getByRole('link', { name: 'Show all 2 drinks' }))
  expect(location()).toBe('/drinks')
  expect(await screen.findByText('2 drinks · 0 you can make right now')).toBeInTheDocument()
  view.unmount()

  stubViewport(false)
  renderAt('/drinks?bar=fresh')
  expect(await screen.findByRole('heading', { name: 'Set up your bar first' })).toBeInTheDocument()
  expect(screen.getByText(/Tap Have for each bottle you own\./)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Set up the bar' })).toHaveAttribute('href', '/bar')
})

test('shows the fresh-only empty state', async () => {
  const sour = drink('whisky-sour', 'Whisky sour', drinkBar({ status: 'fresh_only', fresh: ['lemons'] }))
  stubFetch([gimlet, paloma, sour, maiTai])
  renderAt('/drinks?bar=can')
  expect(await screen.findByRole('heading', { name: 'Nothing without a trip to the shop' })).toBeInTheDocument()
  expect(
    screen.getByText(
      'You have the bottles for 3 drinks, but every one needs something fresh. Lime juice covers 2 of them.',
    ),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open the bar' })).toHaveAttribute('href', '/bar')
  fireEvent.click(screen.getByRole('link', { name: 'Show the 3 that need fresh items' }))
  expect(location()).toBe('/drinks?bar=fresh')
  expect(recipeNames()).toEqual(['/drinks/gimlet', '/drinks/paloma', '/drinks/whisky-sour'])
})

test('the fresh-only empty state for one drink', async () => {
  stubFetch([gimlet, maiTai])
  renderAt('/drinks?bar=can')
  expect(
    await screen.findByText('You have the bottles for 1 drink, but it needs something fresh: lime juice.'),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'Show the drink that needs fresh items' }))
  expect(location()).toBe('/drinks?bar=fresh')
})

test('shows the generic empty state', async () => {
  stubFetch([maiTai, cornNOil])
  const view = renderAt('/drinks?bar=can')
  expect(await screen.findByRole('heading', { name: 'Nothing to make yet' })).toBeInTheDocument()
  expect(screen.getByText('Every drink is missing a bottle or uses one not sorted yet.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open the bar' })).toHaveAttribute('href', '/bar')
  fireEvent.click(screen.getByRole('link', { name: 'Show all 2 drinks' }))
  expect(location()).toBe('/drinks')
  view.unmount()

  renderAt('/drinks?bar=fresh&sort=rating')
  expect(await screen.findByRole('heading', { name: 'Nothing to make yet' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Show all 2 drinks' })).toHaveAttribute('href', '/drinks?sort=rating')
})

test('other filters that leave nothing keep the plain empty state', async () => {
  stubFetch(drinks)
  renderAt('/drinks?bar=can&tag=nope')
  expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Nothing to make yet' })).not.toBeInTheDocument()
})

test('browsing works when the bar fails to load', async () => {
  stubFetch(drinks, 'fail')
  const view = renderAt('/drinks')
  expect(await screen.findByText('A to Z · 5 recipes')).toBeInTheDocument()
  expect(recipeNames()).toHaveLength(5)
  expect(screen.queryByRole('radiogroup', { name: 'Inventory' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Edit the bar' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /not sorted yet/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(within(screen.getByRole('link', { name: /Mai tai/ })).getByText('Missing: orgeat')).toBeInTheDocument()
  view.unmount()

  stubViewport(false)
  stubFetch(unsortedDrinks, 'fail')
  renderAt('/drinks?bar=can')
  await waitFor(() => expect(recipeNames()).toHaveLength(unsortedDrinks.length))
  expect(screen.queryByRole('heading', { name: 'Nothing to make yet' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Set up your bar first' })).not.toBeInTheDocument()
  expect(screen.queryByRole('radiogroup', { name: 'From your bar' })).not.toBeInTheDocument()
})

test('a bar filter in the URL is ignored when the bar fails to load', async () => {
  stubFetch(drinks, 'fail')
  renderAt('/drinks?bar=can')
  await waitFor(() => expect(recipeNames()).toHaveLength(5))
  expect(recipeNames()).toEqual(expect.arrayContaining(drinks.map((d) => `/drinks/${d.slug}`)))
  expect(screen.getByText('A to Z · 5 recipes')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Nothing to make yet' })).not.toBeInTheDocument()
})

test('fresh only with nothing fresh but drinks to make says so', async () => {
  stubFetch([negroni, maiTai])
  renderAt('/drinks?bar=fresh')
  expect(await screen.findByRole('heading', { name: 'Nothing needs only fresh items' })).toBeInTheDocument()
  expect(
    screen.getByText("No drink needs only fresh items right now. You can make 1 drink with what's in the bar."),
  ).toBeInTheDocument()
  expect(screen.queryByText('Every drink is missing a bottle or uses one not sorted yet.')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open the bar' })).toHaveAttribute('href', '/bar')
  fireEvent.click(screen.getByRole('link', { name: 'Show all 2 drinks' }))
  expect(location()).toBe('/drinks')
})
