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

const DEFAULT_FOOD = '/food?sort=favourites'

const drinkBar = (over: Partial<DrinkBar> = {}): DrinkBar => ({
  status: 'can_make',
  missing: [],
  unsorted: [],
  untracked: [],
  ...over,
})

function drink(slug: string, name: string, bar: DrinkBar | null, over: Partial<RecipeSummary> = {}): RecipeSummary {
  return recipe({ slug, name, side: 'drinks', category: 'cocktails', time_minutes: 5, bar, ...over })
}

const daiquiri = drink('daiquiri', 'Daiquiri', drinkBar(), { marks: ['favourite'] })

const negroni = drink('negroni', 'Negroni', drinkBar(), { marks: ['favourite'] })
const gimlet = drink('gimlet', 'Gimlet', drinkBar({ status: 'can_make', untracked: ['lime juice'] }), {
  marks: ['favourite'],
})
const paloma = drink(
  'paloma',
  'Paloma',
  drinkBar({ status: 'can_make', untracked: ['grapefruit', 'lime juice', 'soda water'] }),
)
const maiTai = drink('mai-tai', 'Mai tai', drinkBar({ status: 'missing', missing: ['orgeat'], untracked: ['lime juice'] }))
const cornNOil = drink('corn-n-oil', "Corn 'n' oil", drinkBar({ status: 'unsorted', unsorted: ['falernum'] }))
const drinks = [negroni, gimlet, paloma, maiTai, cornNOil]

// One of each view: two can-make drinks (one a mocktail), one missing a bottle, two syrups or prep.
const campariNegroni = drink('negroni', 'Negroni', drinkBar({ status: 'missing', missing: ['campari'] }), {
  marks: ['favourite'],
})
const shirley = drink('shirley-temple', 'Shirley Temple', drinkBar(), { category: 'mocktails' })
const simpleSyrup = drink('simple-syrup', 'Simple syrup', null, { category: 'syrups' })
const gingerPrep = drink('ginger-cordial', 'Ginger cordial', null, { category: 'prep' })
const viewDrinks = [gimlet, campariNegroni, shirley, simpleSyrup, gingerPrep]

function barItem(name: string, state: BarItem['state'], over: Partial<BarItem> = {}): BarItem {
  return { name, aliases: [], kind: 'spirits', tracked: true, untracked_because: null, state, used_in: [], recipe: null, ...over }
}

function bar(items: BarItem[]): Bar {
  return {
    items,
    set_up: items.some((item) => item.state !== null),
    counts: { can_make: 0, missing: 0, unsorted: 0, total: 0 },
  }
}

/** Set up, everything sorted. */
const SORTED_BAR = bar([barItem('gin', 'have'), barItem('orgeat', 'dont'), barItem('limes', null, { tracked: false, untracked_because: 'marked' })])

function listing(recipes: RecipeSummary[]) {
  return new Response(JSON.stringify({ recipes }), { status: 200 })
}

const DEFAULT_QUICK_TAGS = ['breakfast', 'dinner', 'kid approved', 'quick', 'vegetarian']

/**
 * The list for any recipes URL; `barBody` for /api/bar ('fail' answers 503); `quickTags` for
 * /api/settings ('fail' answers 500).
 */
function stubFetch(
  recipes: RecipeSummary[] = food,
  barBody: Bar | 'fail' = SORTED_BAR,
  quickTags: string[] | 'fail' = DEFAULT_QUICK_TAGS,
) {
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/settings') {
      if (quickTags === 'fail') return new Response(JSON.stringify({ error: 'no' }), { status: 500 })
      return new Response(JSON.stringify({ food_quick_tags: quickTags }), { status: 200 })
    }
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

/** The recipe list requests made, leaving out settings and the bar. */
const recipeFetches = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/recipes'))

const tabs = () => within(screen.getByRole('radiogroup', { name: 'Category' }))
const quickChips = () => within(screen.getByRole('group', { name: 'Quick tags' }))
const chipNames = () =>
  quickChips()
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent)

afterEach(() => {
  vi.useRealTimers()
})

test('the default food view lists all food, favourites and tried first', async () => {
  const fetch = stubFetch()
  renderAt(DEFAULT_FOOD)
  expect(await screen.findByText('favourites and tried first · 4 recipes')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=food')
  expect(recipeNames()).toEqual([
    '/food/red-lentil-dal',
    '/food/chicken-leek-traybake',
    '/food/veggie-quesadillas',
    '/food/brownies',
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

test('clicking a More tag in the side panel filters, and the tag shows in the chip row', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  const aside = within(screen.getByRole('complementary'))
  expect(aside.getByRole('heading', { name: 'More tags' })).toBeInTheDocument()
  const tag = aside.getByRole('button', { name: 'weeknight' })
  expect(tag).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(tag)
  expect(await screen.findByText('A to Z · 2 recipes')).toBeInTheDocument()
  expect(location()).toBe('/food?tag=weeknight')
  expect(aside.getByRole('button', { name: 'weeknight' })).toHaveAttribute('aria-pressed', 'true')
  // The row shows it (soft, removable), so the removable chips under the heading don't.
  const chip = quickChips().getByRole('button', { name: 'Weeknight' })
  expect(chip).toHaveAttribute('aria-pressed', 'true')
  expect(chip).toHaveClass('quick-chip--other')
  expect(screen.queryByRole('button', { name: 'Remove weeknight filter' })).not.toBeInTheDocument()
  expect(recipeNames()).toEqual(['/food/chicken-leek-traybake', '/food/veggie-quesadillas'])
})

test('marks filter through the side panel, categories through the tabs', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  fireEvent.click(screen.getByRole('button', { name: 'Favourite' }))
  expect(location()).toBe('/food?mark=favourite')
  fireEvent.click(tabs().getByRole('radio', { name: 'Mains 2' }))
  expect(location()).toBe('/food?cat=mains&mark=favourite')
  expect(await screen.findByText('Favourite, A to Z · 2 recipes')).toBeInTheDocument()
  expect(tabs().getByRole('radio', { name: 'Mains 2' })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Remove Favourite filter' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remove Mains filter' })).not.toBeInTheDocument()
  fireEvent.click(tabs().getByRole('radio', { name: 'All 2' }))
  expect(location()).toBe('/food?mark=favourite')
})

test('the tabs leave out categories without recipes', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  expect(tabs().getAllByRole('radio').map((tab) => tab.textContent)).toEqual(['All 4', 'Mains 3', 'Desserts 1'])
  expect(screen.getByRole('radio', { name: 'All 4' })).toBeChecked()
})

test('the chips are the quick tags in use with counts, then More', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  expect(chipNames()).toEqual(['Kid approved, 2 recipes', 'Vegetarian, 2 recipes', 'More'])
  expect(quickChips().queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
})

test('the quick tags come from the settings, matched by name key, in that order', async () => {
  stubFetch(food, SORTED_BAR, ['Weeknight', 'vegetarian', 'gluten free'])
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  expect(await screen.findByRole('button', { name: 'Weeknight, 2 recipes' })).toBeInTheDocument()
  expect(chipNames()).toEqual(['Weeknight, 2 recipes', 'Vegetarian, 2 recipes', 'More'])
  fireEvent.click(quickChips().getByRole('button', { name: 'Weeknight, 2 recipes' }))
  // The filter uses the recipes' spelling.
  expect(location()).toBe('/food?tag=weeknight')
  const aside = within(screen.getByRole('complementary'))
  expect(aside.getByRole('button', { name: 'kid approved' })).toBeInTheDocument()
  expect(aside.queryByRole('button', { name: 'weeknight' })).not.toBeInTheDocument()
})

test('settings that fail to load mean the default quick tags', async () => {
  stubFetch(food, SORTED_BAR, 'fail')
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  expect(await screen.findByRole('group', { name: 'Quick tags' })).toBeInTheDocument()
  expect(chipNames()).toEqual(['Kid approved, 2 recipes', 'Vegetarian, 2 recipes', 'More'])
})

test('no quick tags means no chip row', async () => {
  const fetch = stubFetch(food, SORTED_BAR, [])
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/settings', expect.anything()))
  expect(screen.getByRole('radiogroup', { name: 'Category' })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Quick tags' })).not.toBeInTheDocument()
})

test('a tap on a chip adds the tag, a second tap removes it', async () => {
  stubViewport(false)
  stubFetch()
  renderAt(DEFAULT_FOOD)
  await screen.findByText('quickest first · 4 recipes')
  fireEvent.click(await screen.findByRole('button', { name: 'Vegetarian, 2 recipes' }))
  expect(location()).toBe('/food?tag=vegetarian&sort=time')
  expect(await screen.findByText('quickest first · 2 recipes')).toBeInTheDocument()
  const on = quickChips().getByRole('button', { name: 'Vegetarian' })
  expect(on).toHaveAttribute('aria-pressed', 'true')
  expect(on.querySelector('svg')).not.toBeNull()
  // Kid approved now counts what Vegetarian leaves.
  expect(quickChips().getByRole('button', { name: 'Kid approved, 1 recipe' })).toBeInTheDocument()
  fireEvent.click(on)
  expect(location()).toBe(DEFAULT_FOOD)
})

test('a tap on a tab sets cat=, and All removes it', async () => {
  stubViewport(false)
  stubFetch()
  renderAt(DEFAULT_FOOD)
  await screen.findByText('quickest first · 4 recipes')
  fireEvent.click(tabs().getByRole('radio', { name: 'Desserts 1' }))
  expect(location()).toBe('/food?cat=desserts&sort=time')
  expect(await screen.findByText('quickest first · 1 recipe')).toBeInTheDocument()
  fireEvent.click(tabs().getByRole('radio', { name: 'All 4' }))
  expect(location()).toBe(DEFAULT_FOOD)
})

test('a tab or chip that would leave nothing is dimmed and does nothing', async () => {
  stubViewport(false)
  stubFetch()
  renderAt('/food?cat=desserts&sort=time')
  await screen.findByText('quickest first · 1 recipe')
  const chip = await screen.findByRole('button', { name: 'Vegetarian, 0 recipes' })
  expect(chip).toHaveAttribute('aria-disabled', 'true')
  expect(chip).toBeEnabled()
  fireEvent.click(chip)
  expect(location()).toBe('/food?cat=desserts&sort=time')
  // The picked tab is never dimmed.
  expect(tabs().getByRole('radio', { name: 'Desserts 1' })).not.toHaveAttribute('aria-disabled')

  fireEvent.click(tabs().getByRole('radio', { name: 'All 4' }))
  fireEvent.click(quickChips().getByRole('button', { name: 'Kid approved, 2 recipes' }))
  expect(location()).toBe('/food?tag=kid+approved&sort=time')
  const desserts = tabs().getByRole('radio', { name: 'Desserts 0' })
  expect(desserts).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(desserts)
  expect(location()).toBe('/food?tag=kid+approved&sort=time')
})

test('Clear drops the category and tags and keeps the search, marks, sort and what you have', async () => {
  stubFetch()
  renderAt('/food?q=a&cat=mains&mark=favourite&tag=vegetarian&tag=weeknight&sort=time&have=chicken')
  await screen.findByRole('group', { name: 'Quick tags' })
  fireEvent.click(quickChips().getByRole('button', { name: 'Clear' }))
  expect(location()).toBe('/food?q=a&mark=favourite&sort=time&have=chicken')
  expect(quickChips().queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
})

test('desktop More moves focus to More tags', async () => {
  stubFetch()
  renderAt('/food')
  fireEvent.click(await screen.findByRole('button', { name: 'More' }))
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'More tags' }))
})

test('desktop has no More when every tag is a quick tag', async () => {
  stubFetch([dal, brownies])
  renderAt('/food')
  await screen.findByRole('button', { name: 'Vegetarian, 1 recipe' })
  expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'More tags' })).not.toBeInTheDocument()
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
  expect(recipeFetches(fetch)).toEqual(['/api/recipes?side=food&q=lentil'])
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

test('drinks has the bar heading, the Show views and the same two marks', async () => {
  const fetch = stubFetch([daiquiri])
  renderAt('/drinks')
  expect(await screen.findByText('Can make · 1 drink')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=drinks')
  expect(document.querySelector('.page-heading-eyebrow')).toHaveTextContent('The bar')
  expect(screen.getByRole('searchbox', { name: 'Search drinks' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 2, name: 'Show' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Style' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Cocktails/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Kid approved' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Favourite' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try next' })).toBeInTheDocument()
  const card = screen.getByRole('link', { name: /Daiquiri/ })
  expect(within(card).getByRole('img', { name: 'Favourite' })).toBeInTheDocument()
})

test('the sort select offers favourites first, cooking time, rating, recently made and A to Z', async () => {
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  const options = within(screen.getByRole('combobox', { name: 'Sort' })).getAllByRole('option')
  expect(options.map((option) => option.textContent)).toEqual(['Favourites first', 'Cooking time', 'Rating', 'Recently made', 'A–Z'])
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

test('phone filter count adds marks and other tags; not category, quick tags, sort or search', async () => {
  stubViewport(false)
  stubFetch()
  const view = renderAt('/food?cat=mains&mark=favourite&mark=try_next&tag=weeknight&tag=vegetarian&sort=time&q=x')
  expect(await screen.findByRole('button', { name: 'Filters, 3 active' })).toBeInTheDocument()
  view.unmount()

  renderAt('/food?cat=mains&tag=vegetarian&tag=kid+approved&sort=time')
  expect(await screen.findByRole('button', { name: 'Filters' })).toBeInTheDocument()
})

test('More on a phone opens the filter sheet', async () => {
  stubViewport(false)
  stubFetch()
  renderAt(DEFAULT_FOOD)
  await screen.findByRole('group', { name: 'Quick tags' })
  fireEvent.click(quickChips().getByRole('button', { name: 'More' }))
  expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
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
  // Food: no Category (the tabs do it); More tags without the quick tags.
  expect(within(sheet).queryByRole('heading', { name: 'Category' })).not.toBeInTheDocument()
  expect(within(sheet).queryByRole('radiogroup', { name: 'Category' })).not.toBeInTheDocument()
  expect(within(sheet).getByRole('heading', { name: 'More tags' })).toBeInTheDocument()
  expect(within(sheet).queryByRole('button', { name: 'vegetarian' })).not.toBeInTheDocument()
  fireEvent.click(within(sheet).getByRole('button', { name: 'weeknight' }))
  expect(location()).toBe('/food?mark=favourite&tag=weeknight&sort=time')
  expect(within(sheet).getByRole('button', { name: 'Show 1 recipe' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toBeInTheDocument()

  fireEvent.click(within(sheet).getByRole('radio', { name: 'A–Z' }))
  expect(location()).toBe('/food?mark=favourite&tag=weeknight')
  expect(within(sheet).getByRole('radio', { name: 'A–Z' })).toBeChecked()

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
const radioTexts = (group: HTMLElement) => within(group).getAllByRole('radio').map((r) => r.textContent)

test('drinks open on Can make: only what the bar can make, no syrups', async () => {
  stubFetch(viewDrinks)
  renderAt('/drinks')
  expect(await screen.findByText('Can make · 2 drinks')).toBeInTheDocument()
  expect(radio('Can make 2')).toHaveAttribute('aria-checked', 'true')
  expect(recipeNames()).toEqual(['/drinks/gimlet', '/drinks/shirley-temple'])
  expect(screen.getByRole('link', { name: 'Edit the bar' })).toHaveAttribute('href', '/bar')
})

test('the desktop Show radiogroup has the four views with counts, and no Style', async () => {
  stubFetch(viewDrinks)
  renderAt('/drinks')
  await screen.findByText('Can make · 2 drinks')
  const group = screen.getByRole('radiogroup', { name: 'Show' })
  expect(radioTexts(group)).toEqual(['Can make 2', 'All drinks 3', 'Mocktails 1', 'Syrups & prep 2'])
  expect(screen.getByRole('heading', { level: 2, name: 'Show' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Style' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^(Cocktails|Mocktails|Syrups|Prep)\b/ })).not.toBeInTheDocument()
})

test('food has category tabs and no Show views', async () => {
  const fetch = stubFetch()
  renderAt('/food?bar=can&show=all')
  expect(await screen.findByText('A to Z · 4 recipes')).toBeInTheDocument()
  expect(screen.getByRole('radiogroup', { name: 'Category' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Category' })).not.toBeInTheDocument()
  expect(screen.queryByRole('radiogroup', { name: 'Show' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Edit the bar' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'The bar' })).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalledWith('/api/bar', expect.anything())
  expect(fetch).toHaveBeenCalledWith('/api/settings', expect.anything())
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('drinks has no quick rows and reads no settings, on desktop or a phone', async () => {
  const fetch = stubFetch(drinks)
  const view = renderAt('/drinks?show=all&tag=sour')
  await screen.findByRole('heading', { level: 1, name: 'Drinks' })
  expect(screen.queryByRole('radiogroup', { name: 'Category' })).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Quick tags' })).not.toBeInTheDocument()
  // Drinks keep the removable tag chips and the Tags heading.
  expect(screen.getByRole('button', { name: 'Remove sour filter' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Tags' })).toBeInTheDocument()
  view.unmount()

  stubViewport(false)
  renderAt('/drinks?show=all&tag=sour')
  expect(await screen.findByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument()
  expect(screen.queryByRole('radiogroup', { name: 'Category' })).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Quick tags' })).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalledWith('/api/settings', expect.anything())
})

test('the desktop views change the URL, the list and the result line', async () => {
  stubFetch(viewDrinks)
  renderAt('/drinks')
  await screen.findByText('Can make · 2 drinks')

  fireEvent.click(radio('All drinks 3'))
  expect(location()).toBe('/drinks?show=all')
  expect(await screen.findByText('3 drinks · 2 you can make')).toBeInTheDocument()
  expect(recipeNames()).toEqual(['/drinks/gimlet', '/drinks/negroni', '/drinks/shirley-temple'])
  expect(radio('All drinks 3')).toHaveAttribute('aria-checked', 'true')
  expect(radio('Can make 2')).toHaveAttribute('aria-checked', 'false')

  fireEvent.click(radio('Mocktails 1'))
  expect(location()).toBe('/drinks?show=mocktails')
  expect(await screen.findByText('Mocktails · 1 drink')).toBeInTheDocument()
  expect(recipeNames()).toEqual(['/drinks/shirley-temple'])

  fireEvent.click(radio('Syrups & prep 2'))
  expect(location()).toBe('/drinks?show=syrups')
  expect(await screen.findByText('Syrups & prep · 2 recipes')).toBeInTheDocument()
  expect(recipeNames()).toEqual(['/drinks/ginger-cordial', '/drinks/simple-syrup'])

  fireEvent.click(radio('Can make 2'))
  expect(location()).toBe('/drinks')
  expect(await screen.findByText('Can make · 2 drinks')).toBeInTheDocument()
})

test('the view counts follow the other filters', async () => {
  stubFetch(viewDrinks)
  renderAt('/drinks?mark=favourite')
  expect(await screen.findByText('Can make · 1 drink')).toBeInTheDocument()
  const group = screen.getByRole('radiogroup', { name: 'Show' })
  expect(radioTexts(group)).toEqual(['Can make 1', 'All drinks 2', 'Mocktails 0', 'Syrups & prep 0'])
  expect(radio('Can make 1')).toHaveAttribute('aria-checked', 'true')
})

test('on a phone the views are chips under the heading', async () => {
  stubViewport(false)
  stubFetch(viewDrinks)
  renderAt('/drinks')
  await screen.findByRole('link', { name: /Gimlet/ })
  const group = screen.getByRole('radiogroup', { name: 'Show' })
  expect(radioTexts(group)).toEqual(['Can make 2', 'All 3', 'Mocktails 1', 'Syrups 2'])
  expect(radio('Can make 2')).toHaveAttribute('aria-checked', 'true')
  expect(recipeNames()).toEqual(['/drinks/gimlet', '/drinks/shirley-temple'])

  fireEvent.click(radio('Mocktails 1'))
  expect(location()).toBe('/drinks?show=mocktails')
  expect(radio('Mocktails 1')).toHaveAttribute('aria-checked', 'true')
  expect(recipeNames()).toEqual(['/drinks/shirley-temple'])

  fireEvent.click(radio('Syrups 2'))
  expect(location()).toBe('/drinks?show=syrups')
  expect(recipeNames()).toEqual(['/drinks/ginger-cordial', '/drinks/simple-syrup'])
  // The chips are not filters the sheet counts.
  expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'The bar' })).toHaveAttribute('href', '/bar')
})

test('old bar and category links open the matching view', async () => {
  stubFetch(viewDrinks)
  renderAt('/drinks?cat=mocktails')
  expect(await screen.findByText('Mocktails · 1 drink')).toBeInTheDocument()
  expect(radio('Mocktails 1')).toHaveAttribute('aria-checked', 'true')
  // The old param is dropped on the next change.
  fireEvent.click(radio('All drinks 3'))
  expect(location()).toBe('/drinks?show=all')
})

test('food on a phone has no view chips or bar button', async () => {
  stubViewport(false)
  stubFetch()
  renderAt('/food')
  await screen.findByText('A to Z · 4 recipes')
  expect(screen.queryByRole('radiogroup', { name: 'Show' })).not.toBeInTheDocument()
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
  await screen.findByText('Can make · 3 drinks')
  expect(screen.queryByRole('link', { name: /not sorted yet/ })).not.toBeInTheDocument()
  view.unmount()

  stubFetch(drinks, bar([barItem('gin', null), barItem('falernum', null)]))
  renderAt('/drinks')
  expect(await screen.findByRole('heading', { name: 'Set up your bar first' })).toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: 'Set up the bar' }).length).toBeGreaterThan(0)
  expect(screen.queryByRole('link', { name: /not sorted yet/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Edit the bar' })).not.toBeInTheDocument()
})

test('shows card badges', async () => {
  stubFetch(drinks)
  const view = renderAt('/drinks?show=all')
  await screen.findByText('5 drinks · 3 you can make')
  const card = (name: RegExp) => screen.getByRole('link', { name })
  expect(within(card(/Negroni/)).getByText('Can make now')).toBeInTheDocument()
  expect(within(card(/Gimlet/)).getByText('Also needs: lime juice')).toBeInTheDocument()
  const paloma = within(card(/Paloma/)).getByText('Also needs: grapefruit, lime juice +1')
  // The full list is the badge's title and accessible name.
  expect(paloma.parentElement).toHaveAttribute('title', 'Also needs: grapefruit, lime juice, soda water')
  expect(paloma.parentElement).toHaveAccessibleName('Also needs: grapefruit, lime juice, soda water')
  expect(within(card(/Mai tai/)).getByText('Missing: orgeat')).toBeInTheDocument()
  expect(within(card(/Corn 'n' oil/)).getByText('Not sorted: falernum')).toBeInTheDocument()
  view.unmount()

  stubViewport(false)
  renderAt('/drinks?show=all')
  await screen.findByRole('link', { name: /Gimlet/ })
  expect(within(card(/Gimlet/)).getByText('Also needs: lime juice')).toBeInTheDocument()
  expect(within(card(/Negroni/)).getByText('Can make now')).toBeInTheDocument()
})

test('a syrup card has no badge', async () => {
  stubFetch(viewDrinks)
  renderAt('/drinks?show=syrups')
  const card = await screen.findByRole('link', { name: /Simple syrup/ })
  expect(card.querySelector('.bar-badge')).toBeNull()
  expect(within(card).queryByText(/Can make|Also needs|Missing|Not sorted/)).not.toBeInTheDocument()
})

test('list views show the badges too', async () => {
  stubFetch(drinks)
  localStorage.setItem('laekkert.view', 'list')
  const view = renderAt('/drinks?show=all')
  await screen.findByText('5 drinks · 3 you can make')
  expect(within(screen.getByRole('link', { name: /Mai tai/ })).getByText('Missing: orgeat')).toBeInTheDocument()
  view.unmount()

  stubViewport(false)
  renderAt('/drinks?show=all')
  await screen.findByRole('link', { name: /Gimlet/ })
  expect(within(screen.getByRole('link', { name: /Gimlet/ })).getByText('Also needs: lime juice')).toBeInTheDocument()
})

const NEW_BAR = bar([barItem('gin', null), barItem('orgeat', null)])

test('a bar that is not set up shows the set-up box above the Can make list, not on All drinks', async () => {
  stubFetch(viewDrinks, NEW_BAR)
  const view = renderAt('/drinks')
  expect(await screen.findByRole('heading', { name: 'Set up your bar first' })).toBeInTheDocument()
  expect(screen.getByText(/Mark each bottle as have or don't have\./)).toHaveTextContent(
    "Lækkert doesn't know what's in your cabinet yet, so drinks that need bottles can't show here yet. Mark each bottle as have or don't have. It takes about a minute.",
  )
  // The drinks with no tracked bottle are still listed under the box.
  expect(recipeNames()).toEqual(['/drinks/gimlet', '/drinks/shirley-temple'])
  expect(screen.getByText('Can make · 2 drinks')).toBeInTheDocument()
  // One in the filter panel, one in the box.
  const links = screen.getAllByRole('link', { name: 'Set up the bar' })
  expect(links).toHaveLength(2)
  for (const link of links) expect(link).toHaveAttribute('href', '/bar')
  fireEvent.click(screen.getByRole('link', { name: 'Show all 3 drinks' }))
  expect(location()).toBe('/drinks?show=all')
  expect(await screen.findByText('3 drinks · 2 you can make')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Set up your bar first' })).not.toBeInTheDocument()
  view.unmount()

  stubViewport(false)
  renderAt('/drinks')
  expect(await screen.findByRole('heading', { name: 'Set up your bar first' })).toBeInTheDocument()
  expect(screen.getByText(/Tap Have for each bottle you own\./)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Set up the bar' })).toHaveAttribute('href', '/bar')
  expect(recipeNames()).toEqual(['/drinks/gimlet', '/drinks/shirley-temple'])
})

test('the set-up box is all there is when nothing is listed on Can make', async () => {
  stubFetch([campariNegroni, simpleSyrup], NEW_BAR)
  renderAt('/drinks')
  expect(await screen.findByRole('heading', { name: 'Set up your bar first' })).toBeInTheDocument()
  expect(recipeNames()).toEqual([])
  expect(screen.queryByRole('heading', { name: 'Nothing to make yet' })).not.toBeInTheDocument()
  expect(screen.queryByText('Nothing matches these filters.')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Show 1 drink' })).toHaveAttribute('href', '/drinks?show=all')
})

test('a set-up bar with nothing makeable says so and offers all the drinks', async () => {
  stubFetch([campariNegroni, maiTai, cornNOil])
  const view = renderAt('/drinks')
  expect(await screen.findByRole('heading', { name: 'Nothing to make yet' })).toBeInTheDocument()
  expect(screen.getByText('Every drink is missing a bottle or uses one not sorted yet.')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Set up your bar first' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open the bar' })).toHaveAttribute('href', '/bar')
  fireEvent.click(screen.getByRole('link', { name: 'Show all 3 drinks' }))
  expect(location()).toBe('/drinks?show=all')
  expect(recipeNames()).toHaveLength(3)
  view.unmount()

  stubViewport(false)
  renderAt('/drinks?sort=rating')
  expect(await screen.findByRole('heading', { name: 'Nothing to make yet' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Show all 3 drinks' })).toHaveAttribute('href', '/drinks?sort=rating&show=all')
})

test('other filters that leave nothing keep the plain empty state, and Clear filters keeps the view', async () => {
  stubFetch(drinks)
  const view = renderAt('/drinks?tag=nope')
  expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Nothing to make yet' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(location()).toBe('/drinks')
  view.unmount()

  renderAt('/drinks?show=mocktails&tag=nope&mark=favourite')
  expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(location()).toBe('/drinks?show=mocktails')
})

test('browsing works when the bar fails to load: no Can make, the list is All drinks', async () => {
  stubFetch(viewDrinks, 'fail')
  const view = renderAt('/drinks')
  expect(await screen.findByText('3 drinks · 2 you can make')).toBeInTheDocument()
  expect(recipeNames()).toEqual(['/drinks/gimlet', '/drinks/negroni', '/drinks/shirley-temple'])
  const group = screen.getByRole('radiogroup', { name: 'Show' })
  expect(radioTexts(group)).toEqual(['All drinks 3', 'Mocktails 1', 'Syrups & prep 2'])
  expect(radio('All drinks 3')).toHaveAttribute('aria-checked', 'true')
  expect(screen.queryByRole('radio', { name: /^Can make/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Edit the bar' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /not sorted yet/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Set up your bar first' })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(within(screen.getByRole('link', { name: /Negroni/ })).getByText('Missing: campari')).toBeInTheDocument()
  // The views still work.
  fireEvent.click(radio('Mocktails 1'))
  expect(location()).toBe('/drinks?show=mocktails')
  expect(recipeNames()).toEqual(['/drinks/shirley-temple'])
  view.unmount()

  stubViewport(false)
  stubFetch([campariNegroni, maiTai], 'fail')
  renderAt('/drinks?show=can')
  await waitFor(() => expect(recipeNames()).toHaveLength(2))
  expect(screen.queryByRole('heading', { name: 'Nothing to make yet' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Set up your bar first' })).not.toBeInTheDocument()
  expect(radioTexts(screen.getByRole('radiogroup', { name: 'Show' }))).toEqual(['All 2', 'Mocktails 0', 'Syrups 0'])
})

// ---- search inside a view ----

const whiteNegroni = drink('white-negroni', 'White negroni', drinkBar())

test('a search on Can make links to the matches it hides in All drinks', async () => {
  stubFetch([whiteNegroni, campariNegroni, simpleSyrup])
  renderAt('/drinks?q=negroni')
  const link = await screen.findByRole('link', { name: '1 more in All drinks' })
  expect(link).toHaveAttribute('href', '/drinks?q=negroni&show=all')
  expect(recipeNames()).toEqual(['/drinks/white-negroni'])
  fireEvent.click(link)
  expect(location()).toBe('/drinks?q=negroni&show=all')
  expect(await screen.findByText('2 drinks · 1 you can make')).toBeInTheDocument()
  // All drinks hides only the syrup now.
  expect(screen.queryByRole('link', { name: /more in All drinks/ })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '1 more in Syrups & prep' })).toHaveAttribute(
    'href',
    '/drinks?q=negroni&show=syrups',
  )
})

test('a search with no match in the view still points at All drinks', async () => {
  stubFetch([campariNegroni])
  renderAt('/drinks?q=negroni')
  expect(await screen.findByRole('link', { name: '1 more in All drinks' })).toHaveAttribute(
    'href',
    '/drinks?q=negroni&show=all',
  )
  expect(recipeNames()).toEqual([])
})

test('a search with no hits on Can make shows the plain empty state, not "Nothing to make yet"', async () => {
  // The stub answers every search with all three; none can be made.
  stubFetch([campariNegroni, maiTai, cornNOil])
  renderAt('/drinks?q=negroni')
  expect(await screen.findByRole('link', { name: '3 more in All drinks' })).toHaveAttribute(
    'href',
    '/drinks?q=negroni&show=all',
  )
  expect(recipeNames()).toEqual([])
  expect(screen.getByText('Nothing matches these filters.')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Nothing to make yet' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Open the bar' })).not.toBeInTheDocument()
})

test('a search that only syrups match points at Syrups & prep', async () => {
  stubFetch([simpleSyrup, gingerPrep])
  renderAt('/drinks?show=all&q=syrup')
  expect(await screen.findByRole('link', { name: '2 more in Syrups & prep' })).toHaveAttribute(
    'href',
    '/drinks?q=syrup&show=syrups',
  )
})

test('no "more in" line without a search or when nothing is hidden', async () => {
  stubFetch(viewDrinks)
  const view = renderAt('/drinks?mark=favourite')
  await screen.findByText('Can make · 1 drink')
  expect(screen.queryByRole('link', { name: /more in/ })).not.toBeInTheDocument()
  view.unmount()

  stubFetch([gimlet])
  renderAt('/drinks?q=gimlet')
  await screen.findByRole('link', { name: /Gimlet/ })
  expect(screen.queryByRole('link', { name: /more in/ })).not.toBeInTheDocument()
})

// ---- the phone's filter sheet on drinks ----

test('the drinks filter sheet has no Style, and Reset keeps the view', async () => {
  stubViewport(false)
  stubFetch(viewDrinks)
  renderAt('/drinks?show=mocktails&mark=favourite&q=x')
  fireEvent.click(await screen.findByRole('button', { name: 'Filters, 1 active' }))
  const sheet = screen.getByRole('dialog', { name: 'Filters' })
  expect(within(sheet).queryByRole('heading', { name: 'Style' })).not.toBeInTheDocument()
  expect(within(sheet).queryByRole('radiogroup', { name: 'Style' })).not.toBeInTheDocument()
  expect(within(sheet).queryByRole('radio', { name: 'Cocktails' })).not.toBeInTheDocument()
  expect(within(sheet).getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(within(sheet).getByRole('button', { name: 'Reset' }))
  expect(location()).toBe('/drinks?show=mocktails')
})

// ---- cook with what you have ----

const withHave = (base: RecipeSummary, matched: string[], missing: string[]): RecipeSummary => ({
  ...base,
  have: { matched, missing },
})
const haveTraybake = withHave(traybake, ['chicken thighs', 'leeks'], ['baby potatoes', 'olive oil', 'smoked paprika', 'lemon'])
const haveDal = withHave(dal, ['red lentils'], ['onion'])
const haveBrownies = withHave(brownies, ['eggs', 'butter'], [])
// The API's order: fewest missing first.
const haveRanked = [haveBrownies, haveDal, haveTraybake]

/** Answers the list with `ranked` when the URL asks for `have` terms, and with all food otherwise. */
function stubHaveFetch(ranked: RecipeSummary[] = haveRanked) {
  const fetch = vi.fn(async (url: string) => listing(url.includes('have=') ? ranked : food))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const asideHave = () => within(screen.getByRole('complementary')).getByRole('region', { name: 'What you have' })

test('the food filter aside has a What you have section between search and marks', async () => {
  stubFetch()
  renderAt(DEFAULT_FOOD)
  await screen.findByText('favourites and tried first · 4 recipes')
  const aside = screen.getByRole('complementary')
  const section = within(aside).getByRole('region', { name: 'What you have' })
  expect(within(section).getByRole('heading', { name: 'What you have' })).toBeInTheDocument()
  expect(within(section).getByPlaceholderText('Add an ingredient')).toBeInTheDocument()
  const order = [...aside.querySelectorAll('input[type="search"], h2')].map((el) => el.textContent || 'search')
  expect(order.slice(0, 3)).toEqual(['search', 'What you have', 'Marks'])
})

test('adding a term keeps the other params, refetches with have and ranks by fewest missing', async () => {
  const fetch = stubHaveFetch()
  renderAt(DEFAULT_FOOD)
  await screen.findByText('favourites and tried first · 4 recipes')
  const input = within(asideHave()).getByPlaceholderText('Add an ingredient')
  fireEvent.change(input, { target: { value: 'chicken' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(location()).toBe('/food?sort=favourites&have=chicken')
  expect(await screen.findByText('fewest missing first · 3 recipes')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=food&have=chicken')
  // The API's order wins over the chosen sort.
  expect(recipeNames()).toEqual(['/food/brownies', '/food/red-lentil-dal', '/food/chicken-leek-traybake'])
  expect(within(asideHave()).getByRole('button', { name: 'Remove chicken' })).toBeInTheDocument()
  // The sort control is left as it is.
  expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('favourites')
})

test('terms in the URL are fetched on first load, and cards wear the badge', async () => {
  const fetch = stubHaveFetch()
  renderAt('/food?sort=time&have=chicken&have=leeks')
  expect(await screen.findByText('fewest missing first · 3 recipes')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=food&have=chicken&have=leeks')
  const card = (name: RegExp) => screen.getByRole('link', { name })
  expect(within(card(/Brownies/)).getByText('Have everything')).toBeInTheDocument()
  expect(within(card(/Red lentil dal/)).getByText('Missing: onion')).toBeInTheDocument()
  const long = within(card(/Chicken and leek traybake/)).getByRole('img', {
    name: 'Missing: baby potatoes, olive oil, smoked paprika, lemon',
  })
  expect(long).toHaveAttribute('title', 'Missing: baby potatoes, olive oil, smoked paprika, lemon')
  expect(within(long).getByText('Missing: baby potatoes, olive oil +2')).toBeInTheDocument()
})

test('the list views wear the badge too', async () => {
  stubHaveFetch()
  localStorage.setItem('laekkert.view', 'list')
  renderAt('/food?have=chicken')
  expect(await screen.findByText('Have everything')).toBeInTheDocument()
  expect(screen.getByText('Missing: onion')).toBeInTheDocument()
})

test('a food list without terms has no badges', async () => {
  stubHaveFetch()
  renderAt(DEFAULT_FOOD)
  await screen.findByText('favourites and tried first · 4 recipes')
  expect(screen.queryByText('Have everything')).not.toBeInTheDocument()
  expect(screen.queryByText(/^Missing:/)).not.toBeInTheDocument()
})

test('the order and badges follow the data on screen while a new fetch is in flight', async () => {
  let release: (response: Response) => void = () => {}
  const fetch = vi.fn((url: string) => {
    if (url.includes('have=chicken&have=leeks')) return new Promise<Response>((resolve) => (release = resolve))
    return Promise.resolve(listing(url.includes('have=') ? haveRanked : food))
  })
  vi.stubGlobal('fetch', fetch)
  renderAt('/food?have=chicken')
  await screen.findByText('fewest missing first · 3 recipes')

  const input = within(asideHave()).getByPlaceholderText('Add an ingredient')
  fireEvent.change(input, { target: { value: 'leeks' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(location()).toBe('/food?have=chicken&have=leeks')
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=food&have=chicken&have=leeks')
  // Still the earlier answer: same order, same badges, same subtitle.
  expect(recipeNames()[0]).toBe('/food/brownies')
  expect(screen.getByText('Have everything')).toBeInTheDocument()
  expect(screen.getByText('fewest missing first · 3 recipes')).toBeInTheDocument()

  // The new answer replaces it once it arrives.
  release(listing([haveTraybake]))
  expect(await screen.findByText('fewest missing first · 1 recipe')).toBeInTheDocument()
})

test('removing the last term goes back to the chosen sort', async () => {
  stubHaveFetch()
  renderAt('/food?sort=time&have=chicken')
  await screen.findByText('fewest missing first · 3 recipes')
  fireEvent.click(within(asideHave()).getByRole('button', { name: 'Remove chicken' }))
  expect(location()).toBe('/food?sort=time')
  expect(await screen.findByText('quickest first · 4 recipes')).toBeInTheDocument()
  expect(recipeNames()[0]).toBe('/food/veggie-quesadillas')
})

test('Clear in the section drops every have param and keeps the rest', async () => {
  stubHaveFetch()
  renderAt('/food?mark=favourite&sort=time&have=chicken&have=leeks')
  await screen.findByText(/fewest missing first/)
  fireEvent.click(within(asideHave()).getByRole('button', { name: 'Clear' }))
  expect(location()).toBe('/food?mark=favourite&sort=time')
})

test('adding a term that is already there does nothing', async () => {
  stubHaveFetch()
  renderAt('/food?have=chicken')
  await screen.findByText(/fewest missing first/)
  const input = within(asideHave()).getByPlaceholderText('Add an ingredient')
  fireEvent.change(input, { target: { value: ' Chicken ' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(location()).toBe('/food?have=chicken')
})

test('switching side drops the terms', async () => {
  stubHaveFetch()
  renderAt('/food?have=chicken')
  await screen.findByText(/fewest missing first/)
  expect(screen.getByRole('link', { name: 'Drinks' })).toHaveAttribute('href', '/drinks')
  expect(screen.getByRole('link', { name: 'Food' })).toHaveAttribute('href', '/food?sort=favourites')
})

test('nothing uses the terms: the empty state names them and offers Clear', async () => {
  stubFetch([])
  renderAt('/food?sort=time&have=chicken&have=leeks')
  expect(await screen.findByRole('heading', { name: 'Nothing uses chicken or leeks' })).toBeInTheDocument()
  expect(screen.getByText('Try another ingredient, or clear the list.')).toBeInTheDocument()
  expect(screen.queryByText('No recipes yet.')).not.toBeInTheDocument()
  expect(screen.queryByText('Nothing matches these filters.')).not.toBeInTheDocument()
  const main = screen.getByRole('main')
  const empty = main.querySelector('.browse-empty') as HTMLElement
  fireEvent.click(within(empty).getByRole('button', { name: 'Clear' }))
  expect(location()).toBe('/food?sort=time')
})

test('the empty state joins one, two and three terms, and gives up at four', async () => {
  stubFetch([])
  const view = renderAt('/food?have=chicken')
  expect(await screen.findByRole('heading', { name: 'Nothing uses chicken' })).toBeInTheDocument()
  view.unmount()
  const three = renderAt('/food?have=chicken&have=leeks&have=eggs')
  expect(await screen.findByRole('heading', { name: 'Nothing uses chicken, leeks or eggs' })).toBeInTheDocument()
  three.unmount()
  renderAt('/food?have=chicken&have=leeks&have=eggs&have=milk')
  expect(await screen.findByRole('heading', { name: 'Nothing uses those' })).toBeInTheDocument()
})

test('terms plus other filters that leave nothing keep the generic empty state', async () => {
  stubHaveFetch()
  renderAt('/food?tag=nope&have=chicken')
  expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
  expect(screen.queryByText(/Nothing uses/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(location()).toBe('/food')
})

test('on a phone the What you have button opens a panel and shows pressed with terms', async () => {
  stubViewport(false)
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  stubHaveFetch()
  renderAt(DEFAULT_FOOD)
  await screen.findByText('favourites and tried first · 4 recipes')
  const button = screen.getByRole('button', { name: 'What you have' })
  expect(button).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByPlaceholderText('Add an ingredient')).not.toBeInTheDocument()

  fireEvent.click(button)
  const input = screen.getByPlaceholderText('Add an ingredient')
  expect(input).toHaveFocus()
  fireEvent.change(input, { target: { value: 'chicken' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(location()).toBe('/food?sort=favourites&have=chicken')
  expect(await screen.findByText('fewest missing first · 3 recipes')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'What you have' })).toHaveAttribute('aria-pressed', 'true')
  // The panel stays open after the re-render.
  expect(screen.getByPlaceholderText('Add an ingredient')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove chicken' })).toBeInTheDocument()

  // Closing it keeps the terms; the button still shows pressed.
  fireEvent.click(screen.getByRole('button', { name: 'What you have' }))
  expect(screen.queryByPlaceholderText('Add an ingredient')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'What you have' })).toHaveAttribute('aria-pressed', 'true')
  expect(location()).toBe('/food?sort=favourites&have=chicken')

  // Nothing about the terms is stored.
  for (const [key, value] of setItem.mock.calls) {
    expect(`${key} ${value}`).not.toMatch(/chicken/i)
  }
})

test('on a phone the panel starts open when the URL has terms, and can sit beside search', async () => {
  stubViewport(false)
  stubHaveFetch()
  renderAt('/food?q=leek&have=chicken')
  await screen.findByText(/fewest missing first/)
  expect(screen.getByPlaceholderText('Add an ingredient')).toBeInTheDocument()
  expect(screen.getByRole('searchbox', { name: 'Search food' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove chicken' })).toBeInTheDocument()
})

test('phone chips and buttons are never nested', async () => {
  stubViewport(false)
  stubHaveFetch()
  renderAt('/food?have=chicken&have=leeks')
  await screen.findByText(/fewest missing first/)
  for (const button of screen.getAllByRole('button')) expect(button.querySelector('button')).toBeNull()
})

test('drinks has no What you have button and ignores have= in the URL', async () => {
  stubViewport(false)
  const fetch = stubFetch(drinks)
  renderAt('/drinks?have=chicken')
  await screen.findByRole('link', { name: /Gimlet/ })
  expect(screen.queryByRole('button', { name: 'What you have' })).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=drinks')
  expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('have='))
  expect(screen.queryByText(/fewest missing first/)).not.toBeInTheDocument()
})

test('desktop drinks has no What you have section', async () => {
  stubFetch(drinks)
  renderAt('/drinks?have=chicken')
  await screen.findByRole('link', { name: /Gimlet/ })
  expect(screen.queryByRole('region', { name: 'What you have' })).not.toBeInTheDocument()
  expect(screen.queryByPlaceholderText('Add an ingredient')).not.toBeInTheDocument()
})

test('the phone filter sheet Reset drops the terms too', async () => {
  stubViewport(false)
  stubHaveFetch()
  renderAt('/food?mark=favourite&sort=time&have=chicken')
  fireEvent.click(await screen.findByRole('button', { name: 'Filters, 1 active' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Filters' })).getByRole('button', { name: 'Reset' }))
  expect(location()).toBe(DEFAULT_FOOD)
})
