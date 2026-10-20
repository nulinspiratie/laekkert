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
  /** Computed from the timeline: the latest rating, 0.5 to 5. */
  rating: number | null
  /** UTC timestamp of the latest "made it" entry. */
  last_made: string | null
}

export interface Recipe extends RecipeSummary {
  format_version: number
  servings: number
  ingredients: RecipeIngredient[]
  steps: string[]
  source: Source | null
  /** Counts saved changes; 0 for a recipe that predates versions. Sent back with an edit. */
  version: number
}

export function isSide(value: string | undefined): value is Side {
  return SIDES.includes(value as Side)
}

/** One line of an edit's readable diff. */
export interface Change {
  section: 'details' | 'ingredients' | 'method' | 'source' | 'tags' | 'photo'
  kind: 'added' | 'removed' | 'changed'
  text: string
}

interface EntryBase {
  /** 12 hex characters. */
  id: string
  /** UTC, ISO 8601, seconds, e.g. 2026-10-20T14:03:12Z. */
  at: string
  via: 'app' | 'claude'
}

export type TimelineEntry =
  | (EntryBase & { kind: 'created'; version: number })
  | (EntryBase & { kind: 'baseline'; version: number })
  | (EntryBase & { kind: 'edit'; version: number; changes: Change[]; restored_from: number | null })
  | (EntryBase & { kind: 'note'; text: string })
  | (EntryBase & { kind: 'rating'; rating: number; previous: number | null })
  | (EntryBase & { kind: 'made'; rating: number | null; note: string })
  | (EntryBase & { kind: 'marks'; added: Mark[]; removed: Mark[] })

/** What a new timeline entry is posted as. */
export type NewEntry =
  | { kind: 'note'; text: string }
  | { kind: 'rating'; rating: number }
  | { kind: 'made'; rating?: number; note?: string }

/** The editor offers tsp and tbsp; the server converts them to g or ml on save. */
export type DraftUnit = Unit | 'tsp' | 'tbsp'

export type DraftIngredient = Omit<Ingredient, 'unit'> & { unit: DraftUnit }

export interface RecipeDraft {
  name: string
  category: string
  servings: number
  time_minutes: number | null
  ingredients: DraftIngredient[]
  steps: string[]
  source: Source | null
  tags: string[]
  image: string | null
}
