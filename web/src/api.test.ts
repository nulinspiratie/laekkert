import { afterEach, expect, test, vi } from 'vitest'
import {
  ApiError,
  addEntry,
  createRecipe,
  deleteRecipe,
  getTimeline,
  restoreVersion,
  setMarks,
  updateRecipe,
  uploadImage,
} from './api'
import type { RecipeDraft } from './types'

const draft: RecipeDraft = {
  name: 'Daiquiri',
  category: 'cocktails',
  servings: 1,
  time_minutes: 5,
  ingredients: [{ amount: 2, unit: 'tsp', item: 'sugar', note: '', no_scale: false, original: '' }],
  steps: ['Shake.'],
  source: null,
  tags: [],
  image: null,
}

function stubFetch(response: () => Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response())
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

test('updateRecipe sends JSON PUT', async () => {
  const fetch = stubFetch(() => json({ slug: 'daiquiri', name: 'Daiquiri' }))
  const recipe = await updateRecipe('drinks', 'daiquiri', draft)
  expect(recipe.slug).toBe('daiquiri')
  const [url, init] = fetch.mock.calls[0]
  expect(url).toBe('/api/recipes/drinks/daiquiri')
  expect(init?.method).toBe('PUT')
  expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
  expect(JSON.parse(init?.body as string)).toEqual(draft)
})

test('createRecipe posts the draft with its side', async () => {
  const fetch = stubFetch(() => json({ slug: 'daiquiri' }, 201))
  await createRecipe('drinks', draft)
  const [url, init] = fetch.mock.calls[0]
  expect(url).toBe('/api/recipes')
  expect(init?.method).toBe('POST')
  expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
  expect(JSON.parse(init?.body as string)).toEqual({ side: 'drinks', ...draft })
})

test('ApiError carries the server sentence', async () => {
  stubFetch(() => json({ error: 'Give the recipe a name' }, 400))
  const failure = await createRecipe('food', draft).catch((err: unknown) => err)
  expect(failure).toBeInstanceOf(ApiError)
  expect((failure as ApiError).message).toBe('Give the recipe a name')
  expect((failure as ApiError).status).toBe(400)
})

test('ApiError falls back to the status when the body is not the error shape', async () => {
  stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }))
  const failure = await updateRecipe('food', 'x', draft).catch((err: unknown) => err)
  expect(failure).toBeInstanceOf(ApiError)
  expect((failure as ApiError).message).toBe('Something went wrong (status 502)')
  expect((failure as ApiError).status).toBe(502)

  stubFetch(() => json({ error: 42 }, 500))
  const other = await updateRecipe('food', 'x', draft).catch((err: unknown) => err)
  expect((other as ApiError).message).toBe('Something went wrong (status 500)')
})

test('deleteRecipe resolves on 204 without reading a body', async () => {
  const fetch = stubFetch(() => new Response(null, { status: 204 }))
  await expect(deleteRecipe('food', 'a b')).resolves.toBeUndefined()
  const [url, init] = fetch.mock.calls[0]
  expect(url).toBe('/api/recipes/food/a%20b')
  expect(init?.method).toBe('DELETE')
})

test('deleteRecipe rejects with the server sentence', async () => {
  stubFetch(() => json({ error: 'No such recipe' }, 404))
  await expect(deleteRecipe('food', 'gone')).rejects.toMatchObject({ message: 'No such recipe', status: 404 })
})

test('uploadImage posts the raw file with its type', async () => {
  const fetch = stubFetch(() => json({ name: 'abc123.png' }, 201))
  const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })
  await expect(uploadImage(file)).resolves.toBe('abc123.png')
  const [url, init] = fetch.mock.calls[0]
  expect(url).toBe('/api/uploads')
  expect(init?.method).toBe('POST')
  expect(new Headers(init?.headers).get('Content-Type')).toBe('image/png')
  expect(init?.body).toBe(file)
})

test('uploadImage sends a HEIC photo with no type as image/heic', async () => {
  const fetch = stubFetch(() => json({ name: 'abc123.heic' }, 201))
  const file = new File([new Uint8Array([1])], 'IMG_0001.HEIC', { type: '' })
  await uploadImage(file)
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get('Content-Type')).toBe('image/heic')
})

test('getTimeline reads entries and the current version', async () => {
  const body = { entries: [{ id: 'a'.repeat(12), at: '2026-10-20T10:00:00Z', via: 'app', kind: 'note', text: 'Nice' }], current_version: 2 }
  const fetch = stubFetch(() => json(body))
  await expect(getTimeline('food', 'dal')).resolves.toEqual(body)
  expect(fetch.mock.calls[0][0]).toBe('/api/recipes/food/dal/timeline')
})

test('addEntry posts the entry body', async () => {
  const fetch = stubFetch(() => json({ entry: { kind: 'rating' }, recipe: { slug: 'dal' } }, 201))
  const result = await addEntry('food', 'dal', { kind: 'rating', rating: 4.5 })
  expect(result.recipe.slug).toBe('dal')
  const [url, init] = fetch.mock.calls[0]
  expect(url).toBe('/api/recipes/food/dal/timeline')
  expect(init?.method).toBe('POST')
  expect(JSON.parse(init?.body as string)).toEqual({ kind: 'rating', rating: 4.5 })
})

test('setMarks and restoreVersion post their bodies', async () => {
  const fetch = stubFetch(() => json({ slug: 'dal' }))
  await setMarks('food', 'dal', ['favourite'], ['try_next'])
  await restoreVersion('food', 'dal', 3)
  const [marksUrl, marks] = fetch.mock.calls[0]
  expect(marksUrl).toBe('/api/recipes/food/dal/marks')
  expect(JSON.parse(marks?.body as string)).toEqual({ add: ['favourite'], remove: ['try_next'] })
  const [restoreUrl, restore] = fetch.mock.calls[1]
  expect(restoreUrl).toBe('/api/recipes/food/dal/restore')
  expect(JSON.parse(restore?.body as string)).toEqual({ version: 3 })
})
