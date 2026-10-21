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
  /** The ingredient group heading it sits under; '' is no group. */
  group: string
}

export interface RecipeIngredient extends Ingredient {
  g_per_tsp: number | null
  /** Drinks only: the bar item this ingredient is, or null when none matches. */
  bar?: IngredientBar | null
}

/** One method step; `group` is the heading it sits under, '' for none. */
export interface Step {
  text: string
  group: string
}

export interface Source {
  url: string | null
  photo: string | null
}

/** Which of a recipe's ingredients the "what you have" terms cover, as the rows are written. */
export interface HaveMatch {
  matched: string[]
  missing: string[]
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
  /** Cocktails and mocktails: what the bar says about making this drink. Null for syrups and prep. */
  bar?: DrinkBar | null
  /** Food only, and only when the request had `have` terms. */
  have?: HaveMatch
}

export interface Recipe extends RecipeSummary {
  format_version: number
  servings: number
  ingredients: RecipeIngredient[]
  steps: Step[]
  /** Free text with line breaks, **bold**, *italic* and - bullets; '' is none. */
  notes: string
  source: Source | null
  /** Counts saved changes; 0 for a recipe that predates versions. Sent back with an edit. */
  version: number
}

export type Kind = 'spirits' | 'liqueurs' | 'aperitifs' | 'bitters' | 'syrups' | 'other'

/** Whether the household has an item; an unsorted item has no state. */
export type BarState = 'have' | 'dont'

export type DrinkStatus = 'can_make' | 'missing' | 'unsorted'

/** Why an item is not tracked: it is a syrup, a recipe makes it, or it was marked so. */
export type UntrackedBecause = 'syrups' | 'recipe' | 'marked'

/** A drink as a bar item links to it. */
export interface DrinkLink {
  slug: string
  name: string
}

export interface BarItem {
  name: string
  aliases: string[]
  kind: Kind
  /** Whether the bar keeps a state for it. Untracked items never hold drinks back. */
  tracked: boolean
  untracked_because: UntrackedBecause | null
  /** Null when unsorted, and always for an untracked item. */
  state: BarState | null
  used_in: DrinkLink[]
  /** A syrup recipe that makes this item. */
  recipe: DrinkLink | null
}

export interface Bar {
  items: BarItem[]
  set_up: boolean
  counts: Record<DrinkStatus | 'total', number>
}

/** What the bar says about one drink. The lists hold item names. */
export interface DrinkBar {
  status: DrinkStatus
  missing: string[]
  unsorted: string[]
  /** Untracked items the drink also uses; they do not change its status. */
  untracked: string[]
}

/** What the bar says about one ingredient of a drink. */
export interface IngredientBar {
  item: string
  state: BarState | null
  tracked: boolean
  recipe: DrinkLink | null
}

/** One change to the bar, applied all or nothing by the server. */
export interface BarChanges {
  have?: string[]
  dont_have?: string[]
  unsorted?: string[]
  untrack?: string[]
  track?: string[]
  kinds?: Record<string, Kind>
  add_names?: Record<string, string[]>
  remove_names?: Record<string, string[]>
  fold?: Record<string, string>
  delete?: string[]
}

export function isSide(value: string | undefined): value is Side {
  return SIDES.includes(value as Side)
}

/** One line of an edit's readable diff. */
export interface Change {
  section: 'details' | 'ingredients' | 'method' | 'notes' | 'source' | 'tags' | 'photo'
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
  steps: Step[]
  notes: string
  source: Source | null
  tags: string[]
  image: string | null
}
