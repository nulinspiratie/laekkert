// The browse page: a side's recipes as a grid or a list, with search, filters
// and sort. What is shown is derived from the URL's query string (see browse.ts);
// only the list from the API, the bar, the search box text and the view are state.
// On drinks the four views (Can make, All drinks, Mocktails, Syrups & prep) filter the list;
// Can make leans on the bar and explains an empty list.
// On food a "what you have" list (the `have` params) ranks it by fewest missing.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { getBar, listRecipes } from './api'
import { unsorted } from './bar'
import {
  MARK_LABELS,
  SORT_OPTIONS,
  VIEW_CHIP_LABELS,
  VIEW_LABELS,
  addTerm,
  applyBrowse,
  availableViews,
  browseQuery,
  defaultQuery,
  describe,
  facetCounts,
  hiddenMatches,
  parseBrowse,
  removeTerm,
  type BrowseState,
  type DrinksView,
  type SortKey,
} from './browse'
import { FilterPanel, FilterSheet, SearchField, type BarSummary, type ViewsProps } from './FilterPanel'
import { capitalise } from './format'
import { HaveField } from './HaveField'
import { Basket, Bottle, Check, Close, Filters, Grid, List, Plus, Question, Search, Shelf } from './icons'
import { getView, setLastSide, setView, type View } from './prefs'
import { RecipeCard, RecipeRow, RecipeTableRow } from './RecipeCard'
import { PageHeading, Shell } from './Shell'
import { SIDE_LABELS, type Bar, type RecipeSummary, type Side } from './types'
import { useIsDesktop } from './useIsDesktop'

/** How long typing must pause before the search goes to the API. */
const SEARCH_DEBOUNCE_MS = 200

const plural = (n: number) => `${n} ${n === 1 ? 'recipe' : 'recipes'}`

const drinksCount = (n: number) => `${n} ${n === 1 ? 'drink' : 'drinks'}`

const search = (query: string) => ({ search: query ? `?${query}` : '' })

/** "chicken", "chicken or leeks", "chicken, leeks or eggs". */
function joinOr(terms: string[]): string {
  if (terms.length < 2) return terms.join('')
  return `${terms.slice(0, -1).join(', ')} or ${terms[terms.length - 1]}`
}

/** More terms than this and the empty state says "those" instead of naming them. */
const NAMED_TERMS = 3

/** The desktop drinks result line: "Can make · 2 drinks", "24 drinks · 15 you can make". */
function resultLine(show: DrinksView, recipes: RecipeSummary[]): string {
  switch (show) {
    case 'can':
    case 'mocktails':
      return `${VIEW_LABELS[show]} · ${drinksCount(recipes.length)}`
    case 'all': {
      const can = recipes.filter((recipe) => recipe.bar?.status === 'can_make').length
      return `${drinksCount(recipes.length)} · ${can} you can make`
    }
    case 'syrups':
      return `${VIEW_LABELS.syrups} · ${plural(recipes.length)}`
  }
}

export default function Browse({ side }: { side: Side }) {
  const desktop = useIsDesktop()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const paramString = params.toString()
  const state = useMemo(() => parseBrowse(side, new URLSearchParams(paramString)), [side, paramString])

  const [view, setViewState] = useState<View>(getView)
  const [text, setText] = useState(state.q)
  // The query the list on screen was fetched for; follows state.q after a pause.
  const [fetchQ, setFetchQ] = useState(state.q)
  // The same for the "what you have" terms (no pause: adding a chip is deliberate). The list
  // on screen keeps its own order, subtitle and badges until the answer for the new terms is in.
  const haveSignature = JSON.stringify(state.have)
  const [loaded, setLoaded] = useState<{ q: string; have: string[]; recipes: RecipeSummary[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Drinks only: null while loading; 'failed' hides Can make, the banner and the set-up state.
  const [bar, setBar] = useState<Bar | 'failed' | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(state.q !== '')
  const searchInput = useRef<HTMLInputElement>(null)
  const focusSearch = useRef(false)
  // Phone only: the "What you have" panel. Open from the start when the URL has terms.
  const [haveOpen, setHaveOpen] = useState(state.have.length > 0)
  const haveInput = useRef<HTMLInputElement>(null)
  const focusHave = useRef(false)
  // The state as of the latest add or remove, so a pasted list of terms adds every one.
  const latest = useRef(state)
  useEffect(() => {
    latest.current = state
  }, [state])

  useEffect(() => setLastSide(side), [side])

  // The URL holds the trimmed query; keep the box's own text unless the URL moved on.
  const [seenQ, setSeenQ] = useState(state.q)
  if (seenQ !== state.q) {
    setSeenQ(state.q)
    if (text.trim() !== state.q) setText(state.q)
  }
  // An emptied search goes back to the full list at once; a new one waits for a pause.
  if (state.q === '' && fetchQ !== '') setFetchQ('')

  useEffect(() => {
    if (state.q === '' || state.q === fetchQ) return
    const timer = setTimeout(() => setFetchQ(state.q), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [state.q, fetchQ])

  useEffect(() => {
    // A response for an earlier query must not replace a newer one.
    let current = true
    const have: string[] = JSON.parse(haveSignature)
    listRecipes(side, fetchQ || undefined, have).then(
      (recipes) => {
        if (!current) return
        setLoaded({ q: fetchQ, have, recipes })
        setError(null)
      },
      (err: Error) => current && setError(err.message),
    )
    return () => {
      current = false
    }
  }, [side, fetchQ, haveSignature])

  useEffect(() => {
    if (side !== 'drinks') return
    let current = true
    getBar().then(
      (loadedBar) => current && setBar(loadedBar),
      () => current && setBar('failed'),
    )
    return () => {
      current = false
    }
  }, [side])

  useEffect(() => {
    if (searchOpen && focusSearch.current) searchInput.current?.focus()
    focusSearch.current = false
  }, [searchOpen])

  useEffect(() => {
    if (haveOpen && focusHave.current) haveInput.current?.focus()
    focusHave.current = false
  }, [haveOpen])

  // A bar that failed to load cannot say what can be made: Can make is not offered, so
  // show=can (the default) would shorten the list with no way to see or clear it.
  const shown = useMemo(
    () => (bar === 'failed' && state.show === 'can' ? { ...state, show: 'all' as const } : state),
    [bar, state],
  )
  const recipes = useMemo(
    () => (loaded ? applyBrowse(loaded.recipes, { ...shown, q: loaded.q, have: loaded.have }) : null),
    [loaded, shown],
  )
  const counts = useMemo(() => facetCounts(side, loaded?.recipes ?? [], shown), [side, loaded, shown])
  const barSummary: BarSummary | null =
    bar && bar !== 'failed' ? { setUp: bar.set_up, unsorted: unsorted(bar.items).length } : null
  const views: ViewsProps | undefined = side === 'drinks' ? { canMake: bar !== 'failed', bar: barSummary } : undefined

  const title = SIDE_LABELS[side]
  // The order on screen is the loaded list's, so the subtitle names that order too.
  const described = side === 'food' && loaded ? { ...state, have: loaded.have } : state
  let subtitle = recipes ? `${describe(described)} · ${plural(recipes.length)}` : describe(described)
  if (desktop && shown.show && recipes) subtitle = resultLine(shown.show, recipes)

  const showAll = `/${side}?${browseQuery({ ...state, show: 'all' })}`
  // Can make, and the bar is known not to be set up: the box above the list says so.
  const setUpBox =
    loaded && shown.show === 'can' && barSummary && !barSummary.setUp ? (
      <BarEmpty kind="setup" desktop={desktop} all={counts.views.all} showAll={showAll} />
    ) : null

  // The Can make view left nothing, though the other filters leave some drinks.
  let empty: ReactNode | undefined
  if (loaded && recipes?.length === 0 && shown.show === 'can' && counts.views.all > 0) {
    // Until the bar has loaded it is not known whether it is set up; once it is known not to
    // be, the box above is all there is. A search that finds nothing here is not "nothing to make".
    if (bar === null || setUpBox) empty = null
    else if (loaded.q === '') {
      empty = <BarEmpty kind="nothing" desktop={desktop} all={counts.views.all} showAll={showAll} />
    }
  }

  // A search the view cuts short: the matches All drinks (or Syrups & prep) would add.
  const hidden = loaded && views ? hiddenMatches(loaded.recipes, { ...shown, q: loaded.q }) : null

  const onChange = (patch: Partial<BrowseState>) => navigate(search(browseQuery({ ...state, ...patch })))
  const onAddTerm = (text: string) => {
    const next = addTerm(latest.current, text)
    if (next === latest.current) return
    latest.current = next
    onChange({ have: next.have })
  }
  const onRemoveTerm = (term: string) => {
    const next = removeTerm(latest.current, term)
    if (next === latest.current) return
    latest.current = next
    onChange({ have: next.have })
  }
  const onClearTerms = () => onChange({ have: [] })
  const haveField = { terms: state.have, onAdd: onAddTerm, onRemove: onRemoveTerm, onClear: onClearTerms }

  // No recipe uses any of the terms, and no search narrows it: say so and offer to clear them.
  if (empty === undefined && loaded && loaded.recipes.length === 0 && loaded.q === '' && loaded.have.length > 0) {
    empty = (
      <div className="browse-empty browse-empty--have">
        <h2>{loaded.have.length > NAMED_TERMS ? 'Nothing uses those' : `Nothing uses ${joinOr(loaded.have)}`}</h2>
        <p>Try another ingredient, or clear the list.</p>
        <button type="button" onClick={onClearTerms}>
          Clear
        </button>
      </div>
    )
  }

  const onSearch = (value: string) => {
    setText(value)
    navigate(search(browseQuery({ ...state, q: value.trim() })), { replace: true })
  }
  const reset = () => navigate(search(defaultQuery(side, state.show)))
  // "Clear filters" clears the search, marks and tags. Drinks keep the view; food drops every param.
  const clearedQuery = side === 'drinks' ? defaultQuery(side, state.show) : ''
  const clearFilters = () => navigate({ pathname: `/${side}`, ...search(clearedQuery) })
  const changeView = (next: View) => {
    setView(next)
    setViewState(next)
  }

  const list = (
    <Results
      side={side}
      recipes={recipes}
      unfilteredEmpty={loaded?.recipes.length === 0 && !state.q && loaded.have.length === 0}
      view={view}
      desktop={desktop}
      error={error}
      empty={empty}
      onClear={clearFilters}
    />
  )
  const results = (
    <>
      {setUpBox}
      {list}
      {hidden && (
        <p className="browse-more">
          <Link to={`/${side}?${browseQuery({ ...state, show: hidden.view })}`}>
            {hidden.count} more in {VIEW_LABELS[hidden.view]}
          </Link>
        </p>
      )}
    </>
  )

  if (desktop) {
    return (
      <Shell side={side} view={view} onView={changeView}>
        <div className="browse browse--desktop">
          <aside className="browse-aside" aria-label={`${title} filters`}>
            <FilterPanel
              side={side}
              state={shown}
              counts={counts}
              onChange={onChange}
              search={{ value: text, onChange: onSearch }}
              have={side === 'food' ? haveField : undefined}
              views={views}
            />
          </aside>
          <div className="browse-main">
            <PageHeading side={side} title={title} subtitle={subtitle}>
              <div className="browse-tools">
                <label className="browse-sort">
                  Sort
                  <select value={state.sort} onChange={(event) => onChange({ sort: event.target.value as SortKey })}>
                    {SORT_OPTIONS.map(({ key, label }) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <Link to={`/${side}/new`} className="browse-new">
                  <Plus />
                  New recipe
                </Link>
              </div>
            </PageHeading>
            <Chips state={state} onChange={onChange} />
            {results}
          </div>
        </div>
      </Shell>
    )
  }

  const active = state.marks.length + state.tags.length + (state.category ? 1 : 0)
  const phoneActions = (
    <>
      <button
        type="button"
        className="round-btn"
        aria-label={active ? `Filters, ${active} active` : 'Filters'}
        aria-haspopup="dialog"
        onClick={() => setSheetOpen(true)}
      >
        <Filters />
        {active > 0 && (
          <span className="round-badge" aria-hidden="true">
            {active}
          </span>
        )}
      </button>
      <button
        type="button"
        className="round-btn"
        aria-label={view === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
        onClick={() => changeView(view === 'grid' ? 'list' : 'grid')}
      >
        {view === 'grid' ? <List size={22} /> : <Grid size={22} />}
      </button>
      <Link to={`/${side}/new`} className="round-btn round-btn--accent" aria-label="New recipe">
        <Plus size={24} />
      </Link>
    </>
  )
  const toggleHave = () => {
    if (!haveOpen) focusHave.current = true
    setHaveOpen(!haveOpen)
  }
  const toggleSearch = () => {
    if (searchOpen) {
      onSearch('')
      setSearchOpen(false)
    } else {
      focusSearch.current = true
      setSearchOpen(true)
    }
  }

  return (
    <Shell side={side} view={view} onView={changeView} phoneActions={phoneActions}>
      <div className="browse browse--phone">
        <PageHeading
          side={side}
          title={title}
          subtitle={subtitle}
          below={views && <ViewChips views={views} state={shown} counts={counts} onChange={onChange} />}
        >
          {side === 'drinks' && (
            <Link to="/bar" className="browse-head-btn" aria-label="The bar">
              <Bottle size={22} strokeWidth={1.6} />
            </Link>
          )}
          {side === 'food' && (
            <button
              type="button"
              className="browse-head-btn"
              aria-label="What you have"
              aria-pressed={state.have.length > 0}
              aria-expanded={haveOpen}
              onClick={toggleHave}
            >
              <Basket size={22} />
            </button>
          )}
          <button
            type="button"
            className="browse-head-btn"
            aria-label={`Search ${title.toLowerCase()}`}
            aria-expanded={searchOpen}
            onClick={toggleSearch}
          >
            <Search />
          </button>
        </PageHeading>
        <div className="gutter browse-body">
          {side === 'food' && haveOpen && (
            <section className="have-panel" aria-label="What you have">
              <HaveField {...haveField} inputRef={haveInput} />
            </section>
          )}
          {searchOpen && <SearchField side={side} value={text} onChange={onSearch} inputRef={searchInput} />}
          {results}
        </div>
        <FilterSheet
          side={side}
          state={state}
          counts={counts}
          onChange={onChange}
          open={sheetOpen}
          count={recipes?.length ?? 0}
          onClose={() => setSheetOpen(false)}
          onReset={reset}
        />
      </div>
    </Shell>
  )
}

/** The phone's view chips and unsorted banner, in the Drinks masthead. */
function ViewChips({
  views,
  state,
  counts,
  onChange,
}: {
  views: ViewsProps
  state: BrowseState
  counts: ReturnType<typeof facetCounts>
  onChange: (patch: Partial<BrowseState>) => void
}) {
  const { bar } = views
  return (
    <>
      <div role="radiogroup" aria-label="Show" className="browse-view-chips">
        {availableViews(views.canMake).map((value) => {
          const on = state.show === value
          return (
            <button key={value} type="button" role="radio" aria-checked={on} onClick={() => onChange({ show: value })}>
              {on && <Check size={16} strokeWidth={3} />}
              {VIEW_CHIP_LABELS[value]} {counts.views[value]}
            </button>
          )
        })}
      </div>
      {bar && bar.setUp && bar.unsorted > 0 && (
        <Link to="/bar" className="browse-bar-banner">
          <Question size={18} />
          <span className="browse-bar-banner-text">
            {bar.unsorted} new {bar.unsorted === 1 ? 'bottle' : 'bottles'} not sorted yet
          </span>{' '}
          <span className="browse-bar-sort">Sort</span>
        </Link>
      )}
    </>
  )
}

interface BarEmptyProps {
  kind: 'setup' | 'nothing'
  desktop: boolean
  /** Drinks the other filters leave (All drinks). */
  all: number
  showAll: string
}

/** The bar is not set up (a box above the Can make list), or Can make leaves nothing. */
function BarEmpty({ kind, desktop, all, showAll }: BarEmptyProps) {
  const showAllLink =
    all > 0 ? (
      <Link to={showAll} className="browse-bar-empty-alt">
        {all === 1 ? 'Show 1 drink' : `Show all ${all} drinks`}
      </Link>
    ) : null
  const openBar = (primary: boolean) => (
    <Link to="/bar" className={primary ? 'browse-bar-empty-cta' : 'browse-bar-empty-alt'}>
      Open the bar
    </Link>
  )
  let content: { icon: ReactNode; title: string; text: string; actions: ReactNode }
  if (kind === 'setup') {
    const how = desktop ? "Mark each bottle as have or don't have." : 'Tap Have for each bottle you own.'
    content = {
      icon: <Shelf />,
      title: 'Set up your bar first',
      text: `Lækkert doesn't know what's in your cabinet yet, so drinks that need bottles can't show here yet. ${how} It takes about a minute.`,
      actions: (
        <>
          <Link to="/bar" className="browse-bar-empty-cta">
            Set up the bar
          </Link>
          {showAllLink}
        </>
      ),
    }
  } else {
    content = {
      icon: <Shelf />,
      title: 'Nothing to make yet',
      text: 'Every drink is missing a bottle or uses one not sorted yet.',
      actions: (
        <>
          {openBar(true)}
          {showAllLink}
        </>
      ),
    }
  }
  return (
    <section className="browse-bar-empty">
      {content.icon}
      <div className="browse-bar-empty-text">
        <h2>{content.title}</h2>
        <p>{content.text}</p>
        <div className="browse-bar-empty-actions">{content.actions}</div>
      </div>
    </section>
  )
}

/** Removable chips for the marks, category and tags that are on. */
function Chips({ state, onChange }: { state: BrowseState; onChange: (patch: Partial<BrowseState>) => void }) {
  const chips = [
    ...state.marks.map((mark) => ({
      key: `mark:${mark}`,
      label: MARK_LABELS[mark],
      remove: () => onChange({ marks: state.marks.filter((m) => m !== mark) }),
    })),
    ...(state.category
      ? [{ key: 'cat', label: capitalise(state.category), remove: () => onChange({ category: null }) }]
      : []),
    ...state.tags.map((tag) => ({
      key: `tag:${tag}`,
      label: tag,
      remove: () => onChange({ tags: state.tags.filter((t) => t !== tag) }),
    })),
  ]
  if (chips.length === 0) return null
  return (
    <div className="browse-chips">
      {chips.map(({ key, label, remove }) => (
        <button key={key} type="button" className="browse-chip" aria-label={`Remove ${label} filter`} onClick={remove}>
          {label}
          <Close />
        </button>
      ))}
    </div>
  )
}

interface ResultsProps {
  side: Side
  /** null until the first response. */
  recipes: RecipeSummary[] | null
  /** The API has no recipes at all on this side. */
  unfilteredEmpty: boolean
  view: View
  desktop: boolean
  error: string | null
  /** Shown instead of the plain empty state when given (null shows nothing yet). */
  empty?: ReactNode
  onClear: () => void
}

function Results({ recipes, unfilteredEmpty, view, desktop, error, empty, onClear }: ResultsProps) {
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {recipes?.length === 0 &&
        (empty !== undefined ? (
          empty
        ) : unfilteredEmpty ? (
          <p className="browse-empty">No recipes yet.</p>
        ) : (
          <div className="browse-empty">
            <p>Nothing matches these filters.</p>
            <button type="button" onClick={onClear}>
              Clear filters
            </button>
          </div>
        ))}
      {recipes && recipes.length > 0 && view === 'grid' && (
        <ul className="recipe-grid" aria-label="Recipes" data-view="grid">
          {recipes.map((recipe) => (
            <li key={recipe.slug}>
              <RecipeCard recipe={recipe} />
            </li>
          ))}
        </ul>
      )}
      {recipes && recipes.length > 0 && view === 'list' && desktop && (
        <div className="recipe-table">
          <div className="recipe-table-head" aria-hidden="true">
            <span />
            <span>Recipe</span>
            <span>Time</span>
            <span>Marks</span>
            <span />
          </div>
          <ul aria-label="Recipes" data-view="list">
            {recipes.map((recipe) => (
              <li key={recipe.slug}>
                <RecipeTableRow recipe={recipe} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {recipes && recipes.length > 0 && view === 'list' && !desktop && (
        <ul className="recipe-rows" aria-label="Recipes" data-view="list">
          {recipes.map((recipe) => (
            <li key={recipe.slug}>
              <RecipeRow recipe={recipe} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
