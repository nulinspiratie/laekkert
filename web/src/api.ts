import type { Recipe, RecipeSummary, Side } from './types'

/** All of a side's recipes, or only the matches for `q` (best match first). */
export async function listRecipes(side: Side, q?: string): Promise<RecipeSummary[]> {
  const params = new URLSearchParams({ side })
  if (q) params.set('q', q)
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
