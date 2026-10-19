// The ingredients card: a servings stepper, the tsp / g-ml toggle and the scaled rows.

import { useId, useState } from 'react'
import { formatAmount, type AmountFlag, type UnitMode } from './amounts'
import { Minus, Plus } from './icons'
import { getUnitMode, setUnitMode } from './prefs'
import type { RecipeIngredient } from './types'

const MIN_SERVINGS = 1
const MAX_SERVINGS = 24

const FLAG_LABELS: Record<Exclude<AmountFlag, null>, string> = {
  'not-metric': 'Not converted to metric yet',
  'no-spoon-conversion': 'No tsp conversion yet',
}

export interface IngredientsProps {
  ingredients: RecipeIngredient[]
  /** What the amounts in `ingredients` are written for; the stepper starts here. */
  servings: number
}

export function Ingredients({ ingredients, servings: recipeServings }: IngredientsProps) {
  const headingId = useId()
  const [servings, setServings] = useState(recipeServings)
  // Read once: the preference is only written from this toggle.
  const [mode, setMode] = useState<UnitMode>(getUnitMode)

  const pickMode = (next: UnitMode) => {
    setMode(next)
    setUnitMode(next)
  }
  const factor = servings / recipeServings

  return (
    <section className="ingredients" aria-labelledby={headingId}>
      <h2 id={headingId}>Ingredients</h2>
      <div className="ingredients-controls">
        <div className="segmented" role="group" aria-label="Servings">
          <button
            type="button"
            className="segmented-btn segmented-btn--icon"
            aria-label="Fewer servings"
            disabled={servings <= MIN_SERVINGS}
            onClick={() => setServings((n) => Math.max(MIN_SERVINGS, n - 1))}
          >
            <Minus />
          </button>
          <span className="segmented-value" aria-live="polite">
            {servings === 1 ? '1 serving' : `${servings} servings`}
          </span>
          <button
            type="button"
            className="segmented-btn segmented-btn--icon"
            aria-label="More servings"
            disabled={servings >= MAX_SERVINGS}
            onClick={() => setServings((n) => Math.min(MAX_SERVINGS, n + 1))}
          >
            <Plus />
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Units">
          <button
            type="button"
            className="segmented-btn segmented-btn--text"
            aria-pressed={mode === 'spoons'}
            onClick={() => pickMode('spoons')}
          >
            tsp
          </button>
          <button
            type="button"
            className="segmented-btn segmented-btn--text"
            aria-pressed={mode === 'metric'}
            onClick={() => pickMode('metric')}
          >
            g/ml
          </button>
        </div>
      </div>
      <ul className="ingredient-list">
        {ingredients.map((ing, i) => (
          <IngredientRow key={i} ingredient={ing} factor={factor} mode={mode} />
        ))}
      </ul>
    </section>
  )
}

function IngredientRow({
  ingredient: ing,
  factor,
  mode,
}: {
  ingredient: RecipeIngredient
  factor: number
  mode: UnitMode
}) {
  const { text, flag } = formatAmount(ing, factor, mode)
  return (
    <li className="ingredient">
      <span className="ingredient-amount">
        {text}
        {flag && (
          <span
            className="ingredient-flag"
            role="img"
            title={FLAG_LABELS[flag]}
            aria-label={FLAG_LABELS[flag]}
          >
            *
          </span>
        )}
      </span>
      <span className="ingredient-text">
        <span>{ing.item}</span>
        {ing.unit === 'to taste' && <span className="ingredient-note">, to taste</span>}
        {ing.note && <span className="ingredient-note">, {ing.note}</span>}
        {ing.no_scale && (
          <span className="ingredient-fixed" title="Doesn't scale with servings">
            fixed
          </span>
        )}
      </span>
    </li>
  )
}
