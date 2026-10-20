// The recipe page: hero, title block, tags, marks and rating, the ingredients card, the
// method, the source and the History. Layout follows RecipeDesktop and RecipePhone.

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { addEntry, getRecipe, getTimeline, recipeImageUrl, restoreVersion, setMarks } from './api'
import { browseQuery, MARK_LABELS, type FilterMark } from './browse'
import { capitalise, formatTime } from './format'
import { Back, Bookmark, Check, Clock, Edit, Heart, People } from './icons'
import { History } from './History'
import { Ingredients } from './Ingredients'
import { PhotoTile } from './PhotoTile'
import { Shell } from './Shell'
import { Stars } from './Stars'
import { SIDE_LABELS, type NewEntry, type Recipe, type Side, type TimelineEntry } from './types'
import { useIsDesktop } from './useIsDesktop'

// The two marks the page toggles, in this order. Tried is status only: a tasting sets it.
const TOGGLE_MARKS: readonly FilterMark[] = ['favourite', 'try_next']

function MarkIcon({ mark, filled }: { mark: FilterMark; filled: boolean }) {
  return mark === 'favourite' ? <Heart filled={filled} size={20} /> : <Bookmark filled={filled} size={20} />
}

interface Timeline {
  entries: TimelineEntry[]
  current_version: number | null
}

/** A failed action: the sentence to show, and which part of the page it belongs to. */
interface Problem {
  area: 'head' | 'history'
  message: string
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
      <Page key={`${side}/${slug}`} recipe={recipe} onRecipe={setRecipe} />
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

function Page({ recipe, onRecipe }: { recipe: Recipe; onRecipe: (recipe: Recipe) => void }) {
  const desktop = useIsDesktop()
  const { side, slug } = recipe
  const time = recipe.time_minutes === null ? null : formatTime(recipe.time_minutes)
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [busy, setBusy] = useState(false)
  // The state above disables the buttons; the ref also stops a second call in the same tick.
  const writing = useRef(false)

  const messageOf = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

  const refresh = useCallback(async () => {
    try {
      setTimeline(await getTimeline(side, slug))
    } catch (err) {
      setProblem({ area: 'history', message: messageOf(err) })
    }
  }, [side, slug])

  useEffect(() => {
    let live = true
    getTimeline(side, slug).then(
      (loaded) => live && setTimeline(loaded),
      (err: unknown) => live && setProblem({ area: 'history', message: messageOf(err) }),
    )
    return () => {
      live = false
    }
  }, [side, slug])

  /** Runs a write; the page takes the recipe it returns and reloads the timeline. */
  const perform = async (area: Problem['area'], request: () => Promise<Recipe>): Promise<boolean> => {
    if (writing.current) return false
    writing.current = true
    setBusy(true)
    setProblem(null)
    try {
      onRecipe(await request())
      void refresh()
      return true
    } catch (err) {
      setProblem({ area, message: messageOf(err) })
      return false
    } finally {
      writing.current = false
      setBusy(false)
    }
  }

  const post = (area: Problem['area'], entry: NewEntry) =>
    perform(area, async () => (await addEntry(side, slug, entry)).recipe)

  const toggle = (mark: FilterMark) => {
    const on = recipe.marks.includes(mark)
    void perform('head', () => setMarks(side, slug, on ? [] : [mark], on ? [mark] : []))
  }

  const editHref = `/${side}/${encodeURIComponent(slug)}/edit`

  return (
    <article className="recipe">
      {desktop && (
        <div className="recipe-nav">
          <BackLink side={side} />
          <Link to={editHref} className="recipe-edit">
            <Edit size={18} />
            Edit
          </Link>
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
          {!desktop && (
            <Link to={editHref} className="round-btn recipe-edit-round" aria-label="Edit recipe">
              <Edit />
            </Link>
          )}
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
                  <Link to={`/${side}?${browseQuery({ q: '', category: null, marks: [], tags: [tag], sort: 'name', bar: null })}`}>
                    {tag}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="recipe-marks" role="group" aria-label="Marks">
            {TOGGLE_MARKS.map((mark) => {
              const on = recipe.marks.includes(mark)
              return (
                <button
                  key={mark}
                  type="button"
                  className="mark-toggle"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => toggle(mark)}
                >
                  <MarkIcon mark={mark} filled={on} />
                  {MARK_LABELS[mark]}
                </button>
              )
            })}
            {recipe.marks.includes('tried') && (
              <span className="recipe-tried">
                <Check />
                Tried
              </span>
            )}
          </div>
          <div className="recipe-rate">
            <span className="recipe-rate-label" aria-hidden="true">
              Rating
            </span>
            <Stars
              value={recipe.rating}
              label="Rating"
              disabled={busy}
              onRate={(rating) => void post('head', { kind: 'rating', rating })}
            />
            <span className="recipe-rate-text">
              {recipe.rating === null ? 'Not rated yet' : recipe.rating.toFixed(1)}
            </span>
          </div>
          <MadeIt busy={busy} onSave={(entry) => post('head', entry)} />
          {problem?.area === 'head' && (
            <p role="alert" className="recipe-error">
              {problem.message}
            </p>
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
      <div className="recipe-history gutter">
        <History
          entries={timeline?.entries ?? []}
          currentVersion={timeline?.current_version ?? null}
          compact={!desktop}
          busy={busy}
          error={problem?.area === 'history' ? problem.message : null}
          onNote={(text) => post('history', { kind: 'note', text })}
          onRestore={(version) => void perform('history', () => restoreVersion(side, slug, version))}
        />
      </div>
    </article>
  )
}

/** The "Made it" button and its inline form: optional stars and note, kept until Save works. */
function MadeIt({ busy, onSave }: { busy: boolean; onSave: (entry: NewEntry) => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const close = () => {
    setOpen(false)
    setRating(null)
    setNote('')
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const text = note.trim()
    const entry: NewEntry = {
      kind: 'made',
      ...(rating !== null && { rating }),
      ...(text && { note: text }),
    }
    if (await onSave(entry)) close()
  }

  if (!open) {
    return (
      <button type="button" className="made-it-btn" aria-expanded="false" onClick={() => setOpen(true)}>
        <Check />
        Made it
      </button>
    )
  }
  return (
    <form className="made-it-form" aria-label="Made it" onSubmit={save}>
      <Stars value={rating} label="Your rating" onRate={setRating} />
      <label className="made-it-note">
        <span>Note</span>
        <textarea
          rows={2}
          value={note}
          placeholder="What worked, what you would change (optional)"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="made-it-actions">
        <button type="submit" className="made-it-save" disabled={busy}>
          Save
        </button>
        <button type="button" className="made-it-cancel" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
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
