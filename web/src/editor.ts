// The editor's form state and the pure helpers around it. The inputs hold text, so
// `validate` and `toDraft` are what turn it into a RecipeDraft the server accepts.

import { CATEGORIES } from './browse'
import type { DraftIngredient, DraftUnit, Recipe, RecipeDraft, Side } from './types'

export type SourceMode = 'link' | 'photo' | 'none'

export interface EditorRow {
  /** Identifies the row across reorders; never sent. */
  key: string
  amount: string
  unit: DraftUnit
  item: string
  note: string
  no_scale: boolean
  /** The amount as written ("1 cup") on a row that was never converted. */
  original: string
}

export interface EditorStep {
  key: string
  text: string
}

export interface EditorState {
  name: string
  category: string
  /** Minutes; blank means no time. */
  time: string
  servings: string
  rows: EditorRow[]
  steps: EditorStep[]
  sourceMode: SourceMode
  sourceUrl: string
  /** The name of an uploaded or stored source photo. */
  sourcePhoto: string | null
  tags: string[]
  /** The name of an uploaded or stored picture. */
  image: string | null
}

/** The units the form offers, in the order of its select. */
export const UNITS: readonly DraftUnit[] = ['g', 'ml', 'tsp', 'tbsp', 'piece', 'dash', 'pinch', 'to taste']

// Limits the server enforces (src/app/recipes/drafts.py).
const MAX_AMOUNT = 100_000
const MAX_SERVINGS = 1000
const MAX_MINUTES = 7 * 24 * 60

// The server rejects these units without an amount unless the row keeps its `original`.
const MEASURED: readonly DraftUnit[] = ['g', 'ml', 'piece', 'dash']

let counter = 0
export function newKey(): string {
  counter += 1
  return `k${counter}`
}

export function blankRow(): EditorRow {
  return { key: newKey(), amount: '', unit: 'g', item: '', note: '', no_scale: false, original: '' }
}

export function blankStep(): EditorStep {
  return { key: newKey(), text: '' }
}

export function emptyState(side: Side): EditorState {
  return {
    name: '',
    category: CATEGORIES[side][0],
    time: '',
    servings: side === 'drinks' ? '1' : '4',
    rows: [blankRow()],
    steps: [blankStep()],
    sourceMode: 'none',
    sourceUrl: '',
    sourcePhoto: null,
    tags: [],
    image: null,
  }
}

export function stateFromRecipe(recipe: Recipe): EditorState {
  const { source } = recipe
  return {
    name: recipe.name,
    category: recipe.category,
    time: recipe.time_minutes === null ? '' : String(recipe.time_minutes),
    servings: String(recipe.servings),
    rows: recipe.ingredients.map((ing) => ({
      key: newKey(),
      amount: ing.amount === null ? '' : String(ing.amount),
      unit: ing.unit,
      item: ing.item,
      note: ing.note,
      no_scale: ing.no_scale,
      original: ing.original,
    })),
    steps: recipe.steps.map((text) => ({ key: newKey(), text })),
    // A hand-edited recipe could have both; the link wins and the photo is kept in the
    // state so switching to Photo shows it again.
    sourceMode: source?.url ? 'link' : source?.photo ? 'photo' : 'none',
    sourceUrl: source?.url ?? '',
    sourcePhoto: source?.photo ?? null,
    tags: [...recipe.tags],
    image: recipe.image,
  }
}

const GLYPHS: Record<string, number> = {
  '½': 1 / 2,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 1 / 4,
  '¾': 3 / 4,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
}

/**
 * The number typed in an amount box. Accepts 2.5, 2,5, ½, 1½, 1/2 and 1 1/2. Blank is
 * `null`; anything else is 'invalid'.
 */
export function parseAmount(text: string): number | null | 'invalid' {
  const t = text.trim()
  if (t === '') return null
  if (/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(t)) return Number(t.replace(',', '.'))
  const glyph = /^(\d+)?\s*([½⅓⅔¼¾⅛⅜⅝⅞])$/.exec(t)
  if (glyph) return Number(glyph[1] ?? 0) + GLYPHS[glyph[2]]
  const fraction = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(t)
  if (fraction) {
    const denominator = Number(fraction[3])
    if (denominator === 0) return 'invalid'
    return Number(fraction[1] ?? 0) + Number(fraction[2]) / denominator
  }
  return 'invalid'
}

function isBlank(row: EditorRow): boolean {
  return !(row.item.trim() || row.amount.trim() || row.note.trim() || row.original.trim())
}

function rowProblem(number: number, row: EditorRow): string | null {
  const who = `Ingredient ${number}`
  const amount = parseAmount(row.amount)
  if (amount === 'invalid') return `${who} needs a number for the amount`
  if (amount !== null && amount > MAX_AMOUNT) return `${who}'s amount is too large`
  if (amount !== null && amount <= 0) return `${who} needs an amount above 0`
  const spoon = row.unit === 'tsp' || row.unit === 'tbsp'
  if (spoon && amount === null) return `${who} needs an amount in ${row.unit}`
  if (!row.item.trim()) return `${who} needs a name`
  if (MEASURED.includes(row.unit) && amount === null && !row.original.trim()) {
    return `${who} needs an amount in ${row.unit}`
  }
  return null
}

/** The problems the form can see itself, in the server's words. Empty means good to save. */
export function validate(state: EditorState): string[] {
  const problems: string[] = []
  if (!state.name.trim()) problems.push('Give the recipe a name')

  const servings = state.servings.trim()
  if (!/^-?\d+$/.test(servings)) {
    problems.push(/^-?\d*\.\d+$/.test(servings) ? 'Servings must be a whole number' : 'Servings must be at least 1')
  } else if (Number(servings) < 1) {
    problems.push('Servings must be at least 1')
  } else if (Number(servings) > MAX_SERVINGS) {
    problems.push(`Servings can be at most ${MAX_SERVINGS}`)
  }

  const time = state.time.trim()
  if (time !== '') {
    if (!/^-?\d+$/.test(time)) problems.push('Cooking time must be a whole number of minutes')
    else if (Number(time) < 0) problems.push("Cooking time can't be negative")
    else if (Number(time) > MAX_MINUTES) problems.push('Cooking time can be at most a week')
  }

  // Numbered by position in the form, blank rows included.
  let filled = 0
  state.rows.forEach((row, index) => {
    if (isBlank(row)) return
    filled += 1
    const problem = rowProblem(index + 1, row)
    if (problem) problems.push(problem)
  })
  if (filled === 0) problems.push('Add at least one ingredient')

  const url = state.sourceUrl.trim()
  if (state.sourceMode === 'link' && url && !/^https?:\/\//i.test(url)) {
    problems.push('The source link must start with http:// or https://')
  }
  return problems
}

function draftRow(row: EditorRow): DraftIngredient {
  const amount = parseAmount(row.amount)
  const number = amount === 'invalid' ? null : amount
  return {
    amount: number,
    unit: row.unit,
    item: row.item.trim(),
    note: row.note.trim(),
    no_scale: row.no_scale,
    // Typing an amount replaces what was written.
    original: number === null ? row.original.trim() : '',
  }
}

/** Expects a state `validate` passed. Only the chosen source mode is sent. */
export function toDraft(state: EditorState): RecipeDraft {
  const url = state.sourceUrl.trim()
  let source: RecipeDraft['source'] = null
  if (state.sourceMode === 'link' && url) source = { url, photo: null }
  if (state.sourceMode === 'photo' && state.sourcePhoto) source = { url: null, photo: state.sourcePhoto }
  const time = state.time.trim()
  return {
    name: state.name.trim(),
    category: state.category,
    servings: Number(state.servings),
    time_minutes: time === '' ? null : Number(time),
    ingredients: state.rows.filter((row) => !isBlank(row)).map(draftRow),
    steps: state.steps.map((step) => step.text.trim()).filter(Boolean),
    source,
    tags: state.tags,
    image: state.image,
  }
}

/** A copy of `list` with the item at `index` moved one place; unchanged at either end. */
export function move<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta
  if (target < 0 || target >= list.length) return list.slice()
  const copy = list.slice()
  ;[copy[index], copy[target]] = [copy[target], copy[index]]
  return copy
}

// What the person typed, without the row keys.
function content(state: EditorState): string {
  return JSON.stringify({
    ...state,
    rows: state.rows.map(({ key: _key, ...row }) => row),
    steps: state.steps.map(({ key: _key, ...step }) => step),
  })
}

export function isDirty(initial: EditorState, current: EditorState): boolean {
  return content(initial) !== content(current)
}
