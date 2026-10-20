// One recipe in the browse page, three ways: a grid card, a phone list row and a
// desktop table row. All are links to the recipe. Drinks also wear what the bar
// says about them; food wears what is missing for a "what you have" list.

import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { badge } from './bar'
import { MARK_LABELS, type FilterMark } from './browse'
import { capitalise, formatTime } from './format'
import { Basket, Bookmark, Check, Chevron, Clock, Heart, MinusCircle, Question, Star } from './icons'
import { haveBadge } from './haveBadge'
import { PhotoTile } from './PhotoTile'
import type { DrinkStatus, RecipeSummary } from './types'
import { useIsDesktop } from './useIsDesktop'

// Only these marks show on cards, in this order.
const CARD_MARKS: readonly FilterMark[] = ['favourite', 'try_next']

function MarkIcons({ recipe, size }: { recipe: RecipeSummary; size: number }) {
  const shown = CARD_MARKS.filter((mark) => recipe.marks.includes(mark))
  return (
    <span className="marks">
      {shown.map((mark) => {
        const label = MARK_LABELS[mark]
        if (mark === 'favourite') return <Heart key={mark} filled size={size} aria-label={label} />
        return <Bookmark key={mark} filled size={size} aria-label={label} />
      })}
    </span>
  )
}

/** The star and rating, "4.5"; nothing when the recipe is unrated. */
function RatingBadge({ rating, size }: { rating: number | null; size: number }) {
  if (rating === null) return null
  const text = rating.toFixed(1)
  return (
    <span className="recipe-rating" role="img" aria-label={`Rated ${text} out of 5`}>
      <Star filled size={size} />
      {text}
    </span>
  )
}

const BADGE_ICONS: Record<DrinkStatus | 'also', () => ReactNode> = {
  can_make: () => <Check size={15} strokeWidth={2.5} />,
  also: () => <Basket size={15} strokeWidth={2} />,
  missing: () => <MinusCircle size={15} />,
  unsorted: () => <Question size={15} strokeWidth={2} />,
}

/** "Can make now", "Missing: orgeat" and so on, with an icon; nothing on food. */
function BarBadge({ recipe }: { recipe: RecipeSummary }) {
  const desktop = useIsDesktop()
  if (!recipe.bar) return null
  const { kind, text } = badge(recipe.bar, !desktop)
  return (
    <span className={`bar-badge bar-badge--${kind}`}>
      {BADGE_ICONS[kind]()}
      <span>{text}</span>
    </span>
  )
}

/** "Have everything" or "Missing: a, b +2" when the list came with "what you have" terms. */
function HaveBadge({ recipe }: { recipe: RecipeSummary }) {
  if (!recipe.have) return null
  const { text, label, complete } = haveBadge(recipe.have)
  return (
    <span
      className={`bar-badge bar-badge--${complete ? 'have_all' : 'have_missing'}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {complete ? <Check size={15} strokeWidth={2.5} /> : <MinusCircle size={15} />}
      <span>{text}</span>
    </span>
  )
}

const href = (recipe: RecipeSummary) => `/${recipe.side}/${encodeURIComponent(recipe.slug)}`

/** The recipe page's back link returns to the browse query the visitor came from. */
function useBrowseState() {
  return { browse: useLocation().search }
}

export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const state = useBrowseState()
  return (
    <Link to={href(recipe)} state={state} className="recipe-card">
      <div className="recipe-card-photo">
        <PhotoTile
          side={recipe.side}
          slug={recipe.slug}
          category={recipe.category}
          image={recipe.image}
          size="card"
        />
        <BarBadge recipe={recipe} />
        <HaveBadge recipe={recipe} />
      </div>
      <div className="recipe-card-body">
        <div className="recipe-card-eyebrow">{capitalise(recipe.category)}</div>
        <div className="recipe-card-name">{recipe.name}</div>
        <div className="recipe-card-rule" aria-hidden="true" />
        <div className="recipe-card-meta">
          {recipe.time_minutes !== null && (
            <span className="recipe-time">
              <Clock />
              {formatTime(recipe.time_minutes)}
            </span>
          )}
          <RatingBadge rating={recipe.rating} size={16} />
          <span className="recipe-card-spacer" />
          <MarkIcons recipe={recipe} size={18} />
        </div>
      </div>
    </Link>
  )
}

/** The phone's list mode. */
export function RecipeRow({ recipe }: { recipe: RecipeSummary }) {
  const state = useBrowseState()
  return (
    <Link to={href(recipe)} state={state} className="recipe-row">
      <PhotoTile
        side={recipe.side}
        slug={recipe.slug}
        category={recipe.category}
        image={recipe.image}
        size="row"
      />
      <div className="recipe-row-text">
        <span className="recipe-row-name">{recipe.name}</span>
        <span className="recipe-row-sub">
          {recipe.time_minutes !== null && <span>{formatTime(recipe.time_minutes)}</span>}
          <RatingBadge rating={recipe.rating} size={14} />
        </span>
        <BarBadge recipe={recipe} />
        <HaveBadge recipe={recipe} />
      </div>
      <MarkIcons recipe={recipe} size={18} />
    </Link>
  )
}

/** The desktop's list mode: photo, name and category, time, marks. */
export function RecipeTableRow({ recipe }: { recipe: RecipeSummary }) {
  const state = useBrowseState()
  return (
    <Link to={href(recipe)} state={state} className="recipe-table-row">
      <PhotoTile
        side={recipe.side}
        slug={recipe.slug}
        category={recipe.category}
        image={recipe.image}
        size="row"
      />
      <div className="recipe-table-name">
        <span>{recipe.name}</span>
        <span className="recipe-table-sub">
          <span>{capitalise(recipe.category)}</span>
          <RatingBadge rating={recipe.rating} size={14} />
        </span>
        <BarBadge recipe={recipe} />
        <HaveBadge recipe={recipe} />
      </div>
      <span className="recipe-time">
        {recipe.time_minutes !== null && (
          <>
            <Clock />
            {formatTime(recipe.time_minutes)}
          </>
        )}
      </span>
      <MarkIcons recipe={recipe} size={20} />
      <Chevron className="recipe-table-chevron" />
    </Link>
  )
}
