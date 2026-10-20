// One recipe in the browse page, three ways: a grid card, a phone list row and a
// desktop table row. All are links to the recipe.

import { Link, useLocation } from 'react-router'
import { MARK_LABELS, type FilterMark } from './browse'
import { capitalise, formatTime } from './format'
import { Bookmark, Chevron, Clock, Heart, Kid } from './icons'
import { PhotoTile } from './PhotoTile'
import type { RecipeSummary } from './types'

// Only these marks show on cards in M1, in this order.
const CARD_MARKS: readonly FilterMark[] = ['favourite', 'kid_approved', 'try_next']

function MarkIcons({ recipe, size }: { recipe: RecipeSummary; size: number }) {
  const shown = CARD_MARKS.filter((mark) => recipe.marks.includes(mark))
  return (
    <span className="marks">
      {shown.map((mark) => {
        const label = MARK_LABELS[mark]
        if (mark === 'favourite') return <Heart key={mark} filled size={size} aria-label={label} />
        if (mark === 'kid_approved') return <Kid key={mark} size={size} aria-label={label} />
        return <Bookmark key={mark} filled size={size} aria-label={label} />
      })}
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
      <PhotoTile
        side={recipe.side}
        slug={recipe.slug}
        category={recipe.category}
        image={recipe.image}
        size="card"
      />
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
        {recipe.time_minutes !== null && (
          <span className="recipe-row-time">{formatTime(recipe.time_minutes)}</span>
        )}
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
        <span className="recipe-table-category">{capitalise(recipe.category)}</span>
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
