import type { RecipeIngredient } from './types'

export type UnitMode = 'spoons' | 'metric'
export type AmountFlag = 'not-metric' | 'no-spoon-conversion' | null

// Spoon amounts up to this many tsp (4 tbsp) are shown in spoons; bigger ones stay metric.
const MAX_SPOON_TSP = 12
// Gram amounts up to this are small enough that a missing spoon conversion is worth flagging.
const MAX_FLAGGED_GRAMS = 30

const QUARTER_GLYPHS = ['', '¼', '½', '¾']

// Round to the nearest multiple of `step`; half-way values go up.
function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

// `n` is expected to be on the quarter grid already.
export function fraction(n: number): string {
  const quarters = Math.round(n * 4)
  const whole = Math.floor(quarters / 4)
  const glyph = QUARTER_GLYPHS[quarters % 4]
  if (glyph === '') return String(whole)
  return whole === 0 ? glyph : `${whole}${glyph}`
}

function plain(n: number): string {
  return String(Number(n.toFixed(2)))
}

function countStep(value: number): number {
  if (value < 1) return 0.25
  if (value < 3) return 0.5
  return 1
}

function metricStep(value: number): number {
  if (value < 10) return 0.5
  if (value < 100) return 1
  return 5
}

function metric(value: number, unit: string): string {
  const rounded = Math.max(0.5, roundTo(value, metricStep(value)))
  return `${plain(rounded)} ${unit}`
}

function spoons(tsp: number): string {
  if (tsp < 3) {
    const rounded = Math.max(0.25, roundTo(tsp, 0.25))
    // A value just under 3 tsp can round up to it; that reads as a tablespoon instead.
    if (rounded < 3) return `${fraction(rounded)} tsp`
  }
  return `${fraction(Math.max(1, roundTo(tsp / 3, 0.5)))} tbsp`
}

export function formatAmount(
  ing: RecipeIngredient,
  factor: number,
  mode: UnitMode,
): { text: string; flag: AmountFlag } {
  if (ing.amount === null) {
    if (ing.original) return { text: ing.original, flag: 'not-metric' }
    return { text: '', flag: null }
  }
  if (ing.unit === 'to taste') return { text: '', flag: null }

  const scaled = ing.amount * (ing.no_scale ? 1 : factor)

  switch (ing.unit) {
    case 'piece':
      return { text: fraction(Math.max(0.25, roundTo(scaled, countStep(scaled)))), flag: null }
    case 'pinch':
    case 'dash': {
      const n = Math.max(0.25, roundTo(scaled, countStep(scaled)))
      return { text: `${fraction(n)} ${ing.unit}`, flag: null }
    }
    case 'g':
    case 'ml': {
      if (mode === 'spoons') {
        const tsp =
          ing.unit === 'ml' ? scaled / 5 : ing.g_per_tsp ? scaled / ing.g_per_tsp : null
        if (tsp !== null) {
          if (tsp <= MAX_SPOON_TSP) return { text: spoons(tsp), flag: null }
        } else if (scaled <= MAX_FLAGGED_GRAMS) {
          return { text: metric(scaled, ing.unit), flag: 'no-spoon-conversion' }
        }
      }
      return { text: metric(scaled, ing.unit), flag: null }
    }
  }
}
