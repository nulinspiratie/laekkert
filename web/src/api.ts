import type { Bar, BarChanges, Mark, NewEntry, Recipe, RecipeDraft, RecipeSummary, Side, TimelineEntry } from './types'

/**
 * All of a side's recipes, or only the matches for `q` (best match first). With `have` terms
 * (food only) the recipes that use at least one, fewest missing first.
 */
export async function listRecipes(side: Side, q?: string, have: string[] = []): Promise<RecipeSummary[]> {
  const params = new URLSearchParams({ side })
  if (q) params.set('q', q)
  for (const term of have) params.append('have', term)
  const response = await fetch(`/api/recipes?${params}`)
  if (!response.ok) throw new Error(`listing ${side} failed: ${response.status}`)
  const body: { recipes: RecipeSummary[] } = await response.json()
  return body.recipes
}

export async function getRecipe(side: Side, slug: string): Promise<Recipe | null> {
  const response = await fetch(`/api/recipes/${side}/${encodeURIComponent(slug)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`loading ${side}/${slug} failed: ${response.status}`)
  return response.json()
}

/** URL of a recipe's picture; `image` is the file name the recipe declares. */
export function recipeImageUrl(side: Side, slug: string, image: string): string {
  return `/api/recipes/${side}/${encodeURIComponent(slug)}/files/${encodeURIComponent(image)}`
}

/** A failed API call. `message` is the server's sentence, ready to show as it is. */
export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function failure(response: Response): Promise<ApiError> {
  let message = `Something went wrong (status ${response.status})`
  try {
    const body: unknown = await response.json()
    const sentence = (body as { error?: unknown } | null)?.error
    if (typeof sentence === 'string') message = sentence
  } catch {
    // Not JSON (a proxy's error page, say): keep the status message.
  }
  return new ApiError(message, response.status)
}

async function send(url: string, method: string, body?: unknown): Promise<Response> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw await failure(response)
  return response
}

const recipeUrl = (side: Side, slug: string) => `/api/recipes/${side}/${encodeURIComponent(slug)}`

export async function createRecipe(side: Side, draft: RecipeDraft): Promise<Recipe> {
  return (await send('/api/recipes', 'POST', { side, ...draft })).json()
}

/** `baseVersion` is the version the edit started from; the server refuses it (409) if it has moved on. */
export async function updateRecipe(
  side: Side,
  slug: string,
  draft: RecipeDraft,
  baseVersion: number,
): Promise<Recipe> {
  return (await send(recipeUrl(side, slug), 'PUT', { ...draft, base_version: baseVersion })).json()
}

export async function deleteRecipe(side: Side, slug: string): Promise<void> {
  await send(recipeUrl(side, slug), 'DELETE')
}

/** Parks a picked photo on the server; the returned name goes in the draft's `image`. */
export async function uploadImage(file: File): Promise<string> {
  // Some browsers leave the type of a HEIC photo empty; the server accepts it as image/heic.
  const heic = !file.type && /\.hei[cf]$/i.test(file.name)
  const response = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': heic ? 'image/heic' : file.type },
    body: file,
  })
  if (!response.ok) throw await failure(response)
  const body: { name: string } = await response.json()
  return body.name
}

/** The entries come newest first. */
export async function getTimeline(
  side: Side,
  slug: string,
): Promise<{ entries: TimelineEntry[]; current_version: number | null }> {
  return (await send(`${recipeUrl(side, slug)}/timeline`, 'GET')).json()
}

export async function addEntry(
  side: Side,
  slug: string,
  body: NewEntry,
): Promise<{ entry: TimelineEntry; recipe: Recipe }> {
  return (await send(`${recipeUrl(side, slug)}/timeline`, 'POST', body)).json()
}

export async function setMarks(side: Side, slug: string, add: Mark[], remove: Mark[]): Promise<Recipe> {
  return (await send(`${recipeUrl(side, slug)}/marks`, 'POST', { add, remove })).json()
}

export async function restoreVersion(side: Side, slug: string, version: number): Promise<Recipe> {
  return (await send(`${recipeUrl(side, slug)}/restore`, 'POST', { version })).json()
}

export async function getBar(): Promise<Bar> {
  return (await send('/api/bar', 'GET')).json()
}

/** Every write returns the whole bar after the change. */
export async function changeBar(changes: BarChanges): Promise<Bar> {
  return (await send('/api/bar', 'POST', changes)).json()
}
