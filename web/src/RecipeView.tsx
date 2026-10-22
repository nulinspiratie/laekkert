// The recipe page: hero, title block, tags, marks and rating, the ingredients card, the
// method, the notes, the source and the History. Layout follows RecipeDesktop and RecipePhone.

import { Fragment, useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { addEntry, changeBar, getRecipe, getTimeline, recipeImageUrl, restoreVersion, setMarks, setTags } from './api'
import { messageOf as barMessageOf, withBar } from './bar'
import { browseQuery, MARK_LABELS, type DrinksView, type FilterMark } from './browse'
import { capitalise, formatTime } from './format'
import { runs } from './groups'
import { Back, Bookmark, Check, Clock, Edit, Heart, People, Plus } from './icons'
import { History } from './History'
import { Ingredients } from './Ingredients'
import { Notes } from './Notes'
import { PhotoTile } from './PhotoTile'
import { Shell } from './Shell'
import { Stars } from './Stars'
import { TagPicker } from './TagPicker'
import {
  SIDE_LABELS,
  type BarChanges,
  type BarState,
  type NewEntry,
  type Recipe,
  type Side,
  type Step,
  type TimelineEntry,
} from './types'
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

/**
 * A failed action: the sentence to show, and which part of the page it belongs to. A bar
 * write names its item, so the sentence shows at that ingredient.
 */
interface Problem {
  area: 'head' | 'history' | 'bar'
  message: string
  item?: string
}

/** The change that gives an item this state; null is unsorted. */
function barChange(item: string, state: BarState | null): BarChanges {
  if (state === 'have') return { have: [item] }
  return state === 'dont' ? { dont_have: [item] } : { unsorted: [item] }
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
  const [picking, setPicking] = useState(false)
  const addTags = useRef<HTMLButtonElement>(null)
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

  /** Runs a write; the page takes the recipe it returns and, unless it was the bar, reloads the timeline. */
  const perform = async (
    area: Problem['area'],
    request: () => Promise<Recipe>,
    item?: string,
  ): Promise<boolean> => {
    if (writing.current) return false
    writing.current = true
    setBusy(true)
    // A bar write does not reload the timeline, so a History problem stays.
    setProblem((current) => (area === 'bar' && current?.area === 'history' ? current : null))
    try {
      onRecipe(await request())
      if (area !== 'bar') void refresh()
      return true
    } catch (err) {
      setProblem({ area, message: area === 'bar' ? barMessageOf(err) : messageOf(err), item })
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

  const closePicker = ({ add, remove }: { add: string[]; remove: string[] }) => {
    setPicking(false)
    addTags.current?.focus()
    if (add.length > 0 || remove.length > 0) void perform('head', () => setTags(side, slug, add, remove))
  }

  /** Sets an item's state, then reloads the drink so every row and the summary are fresh. */
  const setBarState = (item: string, state: BarState | null) =>
    perform(
      'bar',
      async () => {
        const bar = await changeBar(barChange(item, state))
        // The write worked: if the reload fails, the bar it returned stands in.
        const reloaded = await getRecipe(side, slug).catch(() => null)
        return reloaded ?? withBar(recipe, bar)
      },
      item,
    )

  const editHref = `/${side}/${encodeURIComponent(slug)}/edit`
  // A tag shows the drinks view that holds this recipe: All drinks has no syrups or prep.
  const tagView: DrinksView | null =
    side !== 'drinks' ? null : recipe.category === 'syrups' || recipe.category === 'prep' ? 'syrups' : 'all'

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
          {/* Food tags are set here too; drinks only show theirs. */}
          {(recipe.tags.length > 0 || side === 'food') && (
            <div className="recipe-tags-row">
              <ul className="recipe-tags" aria-label="Tags">
                {recipe.tags.map((tag) => (
                  <li key={tag}>
                    <Link to={`/${side}?${browseQuery({ q: '', category: null, marks: [], tags: [tag], sort: 'name', show: tagView, have: [] })}`}>
                      {tag}
                    </Link>
                  </li>
                ))}
                {side === 'food' && (
                  <li>
                    <button
                      ref={addTags}
                      type="button"
                      className="tag-add"
                      aria-label={recipe.tags.length > 0 ? 'Edit tags' : undefined}
                      aria-expanded={picking}
                      aria-haspopup="dialog"
                      disabled={busy}
                      onClick={() => setPicking(true)}
                    >
                      <Plus size={18} />
                      {recipe.tags.length === 0 && 'Add tags'}
                    </button>
                  </li>
                )}
              </ul>
              {picking && (
                <TagPicker own={recipe.tags} category={recipe.category} desktop={desktop} onClose={closePicker} />
              )}
            </div>
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
        <Ingredients
          ingredients={recipe.ingredients}
          servings={recipe.servings}
          side={side}
          bar={recipe.bar ?? undefined}
          onBar={side === 'drinks' ? setBarState : undefined}
          busy={busy}
          barError={
            problem?.area === 'bar' && problem.item !== undefined ? { item: problem.item, message: problem.message } : null
          }
        />
        <div className="recipe-side">
          <Method steps={recipe.steps} />
          <Notes text={recipe.notes} />
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

function Method({ steps }: { steps: Step[] }) {
  const headingId = useId()
  if (steps.length === 0) return null
  return (
    <section className="method" aria-labelledby={headingId}>
      <h2 id={headingId}>Method</h2>
      {runs(steps).map((run) => (
        <Fragment key={run.start}>
          {run.group !== '' && <h3 className="group-heading">{run.group}</h3>}
          {run.group === '' && run.start > 0 && <hr className="group-rule" />}
          {/* Numbers run on across the groups, so each list starts where the last one stopped. */}
          <ol start={run.start + 1}>
            {run.items.map((step, k) => (
              <li key={run.start + k}>
                <span className="method-number" aria-hidden="true">
                  {run.start + k + 1}
                </span>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </Fragment>
      ))}
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
