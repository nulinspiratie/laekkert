import type { Recipe, RecipeSummary, Side } from './types'

export async function listRecipes(side: Side): Promise<RecipeSummary[]> {
  const response = await fetch(`/api/recipes?side=${side}`)
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
