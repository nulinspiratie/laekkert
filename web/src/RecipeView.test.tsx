import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, type To } from 'react-router'
import { describe, expect, test, vi } from 'vitest'
import App from './App'
import type { Bar, BarChanges, BarState, Recipe, RecipeSummary, TimelineEntry } from './types'

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
  version: 0,
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

interface Timeline {
  entries: TimelineEntry[]
  current_version: number | null
}

type Post = (url: string, body: unknown) => Response | Promise<Response>

/**
 * Answers the listing, recipe and timeline routes; any other recipe is a 404. Writes go to
 * `post`, which answers 500 unless a test gives one.
 */
function stubApiWith(options: { recipes: Recipe[]; timeline?: Timeline; post?: Post }) {
  const { recipes, timeline = { entries: [], current_version: null }, post } = options
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return post ? post(url, JSON.parse(String(init.body))) : new Response('{}', { status: 500 })
    }
    if (url.startsWith('/api/recipes?')) {
      return new Response(JSON.stringify({ recipes: recipes.map(summary) }), { status: 200 })
    }
    if (url.endsWith('/timeline')) return new Response(JSON.stringify(timeline), { status: 200 })
    const slug = decodeURIComponent(url.split('/').pop()!)
    const found = recipes.find((r) => r.slug === slug && url.includes(`/${r.side}/`))
    if (!found) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    return new Response(JSON.stringify(found), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function stubApi(...recipes: Recipe[]) {
  return stubApiWith({ recipes })
}

/** The bodies of the POSTs a stubbed fetch received, with their URLs. */
function posts(fetch: ReturnType<typeof stubApiWith>) {
  return fetch.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([url, init]) => ({ url, body: JSON.parse(String(init!.body)) as unknown }))
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

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

test('Favourite and Try next are toggles; Tried is status text', async () => {
  stubApi({ ...traybake, marks: ['tried', 'favourite'] })
  renderAt(TRAYBAKE_PATH)
  await loaded()
  const marks = screen.getByRole('group', { name: 'Marks' })
  expect(within(marks).getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
    ['Favourite', 'true'],
    ['Try next', 'false'],
  ])
  expect(within(marks).queryByRole('button', { name: 'Tried' })).not.toBeInTheDocument()
  expect(screen.getByText('Tried')).toBeInTheDocument()
})

test('a kid approved tag is a plain tag link, not a mark', async () => {
  stubApi({ ...traybake, marks: [] })
  renderAt(TRAYBAKE_PATH)
  await loaded()
  expect(screen.getByRole('link', { name: 'kid approved' })).toHaveAttribute('href', '/food?tag=kid+approved')
  expect(screen.queryByText('Tried')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /kid/i })).not.toBeInTheDocument()
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

describe('marks, rating and Made it', () => {
  test('toggling Favourite posts marks and shows Tried', async () => {
    const fetch = stubApiWith({
      recipes: [{ ...traybake, marks: [] }],
      post: () => json({ ...traybake, marks: ['favourite', 'tried'] }),
    })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    expect(screen.queryByText('Tried')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Favourite' }))
    expect(await screen.findByText('Tried')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'true')
    expect(posts(fetch)).toEqual([
      { url: '/api/recipes/food/chicken-leek-traybake/marks', body: { add: ['favourite'], remove: [] } },
    ])
  })

  test('switching a mark off removes it', async () => {
    const fetch = stubApiWith({
      recipes: [{ ...traybake, marks: ['try_next'] }],
      post: () => json({ ...traybake, marks: [] }),
    })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Try next' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try next' })).toHaveAttribute('aria-pressed', 'false'),
    )
    expect(posts(fetch)[0].body).toEqual({ add: [], remove: ['try_next'] })
  })

  test('failed mark toggle shows the error and keeps the old state', async () => {
    stubApiWith({
      recipes: [{ ...traybake, marks: [] }],
      post: () => json({ error: 'could not save; nothing was changed' }, 503),
    })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Favourite' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not save; nothing was changed')
    expect(screen.getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('the rating shows as stars with its text', async () => {
    stubApi({ ...traybake, rating: 4.5 })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    expect(screen.getByText('4.5')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Rate \d stars?$/ })).toHaveLength(5)
  })

  test('tapping the current star gives a half star', async () => {
    const fetch = stubApiWith({
      recipes: [{ ...traybake, rating: null }],
      post: (_url, body) => json({ entry: {}, recipe: { ...traybake, rating: (body as { rating: number }).rating } }),
    })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    const group = screen.getByRole('group', { name: 'Rating' })
    fireEvent.click(within(group).getByRole('button', { name: 'Rate 4 stars' }))
    expect(await screen.findByText('4.0')).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: 'Rate 4 stars' }))
    expect(await screen.findByText('3.5')).toBeInTheDocument()
    expect(posts(fetch).map((p) => p.body)).toEqual([
      { kind: 'rating', rating: 4 },
      { kind: 'rating', rating: 3.5 },
    ])
  })

  test('tapping star 1 when the rating is 1 posts a half star', async () => {
    const fetch = stubApiWith({
      recipes: [{ ...traybake, rating: 1 }],
      post: () => json({ entry: {}, recipe: { ...traybake, rating: 0.5 } }),
    })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Rate 1 star' }))
    expect(await screen.findByText('0.5')).toBeInTheDocument()
    expect(posts(fetch).map((p) => p.body)).toEqual([{ kind: 'rating', rating: 0.5 }])
  })

  test('a failed rating keeps the old rating and shows the error', async () => {
    stubApiWith({
      recipes: [{ ...traybake, rating: 4 }],
      post: () => json({ error: 'rating must be between 0.5 and 5' }, 400),
    })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Rate 2 stars' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('rating must be between 0.5 and 5')
    expect(screen.getByText('4.0')).toBeInTheDocument()
  })

  test('made it posts rating and note', async () => {
    const fetch = stubApiWith({
      recipes: [traybake],
      post: () => json({ entry: {}, recipe: { ...traybake, rating: 3, last_made: '2026-10-20T18:00:00Z' } }),
    })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    expect(screen.queryByRole('form', { name: 'Made it' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Made it' }))
    const form = screen.getByRole('form', { name: 'Made it' })
    fireEvent.click(within(form).getByRole('button', { name: 'Rate 3 stars' }))
    fireEvent.change(within(form).getByRole('textbox', { name: 'Note' }), { target: { value: 'Less salt next time' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Made it' })).not.toBeInTheDocument())
    expect(posts(fetch)).toEqual([
      {
        url: '/api/recipes/food/chicken-leek-traybake/timeline',
        body: { kind: 'made', rating: 3, note: 'Less salt next time' },
      },
    ])
    expect(screen.getByText('3.0')).toBeInTheDocument()
  })

  test('made it with nothing filled in posts a bare entry', async () => {
    const fetch = stubApiWith({ recipes: [traybake], post: () => json({ entry: {}, recipe: traybake }) })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Made it' }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Made it' })).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts(fetch)).toHaveLength(1))
    expect(posts(fetch)[0].body).toEqual({ kind: 'made' })
  })

  test('a failed made it keeps the form filled in and shows the error', async () => {
    stubApiWith({ recipes: [traybake], post: () => json({ error: 'could not save; nothing was changed' }, 503) })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Made it' }))
    const form = screen.getByRole('form', { name: 'Made it' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Note' }), { target: { value: 'Good' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not save')
    expect(within(screen.getByRole('form', { name: 'Made it' })).getByRole('textbox', { name: 'Note' })).toHaveValue('Good')
  })
})

describe('edit link', () => {
  test('Edit link goes to the editor', async () => {
    stubApi(traybake)
    renderAt(TRAYBAKE_PATH)
    await loaded()
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/food/chicken-leek-traybake/edit')
  })

  test('on a phone the edit button is round and labelled', async () => {
    stubViewport(false)
    stubApi(daiquiri)
    renderAt('/drinks/daiquiri')
    await screen.findByRole('heading', { level: 1, name: 'Daiquiri' })
    const edit = screen.getByRole('link', { name: 'Edit recipe' })
    expect(edit).toHaveAttribute('href', '/drinks/daiquiri/edit')
    expect(edit).toHaveClass('round-btn')
  })
})

describe('history', () => {
  const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T12:00:00Z`
  const base = { id: 'a1b2c3d4e5f6', via: 'app' as const }
  const created: TimelineEntry = { ...base, id: 'c00000000001', kind: 'created', version: 1, at: at(3) }
  const edit: TimelineEntry = {
    ...base,
    id: 'e00000000002',
    kind: 'edit',
    version: 2,
    at: at(28),
    restored_from: null,
    changes: [
      { section: 'ingredients', kind: 'removed', text: '1 tsp chili flakes' },
      { section: 'ingredients', kind: 'added', text: '½ tsp chili flakes' },
      { section: 'method', kind: 'changed', text: 'step 2' },
    ],
  }
  const note = (n: number): TimelineEntry => ({
    ...base,
    id: `n${String(n).padStart(11, '0')}`,
    kind: 'note',
    text: `Note number ${n}`,
    at: at(10 + n),
  })

  const entriesList = () => within(screen.getByRole('region', { name: 'History' })).getByRole('list', { name: 'Timeline' })

  test('history shows an edit with its diff lines', async () => {
    stubApiWith({ recipes: [traybake], timeline: { entries: [edit, created], current_version: 2 } })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    const list = await screen.findByRole('list', { name: 'Timeline' })
    // The diff is a list inside the entry; only the timeline's own items count.
    const items = (await within(list).findAllByRole('listitem')).filter((li) => li.parentElement === list)
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Edited ingredients and method')
    expect(items[0]).toHaveTextContent('28 Sep')
    const diff = within(items[0]).getByRole('list', { name: 'Changes' })
    expect(within(diff).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '−1 tsp chili flakes',
      '+½ tsp chili flakes',
      '•step 2',
    ])
    expect(items[1]).toHaveTextContent('Created this recipe')
    expect(items[1]).toHaveTextContent('3 Sep')
  })

  test('notes, ratings and made it entries show their content', async () => {
    const entries: TimelineEntry[] = [
      { ...base, id: 'm00000000001', kind: 'made', rating: 4, note: 'With rice', at: at(20) },
      { ...base, id: 'r00000000001', kind: 'rating', rating: 4.5, previous: 4, at: at(19) },
      { ...base, id: 'k00000000001', kind: 'marks', added: ['favourite'], removed: [], at: at(18) },
      { ...note(1), via: 'claude' },
    ]
    stubApiWith({ recipes: [traybake], timeline: { entries, current_version: null } })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    const items = within(await screen.findByRole('list', { name: 'Timeline' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Made it')
    expect(items[0]).toHaveTextContent('With rice')
    expect(items[0].querySelector('[role="img"][aria-label="Rated 4.0 out of 5"]')).not.toBeNull()
    expect(items[1]).toHaveTextContent('Changed the rating 4.0 → 4.5')
    expect(items[2]).toHaveTextContent('Marked it Favourite')
    expect(items[3]).toHaveTextContent('Added a note · via Claude')
    expect(items[3]).toHaveTextContent('Note number 1')
  })

  test('restore asks first and posts the version', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetch = stubApiWith({
      recipes: [traybake],
      timeline: { entries: [edit, created], current_version: 2 },
      post: () => json({ ...traybake, name: 'Chicken and leek traybake' }),
    })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    // Only the older version can be restored; the newest one is the recipe as it is.
    const buttons = await screen.findAllByRole('button', { name: 'Restore this version' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(confirm).toHaveBeenCalledWith(
      'Restore the recipe as it was after this change? Later changes stay in the history.',
    )
    await waitFor(() => expect(posts(fetch)).toHaveLength(1))
    expect(posts(fetch)[0]).toEqual({ url: '/api/recipes/food/chicken-leek-traybake/restore', body: { version: 1 } })
  })

  test('a cancelled restore posts nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const fetch = stubApiWith({ recipes: [traybake], timeline: { entries: [edit, created], current_version: 2 } })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    fireEvent.click(await screen.findByRole('button', { name: 'Restore this version' }))
    expect(posts(fetch)).toEqual([])
  })

  test('adding a note posts it, clears the box and reloads the history', async () => {
    const fetch = stubApiWith({
      recipes: [traybake],
      timeline: { entries: [created], current_version: 1 },
      post: () => json({ entry: note(1), recipe: traybake }),
    })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    const box = screen.getByRole('textbox', { name: 'Add a note' })
    expect(box).toHaveAttribute('placeholder', 'Add a note: what worked, what you changed')
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled()
    fireEvent.change(box, { target: { value: '  More lemon  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(box).toHaveValue(''))
    expect(posts(fetch)[0].body).toEqual({ kind: 'note', text: 'More lemon' })
    const timelineGets = () =>
      fetch.mock.calls.filter(([url, init]) => String(url).endsWith('/timeline') && init?.method !== 'POST')
    await waitFor(() => expect(timelineGets()).toHaveLength(2))
  })

  test('restore and add note wait while another write is in flight', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let finish: (response: Response) => void = () => {}
    const fetch = stubApiWith({
      recipes: [{ ...traybake, marks: [] }],
      timeline: { entries: [edit, created], current_version: 2 },
      post: () => new Promise<Response>((resolve) => (finish = resolve)),
    })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    const restore = await screen.findByRole('button', { name: 'Restore this version' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a note' }), { target: { value: 'Waiting' } })
    expect(restore).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Favourite' }))
    await waitFor(() => expect(restore).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled()
    fireEvent.click(restore)
    expect(posts(fetch)).toHaveLength(1)
    finish(json({ ...traybake, marks: ['favourite', 'tried'] }))
    await waitFor(() => expect(restore).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Add note' })).toBeEnabled()
  })

  test('a failed note keeps the text and shows the error', async () => {
    stubApiWith({
      recipes: [traybake],
      timeline: { entries: [created], current_version: 1 },
      post: () => json({ error: 'could not save; nothing was changed' }, 503),
    })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    const box = screen.getByRole('textbox', { name: 'Add a note' })
    fireEvent.change(box, { target: { value: 'Keep me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not save; nothing was changed')
    expect(box).toHaveValue('Keep me')
  })

  test('desktop history shows every entry and no full-history button', async () => {
    const entries = [1, 2, 3, 4, 5].map(note)
    stubApiWith({ recipes: [traybake], timeline: { entries, current_version: null } })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    await waitFor(() => expect(within(entriesList()).getAllByRole('listitem')).toHaveLength(5))
    expect(screen.queryByRole('button', { name: 'Show full history' })).not.toBeInTheDocument()
  })

  test('phone history shows three and a full-history button', async () => {
    stubViewport(false)
    const entries = [1, 2, 3, 4, 5].map(note)
    stubApiWith({ recipes: [traybake], timeline: { entries, current_version: null } })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    await waitFor(() => expect(within(entriesList()).getAllByRole('listitem')).toHaveLength(3))
    expect(within(entriesList()).getAllByRole('listitem')[0]).toHaveTextContent('Note number 1')
    fireEvent.click(screen.getByRole('button', { name: 'Show full history' }))
    expect(within(entriesList()).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: 'Show full history' })).not.toBeInTheDocument()
  })

  test('phone history with three entries or fewer has no full-history button', async () => {
    stubViewport(false)
    stubApiWith({ recipes: [traybake], timeline: { entries: [note(1), note(2), note(3)], current_version: null } })
    renderAt(TRAYBAKE_PATH)
    await loaded()
    await waitFor(() => expect(within(entriesList()).getAllByRole('listitem')).toHaveLength(3))
    expect(screen.queryByRole('button', { name: 'Show full history' })).not.toBeInTheDocument()
  })
})

describe('a drink and the bar', () => {
  type Shelf = BarState | null
  interface Shelves {
    rum: Shelf
    sec: Shelf
  }

  const ml = (amount: number, item: string, note = '') => ({
    amount,
    unit: 'ml' as const,
    item,
    note,
    no_scale: false,
    original: '',
    g_per_tsp: null,
  })
  const syrupLink = { slug: 'simple-syrup', name: 'Simple syrup' }

  /**
   * The daiquiri as the API sends it for these states: white rum and triple sec are bottles,
   * fresh lime juice and simple syrup (which has a recipe) are not tracked.
   */
  function cocktail({ rum, sec }: Shelves): Recipe {
    const shelf: [string, Shelf][] = [
      ['white rum', rum],
      ['triple sec', sec],
    ]
    const missing = shelf.filter(([, state]) => state === 'dont').map(([name]) => name)
    const unsorted = shelf.filter(([, state]) => state === null).map(([name]) => name)
    return {
      ...daiquiri,
      servings: 1,
      ingredients: [
        { ...ml(50, 'white rum'), bar: { item: 'white rum', state: rum, tracked: true, recipe: null } },
        { ...ml(25, 'lime juice'), bar: { item: 'lime juice', state: null, tracked: false, recipe: null } },
        { ...ml(15, 'triple sec'), bar: { item: 'triple sec', state: sec, tracked: true, recipe: null } },
        {
          ...ml(15, 'simple syrup', '1:1'),
          bar: { item: 'simple syrup', state: null, tracked: false, recipe: syrupLink },
        },
      ],
      bar: {
        status: missing.length ? 'missing' : unsorted.length ? 'unsorted' : 'can_make',
        missing,
        unsorted,
        untracked: ['lime juice', 'simple syrup'],
      },
    }
  }

  const simpleSyrup: Recipe = {
    ...daiquiri,
    slug: 'simple-syrup',
    name: 'Simple syrup',
    category: 'syrups',
    ingredients: [],
    bar: null,
  }

  function barOf({ rum, sec }: Shelves): Bar {
    const used_in = [{ slug: 'daiquiri', name: 'Daiquiri' }]
    return {
      items: [
        { name: 'white rum', aliases: [], kind: 'spirits', tracked: true, untracked_because: null, state: rum, used_in, recipe: null },
        { name: 'lime juice', aliases: [], kind: 'other', tracked: false, untracked_because: 'marked', state: null, used_in, recipe: null },
        { name: 'triple sec', aliases: [], kind: 'liqueurs', tracked: true, untracked_because: null, state: sec, used_in, recipe: null },
        { name: 'simple syrup', aliases: [], kind: 'syrups', tracked: false, untracked_because: 'recipe', state: null, used_in, recipe: syrupLink },
      ],
      set_up: true,
      counts: { can_make: 0, missing: 0, unsorted: 0, total: 1 },
    }
  }

  /**
   * A server that keeps the bar: a write changes it and the next recipe load shows it.
   * `refuse` answers every write with that sentence; `offline` rejects it, as fetch does with
   * no network; `reloadFails` fails the recipe load
   * after a write; `hold` gives a promise that keeps that write in flight until it resolves.
   */
  function stubBar(
    start: Shelves,
    options: {
      refuse?: string
      offline?: boolean
      reloadFails?: boolean
      hold?: () => Promise<void> | undefined
      timelineFails?: boolean
    } = {},
  ) {
    const shelves = { ...start }
    const recipes = [cocktail(shelves), simpleSyrup]
    const keys: Record<string, keyof Shelves> = { 'white rum': 'rum', 'triple sec': 'sec' }
    const inner = stubApiWith({
      recipes,
      post: async (url, body) => {
        expect(url).toBe('/api/bar')
        await options.hold?.()
        if (options.refuse) return json({ error: options.refuse }, 400)
        if (options.offline) throw new TypeError('Failed to fetch')
        const changes = body as BarChanges
        for (const name of changes.have ?? []) shelves[keys[name]] = 'have'
        for (const name of changes.dont_have ?? []) shelves[keys[name]] = 'dont'
        for (const name of changes.unsorted ?? []) shelves[keys[name]] = null
        recipes[0] = cocktail(shelves)
        return json(barOf(shelves))
      },
    })
    let wrote = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') wrote = true
        else if (options.timelineFails && url.endsWith('/timeline')) return json({ error: 'History is unavailable.' }, 503)
        else if (wrote && options.reloadFails && url === '/api/recipes/drinks/daiquiri') {
          return new Response('', { status: 500 })
        }
        return inner(url, init)
      }),
    )
    return inner
  }

  const open = () => {
    renderAt('/drinks/daiquiri')
    return screen.findByRole('heading', { level: 1, name: 'Daiquiri' })
  }
  const row = (item: string) => screen.getByText(item).closest('li')!
  const summaryLine = () => document.querySelector<HTMLElement>('.ingredients-bar')!

  test('shows the summary line', async () => {
    stubBar({ rum: 'have', sec: 'have' })
    await open()
    expect(summaryLine()).toHaveTextContent('From your bar: 2 of 2 bottles')
    expect(summaryLine()).toHaveTextContent('Also needs: lime juice, simple syrup')
    expect(summaryLine()).not.toHaveTextContent('Missing')
    cleanup()

    stubBar({ rum: 'have', sec: 'dont' })
    await open()
    expect(summaryLine()).toHaveTextContent('Missing: triple sec')
    expect(summaryLine()).toHaveTextContent('Also needs: lime juice, simple syrup')
    expect(summaryLine()).not.toHaveTextContent('From your bar')
  })

  test('unsorted counts as missing in the summary', async () => {
    stubBar({ rum: null, sec: 'dont' })
    await open()
    expect(summaryLine()).toHaveTextContent('Missing: white rum, triple sec')
    expect(within(row('white rum')).getByRole('button', { name: /White rum is not sorted yet/ })).toHaveTextContent(
      'Not sorted',
    )
  })

  test('flips a bottle and undoes it', async () => {
    const fetch = stubBar({ rum: 'have', sec: 'have' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: "Triple sec is in the bar. Click if you've run out." }))
    const flipped = await screen.findByRole('button', { name: 'Triple sec is not in the bar. Click when you have it.' })
    expect(flipped).toHaveTextContent('Not in the bar')
    expect(posts(fetch).map((p) => p.body)).toEqual([{ dont_have: ['triple sec'] }])
    // The page reloads the recipe, so the summary follows.
    expect(summaryLine()).toHaveTextContent('Missing: triple sec')
    const undo = within(row('triple sec')).getByRole('status')
    expect(undo).toHaveTextContent('Marked as not in the bar.')

    fireEvent.click(within(undo).getByRole('button', { name: 'Undo' }))
    expect(
      await screen.findByRole('button', { name: "Triple sec is in the bar. Click if you've run out." }),
    ).toHaveTextContent('In the bar')
    expect(posts(fetch).map((p) => p.body)).toEqual([{ dont_have: ['triple sec'] }, { have: ['triple sec'] }])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(summaryLine()).toHaveTextContent('From your bar: 2 of 2')
  })

  test('undo of an unsorted flip makes it unsorted again', async () => {
    const fetch = stubBar({ rum: null, sec: 'have' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'White rum is not sorted yet. Click when you have it.' }))
    await screen.findByRole('button', { name: "White rum is in the bar. Click if you've run out." })
    expect(within(row('white rum')).getByRole('status')).toHaveTextContent('Marked as in the bar.')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await screen.findByRole('button', { name: 'White rum is not sorted yet. Click when you have it.' })
    expect(posts(fetch).map((p) => p.body)).toEqual([{ have: ['white rum'] }, { unsorted: ['white rum'] }])
  })

  test('one undo at a time: a second flip moves it to that row', async () => {
    stubBar({ rum: 'have', sec: 'have' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: "Triple sec is in the bar. Click if you've run out." }))
    await within(row('triple sec')).findByRole('status')
    fireEvent.click(screen.getByRole('button', { name: "White rum is in the bar. Click if you've run out." }))
    await within(row('white rum')).findByRole('status')
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  test('a refused flip shows its sentence at that row and keeps the state', async () => {
    stubBar({ rum: 'have', sec: 'have' }, { refuse: "The bar can't be changed right now." })
    await open()
    fireEvent.click(screen.getByRole('button', { name: "Triple sec is in the bar. Click if you've run out." }))
    const alert = await within(row('triple sec')).findByRole('alert')
    expect(alert).toHaveTextContent("The bar can't be changed right now.")
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('button', { name: "Triple sec is in the bar. Click if you've run out." })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('a flip that never reached the server says so at that row', async () => {
    stubBar({ rum: 'have', sec: 'have' }, { offline: true })
    await open()
    fireEvent.click(screen.getByRole('button', { name: "Triple sec is in the bar. Click if you've run out." }))
    const alert = await within(row('triple sec')).findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't reach Lækkert. Nothing was changed.")
    expect(screen.getByRole('button', { name: "Triple sec is in the bar. Click if you've run out." })).toBeInTheDocument()
  })

  test('a tap while a flip is in flight waits, and the refusal shows at the first row', async () => {
    let release = () => {}
    const hold = new Promise<void>((resolve) => (release = resolve))
    const fetch = stubBar(
      { rum: 'have', sec: 'have' },
      { refuse: "The bar can't be changed right now.", hold: () => hold },
    )
    await open()
    const sec = screen.getByRole('button', { name: "Triple sec is in the bar. Click if you've run out." })
    const rum = screen.getByRole('button', { name: "White rum is in the bar. Click if you've run out." })
    fireEvent.click(sec)
    await waitFor(() => expect(rum).toHaveAttribute('aria-disabled', 'true'))
    expect(sec).toHaveAttribute('aria-disabled', 'true')
    expect(sec).toHaveAttribute('aria-busy', 'true')
    expect(rum).not.toHaveAttribute('aria-busy')
    fireEvent.click(rum)

    release()
    const alert = await within(row('triple sec')).findByRole('alert')
    expect(alert).toHaveTextContent("The bar can't be changed right now.")
    expect(within(row('white rum')).queryByRole('alert')).not.toBeInTheDocument()
    expect(posts(fetch).map((p) => p.body)).toEqual([{ dont_have: ['triple sec'] }])
    expect(rum).not.toHaveAttribute('aria-disabled')
    expect(sec).not.toHaveAttribute('aria-busy')
  })

  test('Undo waits while a write is in flight', async () => {
    let release = () => {}
    const hold = new Promise<void>((resolve) => (release = resolve))
    let writes = 0
    const fetch = stubBar({ rum: 'have', sec: 'have' }, { hold: () => (++writes === 2 ? hold : undefined) })
    await open()
    fireEvent.click(screen.getByRole('button', { name: "Triple sec is in the bar. Click if you've run out." }))
    const status = await within(row('triple sec')).findByRole('status')
    const undo = within(status).getByRole('button', { name: 'Undo' })
    expect(undo).not.toHaveAttribute('aria-disabled')
    fireEvent.click(screen.getByRole('button', { name: "White rum is in the bar. Click if you've run out." }))
    await waitFor(() => expect(undo).toHaveAttribute('aria-disabled', 'true'))
    fireEvent.click(undo)
    release()
    await within(row('white rum')).findByRole('status')
    expect(posts(fetch).map((p) => p.body)).toEqual([{ dont_have: ['triple sec'] }, { dont_have: ['white rum'] }])
  })

  test('a flip keeps a History problem, since the history is not reloaded', async () => {
    stubBar({ rum: 'have', sec: 'have' }, { timelineFails: true })
    await open()
    expect(await screen.findByText('History is unavailable.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "Triple sec is in the bar. Click if you've run out." }))
    await within(row('triple sec')).findByRole('status')
    expect(screen.getByText('History is unavailable.')).toBeInTheDocument()
  })

  test('a failed reload after a flip keeps the page and the new state', async () => {
    stubBar({ rum: 'have', sec: 'have' }, { reloadFails: true })
    await open()
    fireEvent.click(screen.getByRole('button', { name: "Triple sec is in the bar. Click if you've run out." }))
    await screen.findByRole('button', { name: 'Triple sec is not in the bar. Click when you have it.' })
    expect(screen.getByRole('heading', { level: 1, name: 'Daiquiri' })).toBeInTheDocument()
    expect(summaryLine()).toHaveTextContent('Missing: triple sec')
    expect(within(row('triple sec')).getByRole('status')).toHaveTextContent('Marked as not in the bar.')
  })

  test('untracked rows have no button and no state text', async () => {
    stubBar({ rum: 'have', sec: 'have' })
    await open()
    for (const name of ['lime juice', 'simple syrup']) {
      const untracked = row(name)
      expect(within(untracked).queryByRole('button')).not.toBeInTheDocument()
      expect(untracked).not.toHaveTextContent(/fresh|in the bar|buy/i)
    }
  })

  test('an untracked syrup links to its recipe, with the bar in any state', async () => {
    stubBar({ rum: 'have', sec: 'have' })
    await open()
    const link = within(row('simple syrup')).getByRole('link', { name: 'Recipe: Simple syrup' })
    expect(link).toHaveAttribute('href', '/drinks/simple-syrup')
    expect(within(row('white rum')).queryByRole('link')).not.toBeInTheDocument()
    expect(within(row('triple sec')).queryByRole('link')).not.toBeInTheDocument()
    cleanup()

    stubBar({ rum: 'dont', sec: 'dont' })
    await open()
    expect(screen.queryByText(/Out\? Make it/)).not.toBeInTheDocument()
    const again = within(row('simple syrup')).getByRole('link', { name: 'Recipe: Simple syrup' })
    fireEvent.click(again)
    expect(await screen.findByRole('heading', { level: 1, name: 'Simple syrup' })).toBeInTheDocument()
  })

  test('only bottles count in the summary', async () => {
    // The daiquiri with one bottle: lime juice and simple syrup are what else it needs.
    const full = cocktail({ rum: 'have', sec: 'have' })
    stubApi({ ...full, ingredients: full.ingredients.filter((ing) => ing.item !== 'triple sec') }, simpleSyrup)
    await open()
    expect(summaryLine()).toHaveTextContent('From your bar: 1 of 1 bottles')
    expect(summaryLine()).toHaveTextContent('Also needs: lime juice, simple syrup')
    expect(summaryLine().querySelector('.ingredients-bar-also svg')).not.toBeNull()
  })

  test('a syrup page has no summary and no state buttons', async () => {
    stubApi(
      {
        ...simpleSyrup,
        ingredients: [{ ...ml(500, 'sugar'), bar: null }, { ...ml(500, 'water'), bar: null }],
      },
    )
    renderAt('/drinks/simple-syrup')
    await screen.findByRole('heading', { level: 1, name: 'Simple syrup' })
    expect(screen.getByText('sugar')).toBeInTheDocument()
    expect(screen.queryByText(/From your bar|Missing:|Also needs/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /in the bar/i })).not.toBeInTheDocument()
  })

  test('a drink tag link shows all drinks with that tag', async () => {
    stubApi({ ...cocktail({ rum: 'have', sec: 'have' }), tags: ['classic'] })
    await open()
    expect(screen.getByRole('link', { name: 'classic' })).toHaveAttribute('href', '/drinks?tag=classic&show=all')
  })

  test('a syrup tag link shows syrups, since All drinks has none', async () => {
    stubApi({ ...simpleSyrup, tags: ['basic'] })
    renderAt('/drinks/simple-syrup')
    await screen.findByRole('heading', { level: 1, name: 'Simple syrup' })
    expect(screen.getByRole('link', { name: 'basic' })).toHaveAttribute('href', '/drinks?tag=basic&show=syrups')
  })

  test('a prep tag link shows syrups too', async () => {
    stubApi({ ...simpleSyrup, slug: 'lime-cordial-base', name: 'Lime base', category: 'prep', tags: ['basic'] })
    renderAt('/drinks/lime-cordial-base')
    await screen.findByRole('heading', { level: 1, name: 'Lime base' })
    expect(screen.getByRole('link', { name: 'basic' })).toHaveAttribute('href', '/drinks?tag=basic&show=syrups')
  })

  test('drinks stepper says drinks and stops at 12', async () => {
    stubBar({ rum: 'have', sec: 'have' })
    await open()
    const stepper = screen.getByRole('group', { name: 'Drinks to make' })
    expect(within(stepper).getByText('1 drink')).toBeInTheDocument()
    expect(within(stepper).getByRole('button', { name: 'Fewer' })).toBeDisabled()
    const more = within(stepper).getByRole('button', { name: 'More' })
    fireEvent.click(more)
    expect(within(stepper).getByText('2 drinks')).toBeInTheDocument()
    expect(within(row('white rum')).getByText('100 ml')).toBeInTheDocument()
    for (let i = 0; i < 20; i++) fireEvent.click(more)
    expect(within(stepper).getByText('12 drinks')).toBeInTheDocument()
    expect(more).toBeDisabled()
    expect(screen.queryByRole('group', { name: 'Servings' })).not.toBeInTheDocument()
  })

  test('on a phone the rows say Tap and use the short labels', async () => {
    stubViewport(false)
    stubBar({ rum: 'have', sec: 'dont' })
    await open()
    expect(screen.getByRole('button', { name: "White rum is in the bar. Tap if you've run out." })).toHaveTextContent(
      'In the bar',
    )
    expect(screen.getByRole('button', { name: 'Triple sec is not in the bar. Tap when you have it.' })).toHaveTextContent(
      'Not in bar',
    )
    expect(row('lime juice')).not.toHaveTextContent(/fresh/i)
    expect(within(row('lime juice')).queryByRole('button')).not.toBeInTheDocument()
  })
})
