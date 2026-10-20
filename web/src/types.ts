// Mirrors src/app/recipes/model.py; the API sends these shapes.

export type Side = 'food' | 'drinks'

export const SIDES: readonly Side[] = ['food', 'drinks']

export const SIDE_LABELS: Record<Side, string> = { food: 'Food', drinks: 'Drinks' }

export type Unit = 'g' | 'ml' | 'piece' | 'dash' | 'pinch' | 'to taste'

export type Mark = 'tried' | 'favourite' | 'try_next'

export interface Ingredient {
  amount: number | null
  unit: Unit
  item: string
  note: string
  no_scale: boolean
  original: string
}

export interface RecipeIngredient extends Ingredient {
  g_per_tsp: number | null
}

export interface Source {
  url: string | null
  photo: string | null
}

export interface RecipeSummary {
  slug: string
  name: string
  side: Side
  category: string
  time_minutes: number | null
  tags: string[]
  marks: Mark[]
  image: string | null
}

export interface Recipe extends RecipeSummary {
  format_version: number
  servings: number
  ingredients: RecipeIngredient[]
  steps: string[]
  source: Source | null
}

export function isSide(value: string | undefined): value is Side {
  return SIDES.includes(value as Side)
}
