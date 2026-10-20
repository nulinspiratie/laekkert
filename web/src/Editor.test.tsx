import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'
import type { Recipe } from './types'

const dal: Recipe = {
  format_version: 2,
  slug: 'dal',
  side: 'food',
  name: 'Red lentil dal',
  category: 'mains',
  servings: 4,
  time_minutes: 35,
  ingredients: [
    { amount: 250, unit: 'g', item: 'red lentils', note: 'rinsed', no_scale: false, original: '', group: '', g_per_tsp: null },
    { amount: null, unit: 'g', item: 'flour', note: '', no_scale: false, original: '1 cup', group: '', g_per_tsp: null },
    { amount: 1, unit: 'piece', item: 'onion', note: '', no_scale: true, original: '', group: '', g_per_tsp: null },
  ],
  steps: [
    { text: 'Cook the lentils.', group: '' },
    { text: 'Serve.', group: '' },
  ],
  notes: '',
  source: null,
  tags: ['weeknight'],
  marks: [],
  image: 'dal.jpg',
  rating: null,
  last_made: null,
  version: 3,
}

const daiquiri: Recipe = {
  ...dal,
  slug: 'daiquiri',
  side: 'drinks',
  name: 'Daiquiri',
  category: 'cocktails',
  servings: 1,
  tags: [],
  image: null,
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

/**
 * Answers recipe reads from `recipes` (anything else is a 404), the timeline, and hands
 * writes to `handlers` (an unlisted write is a 500).
 */
function stubApi(
  recipes: Recipe[],
  handlers: { create?: Handler; update?: Handler; remove?: Handler; upload?: Handler } = {},
) {
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const handler =
      method === 'POST' && url === '/api/recipes'
        ? handlers.create
        : method === 'POST' && url === '/api/uploads'
          ? handlers.upload
          : method === 'PUT'
            ? handlers.update
            : method === 'DELETE'
              ? handlers.remove
              : undefined
    if (method !== 'GET') return handler ? handler(url, init) : json({ error: 'no handler' }, 500)
    if (url.endsWith('/timeline')) return json({ entries: [], current_version: null })
    if (url.startsWith('/api/recipes?')) return json({ recipes: [] })
    const slug = decodeURIComponent(url.split('/').pop()!)
    const found = recipes.find((r) => r.slug === slug && url.includes(`/${r.side}/`))
    return found ? json(found) : json({ error: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** The JSON bodies of the writes a stubbed fetch received. */
function writes(fetch: ReturnType<typeof stubApi>, method: string, url?: string) {
  return fetch.mock.calls
    .filter(([u, init]) => init?.method === method && (url === undefined || u === url))
    .map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>)
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
  const { pathname } = useLocation()
  return <output aria-label="location">{pathname}</output>
}

/** The app in a data router (the editor's blocker needs one); `history` is the entries before `path`. */
function renderAt(path: string, history: string[] = []) {
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
    { initialEntries: [...history, path], initialIndex: history.length },
  )
  return { ...render(<RouterProvider router={router} />), router }
}

const location = () => screen.getByLabelText('location').textContent

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

const save = () => screen.getByRole('button', { name: 'Save' })

/** Fills the smallest recipe the form accepts. */
function fillNew() {
  type('Name', 'Soup')
  type('Amount for ingredient 1', '2')
  type('Ingredient 1', 'salt')
}

async function editing(recipe = dal) {
  renderAt(`/${recipe.side}/${recipe.slug}/edit`)
  return screen.findByLabelText('Name')
}

beforeEach(() => {
  stubViewport(true)
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  // @ts-expect-error: removing what beforeEach added.
  delete URL.createObjectURL
  // @ts-expect-error: removing what beforeEach added.
  delete URL.revokeObjectURL
})

test('new recipe posts the draft and opens it', async () => {
  const fetch = stubApi([{ ...dal, slug: 'soup', name: 'Soup' }], {
    create: () => json({ ...dal, slug: 'soup', name: 'Soup' }, 201),
  })
  renderAt('/food/new')
  expect(screen.getByRole('heading', { name: 'New recipe' })).toBeInTheDocument()
  fillNew()
  type('Cooking time', '20')
  type('Servings', '2')
  fireEvent.click(screen.getByRole('button', { name: 'Add step' }))
  type('Step 1', '  Boil.  ')
  fireEvent.click(save())

  await waitFor(() => expect(location()).toBe('/food/soup'))
  expect(writes(fetch, 'POST', '/api/recipes')).toEqual([
    {
      side: 'food',
      name: 'Soup',
      category: 'mains',
      servings: 2,
      time_minutes: 20,
      ingredients: [{ amount: 2, unit: 'g', item: 'salt', note: '', no_scale: false, original: '', group: '' }],
      steps: [{ text: 'Boil.', group: '' }],
      notes: '',
      source: null,
      tags: [],
      image: null,
    },
  ])
  expect(await screen.findByRole('heading', { level: 1, name: 'Soup' })).toBeInTheDocument()
})

test('edit loads the recipe into the form', async () => {
  const fetch = stubApi([dal])
  await editing()
  expect(screen.getByRole('heading', { name: 'Edit recipe' })).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/recipes/food/dal')
  expect(screen.getByLabelText('Name')).toHaveValue('Red lentil dal')
  expect(screen.getByLabelText('Category')).toHaveValue('mains')
  expect(screen.getByLabelText('Cooking time')).toHaveValue(35)
  expect(screen.getByLabelText('Servings')).toHaveValue(4)
  expect(screen.getByLabelText('Amount for ingredient 1')).toHaveValue('250')
  expect(screen.getByLabelText('Unit for ingredient 1')).toHaveValue('g')
  expect(screen.getByLabelText('Ingredient 1')).toHaveValue('red lentils')
  expect(screen.getByLabelText('Note for ingredient 1')).toHaveValue('rinsed')
  expect(screen.getByLabelText('Step 2')).toHaveValue('Serve.')
  expect(screen.getByRole('button', { name: 'Remove tag weeknight' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Photo preview' })).toHaveAttribute(
    'src',
    '/api/recipes/food/dal/files/dal.jpg',
  )
  expect(screen.getByRole('button', { name: 'Delete recipe' })).toBeInTheDocument()
  // Nothing changed, so nothing to discard.
  const confirm = vi.spyOn(window, 'confirm')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(confirm).not.toHaveBeenCalled()
  expect(location()).toBe('/food/dal')
})

test('saving an edit puts the draft to the recipe and returns to it', async () => {
  const fetch = stubApi([dal], { update: () => json(dal) })
  await editing()
  type('Name', 'Dal')
  fireEvent.click(save())
  await waitFor(() => expect(location()).toBe('/food/dal'))
  const [body] = writes(fetch, 'PUT')
  expect(body).toMatchObject({ name: 'Dal', image: 'dal.jpg', tags: ['weeknight'] })
  expect(body).not.toHaveProperty('side')
  expect(fetch.mock.calls.find(([, init]) => init?.method === 'PUT')![0]).toBe('/api/recipes/food/dal')
})

test('saving sends the version it opened', async () => {
  const fetch = stubApi([dal], { update: () => json(dal) })
  await editing()
  type('Name', 'Dal')
  fireEvent.click(save())
  await waitFor(() => expect(location()).toBe('/food/dal'))
  expect(writes(fetch, 'PUT')[0]).toHaveProperty('base_version', 3)
})

test('a 409 shows the sentence and keeps the edits', async () => {
  const sentence = 'This recipe was changed somewhere else since you opened it; reload it to see the change'
  stubApi([dal], { update: () => json({ error: sentence }, 409) })
  await editing()
  type('Name', 'Dal supreme')
  fireEvent.click(save())
  expect(await screen.findByRole('alert')).toHaveTextContent(sentence)
  expect(location()).toBe('/food/dal/edit')
  expect(screen.getByLabelText('Name')).toHaveValue('Dal supreme')
  expect(save()).toBeEnabled()
})

test('the side cannot be changed once the recipe exists', async () => {
  stubApi([dal])
  await editing()
  expect(screen.queryByLabelText('Side')).not.toBeInTheDocument()
  expect(screen.queryByRole('radio', { name: 'Drinks' })).not.toBeInTheDocument()
})

test('tsp row is sent as tsp', async () => {
  const fetch = stubApi([], { create: () => json({ ...dal, slug: 'soup' }, 201) })
  renderAt('/food/new')
  fillNew()
  type('Unit for ingredient 1', 'tsp')
  type('Amount for ingredient 1', '1½')
  fireEvent.click(save())
  await waitFor(() => expect(location()).toBe('/food/soup'))
  const [body] = writes(fetch, 'POST', '/api/recipes')
  expect(body.ingredients).toEqual([{ amount: 1.5, unit: 'tsp', item: 'salt', note: '', no_scale: false, original: '', group: '' }])
})

test('a number box with unreadable text is an error, not a blank', async () => {
  const fetch = stubApi([])
  renderAt('/food/new')
  fillNew()
  const time = screen.getByLabelText('Cooking time')
  // jsdom does not model a number box holding text the browser cannot read.
  Object.defineProperty(time, 'validity', { value: { badInput: true } })
  fireEvent.click(save())
  expect(await screen.findByRole('alert')).toHaveTextContent('Cooking time must be a whole number of minutes')
  expect(writes(fetch, 'POST')).toEqual([])
})

test('the form catches problems before asking the server', async () => {
  const fetch = stubApi([])
  renderAt('/food/new')
  fireEvent.click(save())
  const alert = await screen.findByRole('alert')
  expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    'Give the recipe a name',
    'Add at least one ingredient',
  ])
  expect(writes(fetch, 'POST')).toEqual([])
})

test('cancel with changes asks first', async () => {
  stubApi([])
  renderAt('/food/new')
  type('Name', 'Soup')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(confirm).toHaveBeenCalledWith('Discard your changes?')
  expect(location()).toBe('/food/new')
  expect(screen.getByLabelText('Name')).toHaveValue('Soup')

  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(location()).toBe('/food'))
})

test('cancel asks once, not again when the editor is left', async () => {
  stubApi([])
  renderAt('/food/new')
  type('Name', 'Soup')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(location()).toBe('/food'))
  expect(confirm).toHaveBeenCalledTimes(1)
})

test('back with changes asks first', async () => {
  stubApi([dal])
  const { router } = renderAt('/food/dal/edit', ['/food/dal'])
  await screen.findByLabelText('Name')
  type('Name', 'Dal')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await act(async () => {
    await router.navigate(-1)
  })
  expect(confirm).toHaveBeenCalledWith('Discard your changes?')
  expect(location()).toBe('/food/dal/edit')
  expect(screen.getByLabelText('Name')).toHaveValue('Dal')

  confirm.mockReturnValue(true)
  await act(async () => {
    await router.navigate(-1)
  })
  await waitFor(() => expect(location()).toBe('/food/dal'))
})

test('back on a clean form does not ask', async () => {
  stubApi([dal])
  const { router } = renderAt('/food/dal/edit', ['/food/dal'])
  await screen.findByLabelText('Name')
  const confirm = vi.spyOn(window, 'confirm')
  await act(async () => {
    await router.navigate(-1)
  })
  expect(confirm).not.toHaveBeenCalled()
  expect(location()).toBe('/food/dal')
})

test('the header links ask first when there are changes', async () => {
  stubApi([])
  renderAt('/food/new')
  type('Name', 'Soup')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('link', { name: 'Drinks' }))
  await waitFor(() => expect(confirm).toHaveBeenCalledWith('Discard your changes?'))
  expect(location()).toBe('/food/new')
  expect(screen.getByLabelText('Name')).toHaveValue('Soup')

  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('link', { name: 'Drinks' }))
  await waitFor(() => expect(location()).toBe('/drinks'))
})

test('save does not ask about discarding', async () => {
  stubApi([], { create: () => json({ ...dal, slug: 'soup' }, 201) })
  renderAt('/food/new')
  fillNew()
  const confirm = vi.spyOn(window, 'confirm')
  fireEvent.click(save())
  await waitFor(() => expect(location()).toBe('/food/soup'))
  expect(confirm).not.toHaveBeenCalled()
})

test('cancel on a clean form does not ask', async () => {
  stubApi([])
  renderAt('/drinks/new')
  const confirm = vi.spyOn(window, 'confirm')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(confirm).not.toHaveBeenCalled()
  await waitFor(() => expect(location()).toBe('/drinks'))
})

test('a reload or tab close with changes asks first, and not after saving', async () => {
  stubApi([], { create: () => json({ ...dal, slug: 'soup' }, 201) })
  renderAt('/food/new')
  const leave = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  expect(leave()).toBe(false)
  fillNew()
  expect(leave()).toBe(true)
  fireEvent.click(save())
  await waitFor(() => expect(location()).toBe('/food/soup'))
  expect(leave()).toBe(false)
})

test('failed save keeps the form and shows the error', async () => {
  const fetch = stubApi([], { create: () => json({ error: 'could not save; nothing was changed' }, 503) })
  renderAt('/food/new')
  fillNew()
  fireEvent.click(save())
  expect(await screen.findByRole('alert')).toHaveTextContent('could not save; nothing was changed')
  expect(location()).toBe('/food/new')
  expect(screen.getByLabelText('Name')).toHaveValue('Soup')
  expect(screen.getByLabelText('Ingredient 1')).toHaveValue('salt')
  expect(save()).toBeEnabled()
  // Trying again sends it again.
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'POST', '/api/recipes')).toHaveLength(2))
})

test('save sends one request on double tap', async () => {
  let finish!: (response: Response) => void
  const fetch = stubApi([], {
    create: () => new Promise<Response>((resolve) => (finish = resolve)),
  })
  renderAt('/food/new')
  fillNew()
  fireEvent.click(save())
  fireEvent.click(save())
  expect(save()).toBeDisabled()
  expect(writes(fetch, 'POST', '/api/recipes')).toHaveLength(1)
  await act(async () => finish(json({ ...dal, slug: 'soup' }, 201)))
  await waitFor(() => expect(location()).toBe('/food/soup'))
  expect(writes(fetch, 'POST', '/api/recipes')).toHaveLength(1)
})

const photo = () => new File([new Uint8Array([1, 2, 3])], 'dish.jpg', { type: 'image/jpeg' })

test('picking a photo uploads it and saves its name', async () => {
  let finish!: (response: Response) => void
  const fetch = stubApi([], {
    upload: () => new Promise<Response>((resolve) => (finish = resolve)),
    create: () => json({ ...dal, slug: 'soup' }, 201),
  })
  renderAt('/food/new')
  fillNew()
  const input = screen.getByLabelText('Add photo')
  expect(input).toHaveAttribute(
    'accept',
    'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif',
  )
  fireEvent.change(input, { target: { files: [photo()] } })

  // The preview shows at once; Save waits for the upload so the draft has the name.
  expect(await screen.findByText('Uploading…')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Photo preview' })).toHaveAttribute('src', 'blob:preview')
  expect(save()).toBeDisabled()

  await act(async () => finish(json({ name: 'up123.jpg' }, 201)))
  expect(screen.queryByText('Uploading…')).not.toBeInTheDocument()
  expect(save()).toBeEnabled()
  expect(screen.getByRole('img', { name: 'Photo preview' })).toHaveAttribute('src', 'blob:preview')
  const [upload] = fetch.mock.calls.filter(([url]) => url === '/api/uploads')
  expect(new Headers(upload[1]?.headers).get('Content-Type')).toBe('image/jpeg')

  fireEvent.click(save())
  await waitFor(() => expect(location()).toBe('/food/soup'))
  expect(writes(fetch, 'POST', '/api/recipes')[0]).toMatchObject({ image: 'up123.jpg' })
})

test('a failed upload shows its error and keeps the previous photo', async () => {
  stubApi([dal], { upload: () => json({ error: 'That file is not a picture we can use' }, 415) })
  await editing()
  fireEvent.change(screen.getByLabelText('Replace photo'), { target: { files: [photo()] } })
  expect(await screen.findByRole('alert')).toHaveTextContent('That file is not a picture we can use')
  expect(screen.getByRole('img', { name: 'Photo preview' })).toHaveAttribute(
    'src',
    '/api/recipes/food/dal/files/dal.jpg',
  )
  expect(save()).toBeEnabled()
})

test('replaced and left-behind previews are released', async () => {
  const urls = ['blob:one', 'blob:two']
  URL.createObjectURL = vi.fn(() => urls.shift()!)
  stubApi([], { upload: () => json({ name: 'up.jpg' }, 201) })
  const { unmount } = renderAt('/food/new')
  fireEvent.change(screen.getByLabelText('Add photo'), { target: { files: [photo()] } })
  await waitFor(() => expect(screen.queryByText('Uploading…')).not.toBeInTheDocument())
  fireEvent.change(screen.getByLabelText('Replace photo'), { target: { files: [photo()] } })
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one'))
  await waitFor(() => expect(screen.queryByText('Uploading…')).not.toBeInTheDocument())
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:two')
})

test('removing the photo saves no image', async () => {
  const fetch = stubApi([dal], { update: () => json(dal) })
  await editing()
  fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
  expect(screen.queryByRole('img', { name: 'Photo preview' })).not.toBeInTheDocument()
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  expect(writes(fetch, 'PUT')[0]).toMatchObject({ image: null })
})

test('the source is a link, a photo or none, and only that one is sent', async () => {
  const fetch = stubApi([dal], { update: () => json(dal) })
  await editing()
  const radios = within(screen.getByRole('radiogroup', { name: 'Source type' })).getAllByRole('radio')
  expect(radios.map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
    ['Link', 'false'],
    ['Photo', 'false'],
    ['None', 'true'],
  ])
  fireEvent.click(screen.getByRole('radio', { name: 'Link' }))
  type('Source link', 'example.com')
  fireEvent.click(save())
  expect(await screen.findByRole('alert')).toHaveTextContent('The source link must start with http:// or https://')
  expect(writes(fetch, 'PUT')).toEqual([])

  type('Source link', 'https://example.com/dal')
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  expect(writes(fetch, 'PUT')[0]).toMatchObject({ source: { url: 'https://example.com/dal', photo: null } })
})

test('a source photo is uploaded and sent as the photo', async () => {
  const fetch = stubApi([dal], { update: () => json(dal), upload: () => json({ name: 'page.jpg' }, 201) })
  await editing()
  fireEvent.click(screen.getByRole('radio', { name: 'Photo' }))
  fireEvent.change(screen.getByLabelText('Add source photo'), { target: { files: [photo()] } })
  await waitFor(() => expect(screen.getByRole('img', { name: 'Source photo' })).toBeInTheDocument())
  await waitFor(() => expect(save()).toBeEnabled())
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  expect(writes(fetch, 'PUT')[0]).toMatchObject({ source: { url: null, photo: 'page.jpg' } })
})

test('rows move, remove, and toggle Don’t scale', async () => {
  const fetch = stubApi([dal], { update: () => json(dal) })
  await editing()
  const items = () => screen.getAllByLabelText(/^Ingredient \d$/).map((el) => (el as HTMLInputElement).value)
  expect(items()).toEqual(['red lentils', 'flour', 'onion'])
  expect(screen.getByRole('button', { name: 'Move ingredient 1 up' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Move ingredient 3 down' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Move ingredient 3 up' }))
  expect(items()).toEqual(['red lentils', 'onion', 'flour'])
  fireEvent.click(screen.getByRole('button', { name: 'Move ingredient 1 down' }))
  expect(items()).toEqual(['onion', 'red lentils', 'flour'])
  fireEvent.click(screen.getByRole('button', { name: 'Remove ingredient 2' }))
  expect(items()).toEqual(['onion', 'flour'])

  // The onion starts as Don't scale.
  const toggle = screen.getByRole('button', { name: "Don't scale ingredient 1" })
  expect(toggle).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-pressed', 'false')

  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  const ingredients = writes(fetch, 'PUT')[0].ingredients as { item: string; no_scale: boolean }[]
  expect(ingredients.map((i) => [i.item, i.no_scale])).toEqual([
    ['onion', false],
    ['flour', false],
  ])
})

test('steps move and remove', async () => {
  const fetch = stubApi([dal], { update: () => json(dal) })
  await editing()
  fireEvent.click(screen.getByRole('button', { name: 'Move step 2 up' }))
  expect(screen.getByLabelText('Step 1')).toHaveValue('Serve.')
  fireEvent.click(screen.getByRole('button', { name: 'Remove step 2' }))
  expect(screen.queryByLabelText('Step 2')).not.toBeInTheDocument()
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  expect(writes(fetch, 'PUT')[0].steps).toEqual([{ text: 'Serve.', group: '' }])
})

test('a row stored as written shows it and keeps it', async () => {
  const fetch = stubApi([dal], { update: () => json(dal) })
  await editing()
  expect(screen.getByText('As written: 1 cup')).toBeInTheDocument()
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  expect((writes(fetch, 'PUT')[0].ingredients as unknown[])[1]).toMatchObject({ amount: null, original: '1 cup', group: '' })
})

test('typing an amount on a row stored as written replaces it', async () => {
  const fetch = stubApi([dal], { update: () => json(dal) })
  await editing()
  type('Amount for ingredient 2', '120')
  expect(screen.queryByText('As written: 1 cup')).not.toBeInTheDocument()
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  expect((writes(fetch, 'PUT')[0].ingredients as unknown[])[1]).toMatchObject({ amount: 120, original: '', group: '' })
})

test('tags are added with Enter or the button, lower-cased, without repeats', async () => {
  const fetch = stubApi([dal], { update: () => json(dal) })
  await editing()
  const input = screen.getByLabelText('Add a tag')
  fireEvent.change(input, { target: { value: ' Batch Cook ' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(input).toHaveValue('')
  fireEvent.change(input, { target: { value: 'weeknight' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove tag weeknight' }))
  fireEvent.change(input, { target: { value: 'quick' } })
  // A tag typed but not added is not lost on Save.
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  // weeknight was already there (the repeat is ignored), then removed.
  expect(writes(fetch, 'PUT')[0].tags).toEqual(['batch cook', 'quick'])
})

test('delete asks then goes to the list', async () => {
  const fetch = stubApi([dal], { remove: () => new Response(null, { status: 204 }) })
  await editing()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  expect(confirm).toHaveBeenCalledWith('Delete “Red lentil dal”? It moves to the trash on the NAS.')
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  expect(location()).toBe('/food/dal/edit')

  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  await waitFor(() => expect(location()).toBe('/food'))
  expect(fetch.mock.calls.find(([, init]) => init?.method === 'DELETE')![0]).toBe('/api/recipes/food/dal')
})

test('delete replaces the edit page in the history', async () => {
  stubApi([dal], { remove: () => new Response(null, { status: 204 }) })
  const { router } = renderAt('/food/dal/edit', ['/food/dal'])
  await screen.findByLabelText('Name')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  await waitFor(() => expect(location()).toBe('/food'))
  // Only the delete confirm: leaving after it is clean. Back must not land on the deleted recipe.
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(router.state.historyAction).toBe('REPLACE')
  await act(async () => {
    await router.navigate(-1)
  })
  expect(location()).toBe('/food/dal')
})

test('a failed delete stays on the form with the error', async () => {
  stubApi([dal], { remove: () => json({ error: 'could not save; nothing was changed' }, 503) })
  await editing()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('could not save; nothing was changed')
  expect(location()).toBe('/food/dal/edit')
})

test('new recipes have no Delete', () => {
  stubApi([])
  renderAt('/food/new')
  expect(screen.queryByRole('button', { name: 'Delete recipe' })).not.toBeInTheDocument()
})

test('phone layout has the bottom bar', async () => {
  stubViewport(false)
  stubApi([])
  renderAt('/food/new')
  const bar = screen.getByRole('group', { name: 'Cancel or save' })
  expect(within(bar).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  expect(within(bar).getByRole('button', { name: 'Save' })).toBeInTheDocument()
  // One column in the brief's order.
  expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label') ?? r.querySelector('h2')!.textContent)).toEqual([
    'Basics',
    'Photo',
    'Ingredients',
    'Steps',
    'Source',
    'Tags',
  ])
})

test('on a phone each ingredient card starts with its name, then the amount', () => {
  stubViewport(false)
  stubApi([])
  renderAt('/food/new')
  const row = screen.getByLabelText('Ingredient 1').closest('li')!
  const order = Array.from(row.querySelectorAll('input, select, button')).map((el) => el.getAttribute('aria-label'))
  expect(order.slice(0, 4)).toEqual(['Ingredient 1', 'Amount for ingredient 1', 'Unit for ingredient 1', 'Note for ingredient 1'])
})

test('desktop layout has Cancel and Save in the header, and the aside beside the main column', () => {
  stubApi([])
  renderAt('/food/new')
  expect(screen.queryByRole('group', { name: 'Cancel or save' })).not.toBeInTheDocument()
  const aside = screen.getByRole('complementary')
  expect(within(aside).getByRole('region', { name: 'Photo' })).toBeInTheDocument()
  expect(within(aside).getByRole('region', { name: 'Source' })).toBeInTheDocument()
  expect(within(aside).getByRole('region', { name: 'Tags' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Ingredients' })).toBeInTheDocument()
  expect(within(aside).queryByRole('region', { name: 'Ingredients' })).not.toBeInTheDocument()
  expect(save()).toBeInTheDocument()
})

test('drinks editor uses the drinks theme', async () => {
  stubApi([daiquiri])
  const { container } = renderAt('/drinks/new')
  expect(container.querySelector('[data-side="drinks"]')).toBeInTheDocument()
  expect(screen.getByLabelText('Category')).toHaveValue('cocktails')
  expect(screen.getByLabelText('Servings')).toHaveValue(1)
  expect(within(screen.getByLabelText('Category')).getAllByRole('option').map((o) => o.textContent)).toEqual([
    'Cocktails',
    'Mocktails',
    'Syrups',
    'Prep',
  ])
})

test('an unknown recipe shows not found', async () => {
  stubApi([])
  renderAt('/food/nothing/edit')
  expect(await screen.findByText('Not found')).toBeInTheDocument()
  expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
})

test('an invalid side shows not found', () => {
  stubApi([])
  renderAt('/soup/new')
  expect(screen.getByText('Not found')).toBeInTheDocument()
})

test('/:side/new is the editor, not a recipe called new', () => {
  const fetch = stubApi([])
  renderAt('/food/new')
  expect(screen.getByRole('heading', { name: 'New recipe' })).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalledWith('/api/recipes/food/new')
})

// ---- Groups and notes ----

const stew: Recipe = {
  ...dal,
  slug: 'stew',
  name: 'Stew',
  ingredients: [
    { amount: 500, unit: 'g', item: 'beef', note: '', no_scale: false, original: '', group: 'Meat', g_per_tsp: null },
    { amount: 2, unit: 'piece', item: 'onion', note: '', no_scale: true, original: '', group: 'Meat', g_per_tsp: null },
    { amount: 5, unit: 'g', item: 'salt', note: '', no_scale: false, original: '', group: '', g_per_tsp: null },
    { amount: 200, unit: 'ml', item: 'stock', note: 'hot', no_scale: false, original: '', group: 'Sauce', g_per_tsp: null },
  ],
  steps: [
    { text: 'Brown the meat.', group: 'Meat' },
    { text: 'Season.', group: '' },
    { text: 'Simmer.', group: 'Sauce' },
  ],
  notes: 'Better the next day.\n\n- freezes well',
}

const ingredientsCard = () => within(screen.getByRole('region', { name: 'Ingredients' }))

const shown = (label: string | RegExp) =>
  screen.getAllByLabelText(label).map((el) => (el as HTMLInputElement).value)

test('a loaded grouped recipe shows headings with their names, numbering rows only', async () => {
  stubApi([stew])
  await editing(stew)
  expect(shown('Group name')).toEqual(['Meat', '', 'Sauce', 'Meat', '', 'Sauce'])
  // The first entry is a heading, and the first row is still Ingredient 1.
  expect(shown(/^Ingredient \d$/)).toEqual(['beef', 'onion', 'salt', 'stock'])
  expect(screen.getByLabelText('Ingredient 1')).toHaveValue('beef')
  expect(screen.getByLabelText('Step 3')).toHaveValue('Simmer.')
  screen.getAllByLabelText('Group name').forEach((el) => expect(el).toHaveAttribute('placeholder', 'Group name (none)'))
})

test('saving a grouped recipe unchanged sends its ingredients, steps and notes as they were', async () => {
  const fetch = stubApi([stew], { update: () => json(stew) })
  await editing(stew)
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  const body = writes(fetch, 'PUT')[0]
  expect(body.ingredients).toEqual(stew.ingredients.map(({ g_per_tsp: _g, ...ing }) => ing))
  expect(body.steps).toEqual(stew.steps)
  expect(body.notes).toBe(stew.notes)
})

test('Add group under the ingredients focuses a blank heading with one blank row after it', async () => {
  const fetch = stubApi([], { create: () => json({ ...dal, slug: 'soup', name: 'Soup' }, 201) })
  renderAt('/food/new')
  type('Name', 'Soup')
  type('Amount for ingredient 1', '2')
  type('Ingredient 1', 'salt')
  fireEvent.click(screen.getAllByRole('button', { name: 'Add group' })[0])
  // Steps have their own Add group; the first button belongs to the ingredients.
  const heading = screen.getAllByLabelText('Group name')[0]
  expect(heading).toHaveFocus()
  expect(heading).toHaveValue('')
  expect(screen.getAllByLabelText(/^Ingredient \d$/)).toHaveLength(2)
  fireEvent.change(heading, { target: { value: 'Sauce' } })
  type('Amount for ingredient 2', '3')
  type('Ingredient 2', 'tomato')
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'POST', '/api/recipes')).toHaveLength(1))
  const ingredients = writes(fetch, 'POST', '/api/recipes')[0].ingredients as { item: string; group: string }[]
  expect(ingredients.map((i) => [i.item, i.group])).toEqual([
    ['salt', ''],
    ['tomato', 'Sauce'],
  ])
})

test('Add group under the steps does the same for steps', async () => {
  const fetch = stubApi([], { create: () => json({ ...dal, slug: 'soup', name: 'Soup' }, 201) })
  renderAt('/food/new')
  fillNew()
  type('Step 1', 'Boil.')
  const adders = screen.getAllByRole('button', { name: 'Add group' })
  expect(adders).toHaveLength(2)
  fireEvent.click(adders[1])
  const heading = screen.getByLabelText('Group name')
  expect(heading).toHaveFocus()
  expect(screen.getAllByLabelText(/^Step \d$/)).toHaveLength(2)
  fireEvent.change(heading, { target: { value: 'Serve' } })
  type('Step 2', 'Plate.')
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'POST', '/api/recipes')).toHaveLength(1))
  expect(writes(fetch, 'POST', '/api/recipes')[0].steps).toEqual([
    { text: 'Boil.', group: '' },
    { text: 'Plate.', group: 'Serve' },
  ])
})

test('moving a heading up past a row puts that row in the heading’s group', async () => {
  const fetch = stubApi([stew], { update: () => json(stew) })
  await editing(stew)
  // Entries: [Meat] beef onion [none] salt [Sauce] stock. Moving "Sauce" up past salt.
  fireEvent.click(ingredientsCard().getByRole('button', { name: 'Move group Sauce up' }))
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  const ingredients = writes(fetch, 'PUT')[0].ingredients as { item: string; group: string }[]
  expect(ingredients.map((i) => [i.item, i.group])).toEqual([
    ['beef', 'Meat'],
    ['onion', 'Meat'],
    ['salt', 'Sauce'],
    ['stock', 'Sauce'],
  ])
})

test('moving a heading down past a row moves that row out of the group', async () => {
  const fetch = stubApi([stew], { update: () => json(stew) })
  await editing(stew)
  // The blank heading before salt moves below it, so salt joins Meat.
  fireEvent.click(ingredientsCard().getByRole('button', { name: 'Move group down' }))
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  const ingredients = writes(fetch, 'PUT')[0].ingredients as { item: string; group: string }[]
  expect(ingredients.map((i) => [i.item, i.group])).toEqual([
    ['beef', 'Meat'],
    ['onion', 'Meat'],
    ['salt', 'Meat'],
    ['stock', 'Sauce'],
  ])
})

test('the first heading cannot move up and the last entry cannot move down', async () => {
  stubApi([stew])
  await editing(stew)
  expect(ingredientsCard().getByRole('button', { name: 'Move group Meat up' })).toBeDisabled()
  // The last ingredient entry is the stock row.
  expect(screen.getByRole('button', { name: 'Move ingredient 4 down' })).toBeDisabled()
  // A heading in the middle is free to move either way.
  expect(ingredientsCard().getByRole('button', { name: 'Move group down' })).toBeEnabled()
})

test('removing a heading merges its rows into the group above', async () => {
  const fetch = stubApi([stew], { update: () => json(stew) })
  await editing(stew)
  fireEvent.click(ingredientsCard().getByRole('button', { name: 'Remove group Sauce' }))
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  const body = writes(fetch, 'PUT')[0]
  expect((body.ingredients as { group: string }[]).map((i) => i.group)).toEqual(['Meat', 'Meat', '', ''])
  expect((body.steps as { group: string }[]).map((s) => s.group)).toEqual(['Meat', '', 'Sauce'])
})

test('Add ingredient adds after the last entry, headings included', async () => {
  stubApi([stew])
  await editing(stew)
  fireEvent.click(screen.getByRole('button', { name: 'Add ingredient' }))
  expect(screen.getAllByLabelText(/^Ingredient \d$/)).toHaveLength(5)
  expect(screen.getByRole('button', { name: 'Move ingredient 5 down' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Move ingredient 4 down' })).toBeEnabled()
})

function notesBox() {
  return screen.getByLabelText('Notes') as HTMLTextAreaElement
}

test('Italic wraps the selected text and keeps it selected, with focus in the box', async () => {
  await stubAndEdit()
  const notes = notesBox()
  fireEvent.change(notes, { target: { value: 'a soft b' } })
  notes.setSelectionRange(2, 6)
  fireEvent.click(screen.getByRole('button', { name: 'Italic' }))
  expect(notes).toHaveValue('a *soft* b')
  expect(notes).toHaveFocus()
  expect([notes.selectionStart, notes.selectionEnd]).toEqual([3, 7])
})

test('Bold wraps the selected text in two asterisks', async () => {
  await stubAndEdit()
  const notes = notesBox()
  fireEvent.change(notes, { target: { value: 'a soft b' } })
  notes.setSelectionRange(2, 6)
  fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
  expect(notes).toHaveValue('a **soft** b')
  expect([notes.selectionStart, notes.selectionEnd]).toEqual([4, 8])
})

test('Bold with nothing selected puts the caret between the pair', async () => {
  await stubAndEdit()
  const notes = notesBox()
  fireEvent.change(notes, { target: { value: 'ab' } })
  notes.setSelectionRange(1, 1)
  fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
  expect(notes).toHaveValue('a****b')
  expect([notes.selectionStart, notes.selectionEnd]).toEqual([3, 3])
})

test('List puts a bullet on every selected line and takes them off again', async () => {
  await stubAndEdit()
  const notes = notesBox()
  fireEvent.change(notes, { target: { value: 'one\ntwo' } })
  notes.setSelectionRange(0, 7)
  fireEvent.click(screen.getByRole('button', { name: 'List' }))
  expect(notes).toHaveValue('- one\n- two')
  expect([notes.selectionStart, notes.selectionEnd]).toEqual([0, 11])
  fireEvent.click(screen.getByRole('button', { name: 'List' }))
  expect(notes).toHaveValue('one\ntwo')
})

test('the notes toolbar is labelled and its buttons are text', async () => {
  await stubAndEdit()
  const bar = screen.getByRole('toolbar', { name: 'Notes formatting' })
  expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Bold', 'Italic', 'List'])
  expect(notesBox()).toHaveAttribute('rows', '6')
  expect(
    screen.getByText('New lines are kept. **bold**, *italic*, and - at the start of a line for a bullet.'),
  ).toBeInTheDocument()
})

test('notes are saved, and an edit to them counts as a change', async () => {
  const fetch = stubApi([dal], { update: () => json(dal) })
  await editing()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.change(notesBox(), { target: { value: 'Keeps.\n\n- a\n- b' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(confirm).toHaveBeenCalled()
  fireEvent.click(save())
  await waitFor(() => expect(writes(fetch, 'PUT')).toHaveLength(1))
  expect(writes(fetch, 'PUT')[0].notes).toBe('Keeps.\n\n- a\n- b')
})

async function stubAndEdit() {
  stubApi([dal], { update: () => json(dal) })
  await editing()
}
