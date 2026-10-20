// The recipe page: hero, title block, tags and marks, the ingredients card, the
// method and the source. Read-only in M1; layout follows RecipeDesktop and RecipePhone.

import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { getRecipe, recipeImageUrl } from './api'
import { browseQuery, MARK_LABELS } from './browse'
import { capitalise, formatTime } from './format'
import { Back, Bookmark, Check, Clock, Close, Heart, Kid, People } from './icons'
import { Ingredients } from './Ingredients'
import { PhotoTile } from './PhotoTile'
import { Shell } from './Shell'
import { SIDE_LABELS, type Mark, type Recipe, type Side } from './types'
import { useIsDesktop } from './useIsDesktop'

// The marks the page shows, in this order.
const MARK_ORDER: readonly Mark[] = ['favourite', 'kid_approved', 'try_next', 'tried', 'kid_rejected']

const PAGE_MARK_LABELS: Record<Mark, string> = {
  ...MARK_LABELS,
  tried: 'Tried',
  kid_rejected: 'Kids rejected',
}

function MarkIcon({ mark }: { mark: Mark }) {
  switch (mark) {
    case 'favourite':
      return <Heart filled size={18} />
    case 'kid_approved':
      return <Kid size={18} />
    case 'try_next':
      return <Bookmark filled size={18} />
    case 'tried':
      return <Check />
    case 'kid_rejected':
      return <Close size={18} />
  }
}

export function RecipeView({ side, slug }: { side: Side; slug: string }) {
  // undefined while loading, null when the API says 404.
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getRecipe(side, slug).then(
      (r) => live && setRecipe(r),
      (err: Error) => live && setError(err.message),
    )
    return () => {
      live = false
    }
  }, [side, slug])

  // The back button is part of the recipe's hero, so a failed page has its own way out.
  const failure = (message: ReactNode) => (
    <Shell side={side} phoneBar={false}>
      <div className="recipe-failure gutter">
        {message}
        <BackLink side={side} />
      </div>
    </Shell>
  )

  if (error) return failure(<p role="alert">{error}</p>)
  if (recipe === null) return failure(<p>Not found</p>)
  if (recipe === undefined) return <Shell side={side} phoneBar={false}>{null}</Shell>
  return (
    <Shell side={side} phoneBar={false}>
      <Page recipe={recipe} />
    </Shell>
  )
}

function BackLink({ side, round = false }: { side: Side; round?: boolean }) {
  const location = useLocation()
  const state: unknown = location.state
  const browse =
    typeof state === 'object' && state !== null && 'browse' in state && typeof state.browse === 'string'
      ? state.browse
      : ''
  const label = SIDE_LABELS[side]
  return (
    <Link
      to={`/${side}${browse}`}
      className={round ? 'round-btn recipe-back-round' : 'recipe-back'}
      aria-label={`Back to ${label}`}
    >
      <Back />
      {!round && label}
    </Link>
  )
}

function Page({ recipe }: { recipe: Recipe }) {
  const desktop = useIsDesktop()
  const { side } = recipe
  const time = recipe.time_minutes === null ? null : formatTime(recipe.time_minutes)
  const marks = MARK_ORDER.filter((mark) => recipe.marks.includes(mark))

  return (
    <article className="recipe">
      {desktop && (
        <div className="recipe-nav">
          <BackLink side={side} />
        </div>
      )}
      <div className="recipe-top">
        <div className="recipe-hero">
          <PhotoTile
            side={side}
            slug={recipe.slug}
            category={recipe.category}
            image={recipe.image}
            size="hero"
          />
          {!desktop && <BackLink side={side} round />}
        </div>
        <div className="recipe-head gutter">
          <div className="recipe-title-block">
            {desktop ? (
              <div className="recipe-eyebrow">{capitalise(recipe.category)}</div>
            ) : (
              <div className="recipe-eyebrow">
                {[capitalise(recipe.category), time, `Serves ${recipe.servings}`]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
            <h1>{recipe.name}</h1>
            {desktop && (
              <div className="recipe-meta">
                {time && (
                  <span>
                    <Clock size={18} />
                    {time}
                  </span>
                )}
                <span>
                  <People size={18} />
                  Serves {recipe.servings}
                </span>
              </div>
            )}
          </div>
          {recipe.tags.length > 0 && (
            <ul className="recipe-tags" aria-label="Tags">
              {recipe.tags.map((tag) => (
                <li key={tag}>
                  <Link to={`/${side}?${browseQuery({ q: '', category: null, marks: [], tags: [tag], sort: 'name' })}`}>
                    {tag}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {marks.length > 0 && (
            <ul className="recipe-marks" aria-label="Marks">
              {marks.map((mark) => (
                <li key={mark}>
                  <MarkIcon mark={mark} />
                  {PAGE_MARK_LABELS[mark]}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="recipe-body gutter">
        <Ingredients ingredients={recipe.ingredients} servings={recipe.servings} />
        <div className="recipe-side">
          <Method steps={recipe.steps} />
          <Source recipe={recipe} />
        </div>
      </div>
    </article>
  )
}

function Method({ steps }: { steps: string[] }) {
  const headingId = useId()
  if (steps.length === 0) return null
  return (
    <section className="method" aria-labelledby={headingId}>
      <h2 id={headingId}>Method</h2>
      <ol>
        {steps.map((step, i) => (
          <li key={i}>
            <span className="method-number" aria-hidden="true">
              {i + 1}
            </span>
            <p>{step}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** A web address worth linking, or null for anything else (never a javascript: URL). */
function webAddress(url: string): { href: string; host: string } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return { href: parsed.href, host: parsed.hostname.replace(/^www\./, '') }
  } catch {
    return null
  }
}

function Source({ recipe }: { recipe: Recipe }) {
  const headingId = useId()
  const { source } = recipe
  if (!source || (!source.url && !source.photo)) return null
  const web = source.url ? webAddress(source.url) : null
  const photoUrl = source.photo ? recipeImageUrl(recipe.side, recipe.slug, source.photo) : null
  return (
    <section className="source" aria-labelledby={headingId}>
      {photoUrl && <img className="source-thumb" src={photoUrl} alt="" loading="lazy" />}
      <div className="source-text">
        <h2 id={headingId}>Source</h2>
        {source.url &&
          (web ? (
            <a href={web.href} target="_blank" rel="noreferrer" className="source-link">
              {web.host}
            </a>
          ) : (
            <span className="source-plain">{source.url}</span>
          ))}
        {photoUrl && <span className="source-plain">Photo of the original</span>}
      </div>
      {photoUrl && (
        <a href={photoUrl} target="_blank" rel="noreferrer" className="source-action">
          View photo
        </a>
      )}
    </section>
  )
}
