// The recipe editor, for new and existing recipes. Desktop follows EditorDesktop; the
// phone is one column with Cancel and Save in a fixed bottom bar. The pure parts (state,
// validation, the draft) are in editor.ts.

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { createRecipe, deleteRecipe, getRecipe, recipeImageUrl, updateRecipe, uploadImage } from './api'
import { CATEGORIES } from './browse'
import {
  blankRow,
  blankStep,
  emptyState,
  isDirty,
  move,
  stateFromRecipe,
  toDraft,
  UNITS,
  validate,
  type BadInput,
  type EditorRow,
  type EditorState,
  type SourceMode,
} from './editor'
import { capitalise } from './format'
import { Back, Check, Chevron, Close, Plus } from './icons'
import { PhotoTile } from './PhotoTile'
import { Shell } from './Shell'
import { isSide, SIDE_LABELS, type Recipe, type Side } from './types'
import { useIsDesktop } from './useIsDesktop'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif'

type Slot = 'image' | 'sourcePhoto'

const messageOf = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

/** The route component: `/:side/new` (mode "new") and `/:side/:slug/edit` (mode "edit"). */
export function Editor({ mode }: { mode: 'new' | 'edit' }) {
  const { side, slug } = useParams()
  if (!isSide(side)) return <p>Not found</p>
  if (mode === 'new') return <Form key={side} side={side} recipe={null} />
  if (!slug) return <p>Not found</p>
  return <Loader key={`${side}/${slug}`} side={side} slug={slug} />
}

function Loader({ side, slug }: { side: Side; slug: string }) {
  // undefined while loading, null when the API says 404.
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getRecipe(side, slug).then(
      (r) => live && setRecipe(r),
      (err: unknown) => live && setError(messageOf(err)),
    )
    return () => {
      live = false
    }
  }, [side, slug])

  if (error || recipe === null) {
    return (
      <Shell side={side} phoneBar={false}>
        <div className="recipe-failure gutter">
          {error ? <p role="alert">{error}</p> : <p>Not found</p>}
          <Link to={`/${side}`} className="recipe-back" aria-label={`Back to ${SIDE_LABELS[side]}`}>
            <Back />
            {SIDE_LABELS[side]}
          </Link>
        </div>
      </Shell>
    )
  }
  if (recipe === undefined) return <Shell side={side} phoneBar={false}>{null}</Shell>
  return <Form side={side} recipe={recipe} />
}

function Form({ side, recipe }: { side: Side; recipe: Recipe | null }) {
  const desktop = useIsDesktop()
  const navigate = useNavigate()
  const slug = recipe?.slug ?? null
  const [initial] = useState(() => (recipe ? stateFromRecipe(recipe) : emptyState(side)))
  const [state, setState] = useState<EditorState>(initial)
  const [tagText, setTagText] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  // True while a save or delete runs. The ref also stops a second tap in the same tick.
  const [busy, setBusy] = useState(false)
  const working = useRef(false)

  // Previews of the photos picked here: the ones in use, and the ones still uploading.
  const [local, setLocal] = useState<Record<Slot, string | null>>({ image: null, sourcePhoto: null })
  const [uploading, setUploading] = useState<Record<Slot, string | null>>({ image: null, sourcePhoto: null })
  const localNow = useRef<Record<Slot, string | null>>({ image: null, sourcePhoto: null })
  const objectUrls = useRef(new Set<string>())

  const release = (url: string | null) => {
    if (url && objectUrls.current.delete(url)) URL.revokeObjectURL(url)
  }
  useEffect(() => {
    const urls = objectUrls.current
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    }
  }, [])

  const setPreview = (slot: Slot, url: string | null) => {
    release(localNow.current[slot])
    localNow.current = { ...localNow.current, [slot]: url }
    setLocal(localNow.current)
  }

  const pick = async (slot: Slot, file: File) => {
    const url = URL.createObjectURL(file)
    objectUrls.current.add(url)
    setUploading((u) => ({ ...u, [slot]: url }))
    setProblems([])
    try {
      const name = await uploadImage(file)
      setState((s) => ({ ...s, [slot]: name }))
      setPreview(slot, url)
    } catch (err) {
      release(url)
      setProblems([messageOf(err)])
    } finally {
      setUploading((u) => ({ ...u, [slot]: null }))
    }
  }

  const clearImage = () => {
    setPreview('image', null)
    setState((s) => ({ ...s, image: null }))
  }

  const uploadRunning = uploading.image !== null || uploading.sourcePhoto !== null

  // A tag typed but not yet added still counts.
  const withPendingTag = (s: EditorState): EditorState => {
    const tag = normalTag(tagText)
    return tag && !s.tags.includes(tag) ? { ...s, tags: [...s.tags, tag] } : s
  }
  const dirty = isDirty(initial, state) || tagText.trim() !== ''

  // Ask before a reload or tab close loses changes. `leave` removes it first.
  const guard = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!dirty) return
    const ask = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', ask)
    const remove = () => window.removeEventListener('beforeunload', ask)
    guard.current = remove
    return () => {
      remove()
      guard.current = null
    }
  }, [dirty])

  // Set once the form is deliberately left (saved, deleted, or Cancel confirmed), so the
  // blocker below does not ask a second time.
  const leaving = useRef(false)
  const leave = (to: string, replace = false) => {
    leaving.current = true
    guard.current?.()
    navigate(to, { replace })
  }

  // Any other way out (the back gesture, the header links) asks first.
  const blocker = useBlocker(() => dirty && !leaving.current)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm('Discard your changes?')) blocker.proceed()
    else blocker.reset()
  }, [blocker])

  const servingsBox = useRef<HTMLInputElement>(null)
  const timeBox = useRef<HTMLInputElement>(null)

  const alertRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (problems.length > 0) alertRef.current?.scrollIntoView?.({ block: 'center' })
  }, [problems])

  const save = async () => {
    if (working.current || uploadRunning) return
    const next = withPendingTag(state)
    const bad: BadInput = {
      servings: servingsBox.current?.validity.badInput,
      time: timeBox.current?.validity.badInput,
    }
    const found = validate(next, bad)
    if (found.length > 0) {
      setProblems(found)
      return
    }
    working.current = true
    setBusy(true)
    setProblems([])
    try {
      const draft = toDraft(next)
      const saved =
        recipe && slug ? await updateRecipe(side, slug, draft, recipe.version) : await createRecipe(side, draft)
      // Left set: the form is going away, and a second tap must not save again.
      leave(`/${side}/${encodeURIComponent(saved.slug)}`, true)
    } catch (err) {
      setProblems([messageOf(err)])
      working.current = false
      setBusy(false)
    }
  }

  const cancel = () => {
    if (dirty && !window.confirm('Discard your changes?')) return
    leave(recipe && slug ? `/${side}/${encodeURIComponent(slug)}` : `/${side}`)
  }

  const remove = async () => {
    if (!recipe || !slug || working.current) return
    if (!window.confirm(`Delete “${recipe.name}”? It moves to the trash on the NAS.`)) return
    working.current = true
    setBusy(true)
    setProblems([])
    try {
      await deleteRecipe(side, slug)
      leave(`/${side}`, true)
    } catch (err) {
      setProblems([messageOf(err)])
      working.current = false
      setBusy(false)
    }
  }

  const patch = (changes: Partial<EditorState>) => setState((s) => ({ ...s, ...changes }))

  const photoSection = (
    <PhotoSection
      side={side}
      slug={slug}
      category={state.category}
      image={state.image}
      preview={uploading.image ?? local.image}
      uploading={uploading.image !== null}
      onPick={(file) => void pick('image', file)}
      onRemove={clearImage}
    />
  )
  const sourceSection = (
    <SourceSection
      state={state}
      side={side}
      slug={slug}
      preview={uploading.sourcePhoto ?? local.sourcePhoto}
      uploading={uploading.sourcePhoto !== null}
      onMode={(sourceMode) => patch({ sourceMode })}
      onUrl={(sourceUrl) => patch({ sourceUrl })}
      onPick={(file) => void pick('sourcePhoto', file)}
    />
  )
  const tagsSection = (
    <TagsSection
      tags={state.tags}
      text={tagText}
      onText={setTagText}
      onTags={(tags) => patch({ tags })}
    />
  )
  const basics = <Basics side={side} state={state} onChange={patch} servingsBox={servingsBox} timeBox={timeBox} />
  const ingredients = <Ingredients rows={state.rows} desktop={desktop} onRows={(rows) => patch({ rows })} />
  const steps = <Steps steps={state.steps} onSteps={(next) => patch({ steps: next })} />
  const deleteButton = recipe && (
    <button type="button" className="ed-delete" disabled={busy} onClick={() => void remove()}>
      Delete recipe
    </button>
  )

  const title = recipe ? 'Edit recipe' : 'New recipe'
  const saveDisabled = busy || uploadRunning
  const alert = problems.length > 0 && (
    <ul className="ed-alert" role="alert" ref={alertRef}>
      {problems.map((problem) => (
        <li key={problem}>{problem}</li>
      ))}
    </ul>
  )

  return (
    <Shell side={side} phoneBar={false}>
      <div className={`editor${desktop ? ' editor--desktop' : ' editor--phone'}`}>
        {desktop ? (
          <header className="ed-header">
            <button type="button" className="ed-header-cancel" onClick={cancel}>
              Cancel
            </button>
            <h1>{title}</h1>
            <button type="button" className="ed-save" disabled={saveDisabled} onClick={() => void save()}>
              <Check />
              Save
            </button>
          </header>
        ) : (
          <h1 className="ed-phone-title">{title}</h1>
        )}
        {alert}
        {desktop ? (
          <div className="ed-columns">
            <div className="ed-main">
              {basics}
              {ingredients}
              {steps}
            </div>
            <aside className="ed-aside">
              {photoSection}
              {sourceSection}
              {tagsSection}
              {deleteButton}
            </aside>
          </div>
        ) : (
          <div className="ed-main">
            {basics}
            {photoSection}
            {ingredients}
            {steps}
            {sourceSection}
            {tagsSection}
            {deleteButton}
          </div>
        )}
        {!desktop && (
          <div className="ed-bar" role="group" aria-label="Cancel or save">
            <button type="button" className="ed-bar-cancel" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="ed-save" disabled={saveDisabled} onClick={() => void save()}>
              <Check />
              Save
            </button>
          </div>
        )}
      </div>
    </Shell>
  )
}

function normalTag(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ').toLowerCase()
}

/** A label and one control; the control must take `id`. */
function Field({ label, children, className }: { label: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId()
  return (
    <div className={`ed-field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  )
}

function Basics({
  side,
  state,
  onChange,
  servingsBox,
  timeBox,
}: {
  side: Side
  state: EditorState
  onChange: (changes: Partial<EditorState>) => void
  servingsBox: RefObject<HTMLInputElement | null>
  timeBox: RefObject<HTMLInputElement | null>
}) {
  return (
    <section className="ed-card" aria-label="Basics">
      <Field label="Name" className="ed-field--name">
        {(id) => (
          <input id={id} type="text" value={state.name} onChange={(e) => onChange({ name: e.target.value })} />
        )}
      </Field>
      <div className="ed-basics-row">
        <Field label="Category">
          {(id) => (
            <select id={id} value={state.category} onChange={(e) => onChange({ category: e.target.value })}>
              {CATEGORIES[side].map((name) => (
                <option key={name} value={name}>
                  {capitalise(name)}
                </option>
              ))}
              {!CATEGORIES[side].includes(state.category) && <option value={state.category}>{state.category}</option>}
            </select>
          )}
        </Field>
        <Field label="Cooking time">
          {(id) => (
            <span className="ed-suffix">
              <input
                id={id}
                ref={timeBox}
                type="number"
                inputMode="numeric"
                min={0}
                value={state.time}
                onChange={(e) => onChange({ time: e.target.value })}
              />
              <span aria-hidden="true">min</span>
            </span>
          )}
        </Field>
        <Field label="Servings">
          {(id) => (
            <input
              id={id}
              ref={servingsBox}
              type="number"
              inputMode="numeric"
              min={1}
              value={state.servings}
              onChange={(e) => onChange({ servings: e.target.value })}
            />
          )}
        </Field>
      </div>
    </section>
  )
}

function MoveButtons({
  what,
  number,
  last,
  onMove,
  onRemove,
}: {
  what: 'ingredient' | 'step'
  number: number
  last: boolean
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <>
      <button
        type="button"
        className="ed-icon-btn"
        aria-label={`Move ${what} ${number} up`}
        disabled={number === 1}
        onClick={() => onMove(-1)}
      >
        <Chevron className="ed-up" />
      </button>
      <button
        type="button"
        className="ed-icon-btn"
        aria-label={`Move ${what} ${number} down`}
        disabled={last}
        onClick={() => onMove(1)}
      >
        <Chevron className="ed-down" />
      </button>
      <button type="button" className="ed-icon-btn" aria-label={`Remove ${what} ${number}`} onClick={onRemove}>
        <Close />
      </button>
    </>
  )
}

function Ingredients({
  rows,
  desktop,
  onRows,
}: {
  rows: EditorRow[]
  desktop: boolean
  onRows: (rows: EditorRow[]) => void
}) {
  const change = (key: string, changes: Partial<EditorRow>) =>
    onRows(rows.map((row) => (row.key === key ? { ...row, ...changes } : row)))
  return (
    <section className="ed-card" aria-labelledby="ed-ingredients">
      <h2 id="ed-ingredients">Ingredients</h2>
      <div className="ed-table">
        <div className="ed-head" aria-hidden="true">
          <span>Amount</span>
          <span>Unit</span>
          <span>Ingredient</span>
          <span>Note</span>
          <span>Don&apos;t scale</span>
          <span />
        </div>
        <ul className="ed-rows">
          {rows.map((row, index) => {
            const n = index + 1
            const amount = (
              <div className="ed-cell ed-cell--amount">
                <span className="ed-cap" aria-hidden="true">
                  Amount
                </span>
                <input
                  type="text"
                  aria-label={`Amount for ingredient ${n}`}
                  value={row.amount}
                  onChange={(e) => change(row.key, { amount: e.target.value })}
                />
                {row.original && row.amount.trim() === '' && (
                  <span className="ed-original">As written: {row.original}</span>
                )}
              </div>
            )
            const unit = (
              <div className="ed-cell ed-cell--unit">
                <span className="ed-cap" aria-hidden="true">
                  Unit
                </span>
                <select
                  aria-label={`Unit for ingredient ${n}`}
                  value={row.unit}
                  onChange={(e) => change(row.key, { unit: e.target.value as EditorRow['unit'] })}
                >
                  {UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>
            )
            const item = (
              <div className="ed-cell ed-cell--item">
                <span className="ed-cap" aria-hidden="true">
                  Ingredient
                </span>
                <input
                  type="text"
                  aria-label={`Ingredient ${n}`}
                  value={row.item}
                  onChange={(e) => change(row.key, { item: e.target.value })}
                />
              </div>
            )
            const note = (
              <div className="ed-cell ed-cell--note">
                <span className="ed-cap" aria-hidden="true">
                  Note
                </span>
                <input
                  type="text"
                  aria-label={`Note for ingredient ${n}`}
                  placeholder="Note"
                  value={row.note}
                  onChange={(e) => change(row.key, { note: e.target.value })}
                />
              </div>
            )
            const scale = (
              <div className="ed-cell ed-cell--scale">
                <button
                  type="button"
                  className="ed-toggle"
                  aria-label={`Don't scale ingredient ${n}`}
                  aria-pressed={row.no_scale}
                  onClick={() => change(row.key, { no_scale: !row.no_scale })}
                >
                  <span className="ed-box">{row.no_scale && <Check strokeWidth={2.5} size={20} />}</span>
                  <span className="ed-toggle-text">Don&apos;t scale</span>
                </button>
              </div>
            )
            const tools = (
              <div className="ed-cell ed-cell--tools">
                <MoveButtons
                  what="ingredient"
                  number={n}
                  last={index === rows.length - 1}
                  onMove={(delta) => onRows(move(rows, index, delta))}
                  onRemove={() => onRows(rows.filter((r) => r.key !== row.key))}
                />
              </div>
            )
            // The name comes first on a phone, where the card stacks it on top; the table
            // keeps the artboard's order. The DOM follows the visual order either way.
            return (
              <li key={row.key} className="ed-row">
                {desktop ? (
                  <>
                    {amount}
                    {unit}
                    {item}
                    {note}
                  </>
                ) : (
                  <>
                    {item}
                    {amount}
                    {unit}
                    {note}
                  </>
                )}
                {scale}
                {tools}
              </li>
            )
          })}
        </ul>
      </div>
      <button type="button" className="ed-add" onClick={() => onRows([...rows, blankRow()])}>
        <Plus />
        Add ingredient
      </button>
    </section>
  )
}

function Steps({
  steps,
  onSteps,
}: {
  steps: EditorState['steps']
  onSteps: (steps: EditorState['steps']) => void
}) {
  return (
    <section className="ed-card" aria-labelledby="ed-steps">
      <h2 id="ed-steps">Steps</h2>
      <ol className="ed-steps">
        {steps.map((step, index) => {
          const n = index + 1
          return (
            <li key={step.key} className="ed-step">
              <span className="ed-step-n" aria-hidden="true">
                {n}
              </span>
              <textarea
                aria-label={`Step ${n}`}
                rows={2}
                value={step.text}
                onChange={(e) => onSteps(steps.map((s) => (s.key === step.key ? { ...s, text: e.target.value } : s)))}
              />
              <div className="ed-step-tools">
                <MoveButtons
                  what="step"
                  number={n}
                  last={index === steps.length - 1}
                  onMove={(delta) => onSteps(move(steps, index, delta))}
                  onRemove={() => onSteps(steps.filter((s) => s.key !== step.key))}
                />
              </div>
            </li>
          )
        })}
      </ol>
      <button type="button" className="ed-add" onClick={() => onSteps([...steps, blankStep()])}>
        <Plus />
        Add step
      </button>
    </section>
  )
}

/** A hidden file input behind a button-looking label, so the picker opens on a tap. */
function FilePick({
  label,
  disabled,
  onPick,
}: {
  label: string
  disabled: boolean
  onPick: (file: File) => void
}) {
  return (
    <label className={`ed-btn ed-file${disabled ? ' ed-file--disabled' : ''}`}>
      {label}
      <input
        type="file"
        accept={ACCEPT}
        className="visually-hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Picking the same file again must still fire a change.
          e.target.value = ''
          if (file) onPick(file)
        }}
      />
    </label>
  )
}

function PhotoSection({
  side,
  slug,
  category,
  image,
  preview,
  uploading,
  onPick,
  onRemove,
}: {
  side: Side
  slug: string | null
  category: string
  image: string | null
  preview: string | null
  uploading: boolean
  onPick: (file: File) => void
  onRemove: () => void
}) {
  // A fresh pick shows its local preview (also while it uploads); a stored picture its URL.
  const src = preview ?? (image && slug ? recipeImageUrl(side, slug, image) : null)
  return (
    <section className="ed-card ed-card--aside" aria-labelledby="ed-photo">
      <h2 id="ed-photo">Photo</h2>
      {src ? (
        <div className="photo-tile photo-tile--card">
          <img src={src} alt="Photo preview" />
        </div>
      ) : (
        <PhotoTile side={side} slug="" category={category} image={null} size="card" />
      )}
      {uploading && <p role="status">Uploading…</p>}
      <div className="ed-btn-row">
        <FilePick label={src ? 'Replace photo' : 'Add photo'} disabled={uploading} onPick={onPick} />
        {src && (
          <button type="button" className="ed-btn" disabled={uploading} onClick={onRemove}>
            Remove photo
          </button>
        )}
      </div>
      <p className="ed-hint">Without a photo, the recipe shows a tile with a dish icon.</p>
    </section>
  )
}

const SOURCE_MODES: { mode: SourceMode; label: string }[] = [
  { mode: 'link', label: 'Link' },
  { mode: 'photo', label: 'Photo' },
  { mode: 'none', label: 'None' },
]

function SourceSection({
  state,
  side,
  slug,
  preview,
  uploading,
  onMode,
  onUrl,
  onPick,
}: {
  state: EditorState
  side: Side
  slug: string | null
  preview: string | null
  uploading: boolean
  onMode: (mode: SourceMode) => void
  onUrl: (url: string) => void
  onPick: (file: File) => void
}) {
  const urlId = useId()
  const photo = state.sourcePhoto
  const src = preview ?? (photo && slug ? recipeImageUrl(side, slug, photo) : null)
  return (
    <section className="ed-card ed-card--aside" aria-labelledby="ed-source">
      <h2 id="ed-source">Source</h2>
      <div className="ed-segmented" role="radiogroup" aria-label="Source type">
        {SOURCE_MODES.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={state.sourceMode === mode}
            onClick={() => onMode(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      {state.sourceMode === 'link' && (
        <div className="ed-field">
          <label htmlFor={urlId}>Source link</label>
          <input
            id={urlId}
            type="url"
            inputMode="url"
            placeholder="https://"
            value={state.sourceUrl}
            onChange={(e) => onUrl(e.target.value)}
          />
        </div>
      )}
      {state.sourceMode === 'photo' && (
        <div className="ed-source-photo">
          {src && <img src={src} alt="Source photo" />}
          {uploading && <p role="status">Uploading…</p>}
          <FilePick label={src ? 'Replace source photo' : 'Add source photo'} disabled={uploading} onPick={onPick} />
        </div>
      )}
    </section>
  )
}

function TagsSection({
  tags,
  text,
  onText,
  onTags,
}: {
  tags: string[]
  text: string
  onText: (text: string) => void
  onTags: (tags: string[]) => void
}) {
  const add = () => {
    const tag = normalTag(text)
    if (tag && !tags.includes(tag)) onTags([...tags, tag])
    onText('')
  }
  return (
    <section className="ed-card ed-card--aside" aria-labelledby="ed-tags">
      <h2 id="ed-tags">Tags</h2>
      {tags.length > 0 && (
        <ul className="ed-tags">
          {tags.map((tag) => (
            <li key={tag}>
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => onTags(tags.filter((t) => t !== tag))}
              >
                <Close size={14} strokeWidth={2.5} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="ed-tag-add">
        <input
          type="text"
          aria-label="Add a tag"
          placeholder="Add a tag"
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="ed-btn" aria-label="Add tag" onClick={add}>
          <Plus />
        </button>
      </div>
    </section>
  )
}
