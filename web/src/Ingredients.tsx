// The ingredients card: a servings stepper, the tsp / g-ml toggle and the scaled rows.
// On a drink the stepper counts drinks, a line sums up the bar, and each row shows its
// item's bar state; a bottle flips with one tap, with an undo under that row
// (DrinkRecipePhone, DrinkRecipeDesktop).

import { useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { formatAmount, type AmountFlag, type UnitMode } from './amounts'
import { normalise } from './bar'
import { capitalise } from './format'
import { Basket, Check, Chevron, Minus, MinusCircle, Plus, Question } from './icons'
import { getUnitMode, setUnitMode } from './prefs'
import type { BarState, DrinkBar, IngredientBar, RecipeIngredient, Side } from './types'
import { useIsDesktop } from './useIsDesktop'

const MIN_SERVINGS = 1
const MAX_SERVINGS = 24
const MAX_DRINKS = 12

const FLAG_LABELS: Record<Exclude<AmountFlag, null>, string> = {
  'not-metric': 'Not converted to metric yet',
  'no-spoon-conversion': 'No tsp conversion yet',
}

export interface IngredientsProps {
  ingredients: RecipeIngredient[]
  /** What the amounts in `ingredients` are written for; the stepper starts here. */
  servings: number
  /** Drinks count drinks and show the bar; food (the default) shows neither. */
  side?: Side
  /** Drinks: what the bar says about the whole drink, for the summary line. */
  bar?: DrinkBar
  /** Drinks: sets an item's state (null is unsorted); true once the server has taken it. */
  onBar?: (item: string, next: BarState | null) => Promise<boolean>
  /** Drinks: the bar write the server refused, shown at the row that asked for it. */
  barError?: { item: string; message: string } | null
  /** Drinks: another write on the page is in flight, so the bar buttons wait. */
  busy?: boolean
}

/** The last flip, which Undo puts back: the row, its item and the state it had before. */
interface Flip {
  row: number
  item: string
  previous: BarState | null
  now: BarState
}

export function Ingredients({
  ingredients,
  servings: recipeServings,
  side = 'food',
  bar,
  onBar,
  barError = null,
  busy = false,
}: IngredientsProps) {
  const headingId = useId()
  const drinks = side === 'drinks'
  const max = drinks ? MAX_DRINKS : MAX_SERVINGS
  const [servings, setServings] = useState(Math.min(recipeServings, max))
  // Read once: the preference is only written from this toggle.
  const [mode, setMode] = useState<UnitMode>(getUnitMode)
  const [flip, setFlip] = useState<Flip | null>(null)
  // The row whose bar write was sent last: a refusal shows there.
  const [asked, setAsked] = useState<number | null>(null)
  // The row whose bar write is in flight; the ref also stops a second write in the same tick.
  const [pending, setPending] = useState<number | null>(null)
  const sending = useRef(false)
  const waiting = busy || pending !== null
  const buttons = useRef(new Map<number, HTMLButtonElement>())

  const pickMode = (next: UnitMode) => {
    setMode(next)
    setUnitMode(next)
  }
  const factor = servings / recipeServings
  const count = drinks
    ? servings === 1
      ? '1 drink'
      : `${servings} drinks`
    : servings === 1
      ? '1 serving'
      : `${servings} servings`

  /** One bar write for a row; none while another write is in flight (the buttons say so). */
  const send = async (row: number, item: string, next: BarState | null): Promise<boolean> => {
    if (!onBar || busy || sending.current) return false
    sending.current = true
    setPending(row)
    setAsked(row)
    try {
      return await onBar(item, next)
    } finally {
      sending.current = false
      setPending(null)
    }
  }

  const toggle = async (row: number, item: IngredientBar) => {
    const now: BarState = item.state === 'have' ? 'dont' : 'have'
    if (await send(row, item.item, now)) setFlip({ row, item: item.item, previous: item.state, now })
  }

  const undo = async () => {
    if (!flip) return
    if (await send(flip.row, flip.item, flip.previous)) {
      setFlip(null)
      // The Undo button has gone: back to the row's own button.
      buttons.current.get(flip.row)?.focus()
    }
  }

  return (
    <section className={drinks ? 'ingredients ingredients--drinks' : 'ingredients'} aria-labelledby={headingId}>
      <h2 id={headingId}>Ingredients</h2>
      <div className="ingredients-controls">
        <div className="segmented" role="group" aria-label={drinks ? 'Drinks to make' : 'Servings'}>
          <button
            type="button"
            className="segmented-btn segmented-btn--icon"
            aria-label={drinks ? 'Fewer' : 'Fewer servings'}
            disabled={servings <= MIN_SERVINGS}
            onClick={() => setServings((n) => Math.max(MIN_SERVINGS, n - 1))}
          >
            <Minus />
          </button>
          <span className="segmented-value" aria-live="polite">
            {count}
          </span>
          <button
            type="button"
            className="segmented-btn segmented-btn--icon"
            aria-label={drinks ? 'More' : 'More servings'}
            disabled={servings >= max}
            onClick={() => setServings((n) => Math.min(max, n + 1))}
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
      {drinks && bar && <BarSummary bar={bar} ingredients={ingredients} />}
      <ul className="ingredient-list">
        {ingredients.map((ing, i) =>
          drinks ? (
            <DrinkRow
              key={i}
              ingredient={ing}
              factor={factor}
              mode={mode}
              problem={asked === i && barError && ing.bar?.item === barError.item ? barError.message : null}
              flip={flip?.row === i ? flip : null}
              waiting={waiting}
              pending={pending === i}
              onToggle={onBar && ((item) => void toggle(i, item))}
              onUndo={() => void undo()}
              buttonRef={(button) => {
                if (button) buttons.current.set(i, button)
                else buttons.current.delete(i)
              }}
            />
          ) : (
            <IngredientRow key={i} ingredient={ing} factor={factor} mode={mode} />
          ),
        )}
      </ul>
    </section>
  )
}

/** "Missing: a, b" or "From your bar: 2 of 2", and "Buy fresh: x" when the drink has fresh items. */
function BarSummary({ bar, ingredients }: { bar: DrinkBar; ingredients: RecipeIngredient[] }) {
  // Unsorted bottles count as missing here; the names go in recipe order.
  const order = (name: string) => ingredients.findIndex((ing) => (ing.bar?.item ?? ing.item) === name)
  const missing = [...bar.missing, ...bar.unsorted].sort((a, b) => order(a) - order(b))
  const shelf = new Set(
    ingredients.flatMap((ing) => (ing.bar?.tracked ? [normalise(ing.bar.item)] : [])),
  ).size
  if (missing.length === 0 && shelf === 0 && bar.untracked.length === 0) return null
  return (
    <p className="ingredients-bar" aria-live="polite">
      {missing.length > 0 ? (
        <span className="ingredients-bar-missing">
          <MinusCircle size={16} />
          Missing: {missing.join(', ')}
        </span>
      ) : (
        shelf > 0 && (
          <span className="ingredients-bar-have">
            <Check size={16} strokeWidth={2.5} />
            From your bar: {shelf} of {shelf}
          </span>
        )
      )}
      {bar.untracked.length > 0 && (
        <span className="ingredients-bar-fresh">
          <Basket size={16} strokeWidth={2} />
          Buy fresh: {bar.untracked.join(', ')}
        </span>
      )}
    </p>
  )
}

interface RowProps {
  ingredient: RecipeIngredient
  factor: number
  mode: UnitMode
}

function Amount({ ingredient: ing, factor, mode }: RowProps) {
  const { text, flag } = formatAmount(ing, factor, mode)
  return (
    <span className="ingredient-amount">
      {text}
      {flag && (
        <span className="ingredient-flag" role="img" title={FLAG_LABELS[flag]} aria-label={FLAG_LABELS[flag]}>
          *
        </span>
      )}
    </span>
  )
}

function ItemText({ ingredient: ing }: { ingredient: RecipeIngredient }) {
  return (
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
  )
}

function IngredientRow(props: RowProps) {
  return (
    <li className="ingredient">
      <Amount {...props} />
      <ItemText ingredient={props.ingredient} />
    </li>
  )
}

function DrinkRow({
  problem,
  flip,
  waiting,
  pending,
  onToggle,
  onUndo,
  buttonRef,
  ...row
}: RowProps & {
  problem: string | null
  flip: Flip | null
  /** A write is in flight: the buttons do nothing until it settles. */
  waiting: boolean
  /** That write is this row's. */
  pending: boolean
  onToggle?: (item: IngredientBar) => void
  onUndo: () => void
  buttonRef: (button: HTMLButtonElement | null) => void
}) {
  const desktop = useIsDesktop()
  const location = useLocation()
  const bar = row.ingredient.bar ?? null
  return (
    <li className="ingredient ingredient--drink">
      <div className="ingredient-line">
        <Amount {...row} />
        <span className="ingredient-name">
          <ItemText ingredient={row.ingredient} />
          {bar?.recipe && (
            <Link
              to={`/drinks/${encodeURIComponent(bar.recipe.slug)}`}
              state={location.state}
              className="ingredient-recipe"
            >
              {bar.state === 'dont' ? 'Out? Make it: ' : 'Recipe: '}
              {bar.recipe.name}
              <Chevron size={14} strokeWidth={2.25} />
            </Link>
          )}
        </span>
        {bar && !bar.tracked ? (
          <span className="ingredient-fresh">
            <Basket size={16} strokeWidth={2} />
            {desktop ? 'Fresh, buy when needed' : 'Fresh'}
          </span>
        ) : (
          bar &&
          onToggle && (
            <StateButton
              bar={bar}
              desktop={desktop}
              waiting={waiting}
              pending={pending}
              buttonRef={buttonRef}
              onClick={() => onToggle(bar)}
            />
          )
        )}
      </div>
      {problem && (
        <p role="alert" className="recipe-error ingredient-problem">
          {problem}
        </p>
      )}
      {flip && (
        <div role="status" className="ingredient-undo">
          <span>{flip.now === 'have' ? 'Marked as in the bar.' : 'Marked as not in the bar.'}</span>
          <button type="button" aria-disabled={waiting || undefined} onClick={onUndo}>
            Undo
          </button>
        </div>
      )}
    </li>
  )
}

/** One button for every state, so focus stays on it as the state flips. */
function StateButton({
  bar,
  desktop,
  waiting,
  pending,
  buttonRef,
  onClick,
}: {
  bar: IngredientBar
  desktop: boolean
  waiting: boolean
  pending: boolean
  buttonRef: (button: HTMLButtonElement | null) => void
  onClick: () => void
}) {
  const name = capitalise(bar.item)
  const verb = desktop ? 'Click' : 'Tap'
  const look =
    bar.state === 'have'
      ? {
          kind: 'have',
          icon: <Check size={15} strokeWidth={2.75} />,
          text: 'In the bar',
          label: `${name} is in the bar. ${verb} if you've run out.`,
        }
      : bar.state === 'dont'
        ? {
            kind: 'dont',
            icon: <MinusCircle size={15} />,
            text: desktop ? 'Not in the bar' : 'Not in bar',
            label: `${name} is not in the bar. ${verb} when you have it.`,
          }
        : {
            kind: 'unsorted',
            icon: <Question size={15} strokeWidth={2} />,
            text: 'Not sorted',
            label: `${name} is not sorted yet. ${verb} when you have it.`,
          }
  return (
    <button
      ref={buttonRef}
      type="button"
      // aria-disabled, not disabled, so focus stays on the button while its write is out.
      className={`ingredient-state ingredient-state--${look.kind}${pending ? ' ingredient-state--pending' : ''}`}
      aria-label={look.label}
      aria-disabled={waiting || undefined}
      aria-busy={pending || undefined}
      onClick={onClick}
    >
      {look.icon}
      {look.text}
    </button>
  )
}
