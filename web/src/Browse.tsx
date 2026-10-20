// The browse page: a side's recipes as a grid or a list, with search, filters
// and sort. What is shown is derived from the URL's query string (see browse.ts);
// only the list from the API, the search box text and the view are state.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { listRecipes } from './api'
import {
  MARK_LABELS,
  SORT_OPTIONS,
  applyBrowse,
  browseQuery,
  defaultQuery,
  describe,
  facetCounts,
  parseBrowse,
  type BrowseState,
  type SortKey,
} from './browse'
import { FilterPanel, FilterSheet, SearchField } from './FilterPanel'
import { capitalise } from './format'
import { Close, Filters, Grid, List, Plus, Search } from './icons'
import { getView, setLastSide, setView, type View } from './prefs'
import { RecipeCard, RecipeRow, RecipeTableRow } from './RecipeCard'
import { PageHeading, Shell } from './Shell'
import { SIDE_LABELS, type RecipeSummary, type Side } from './types'
import { useIsDesktop } from './useIsDesktop'

/** How long typing must pause before the search goes to the API. */
const SEARCH_DEBOUNCE_MS = 200

const plural = (n: number) => `${n} ${n === 1 ? 'recipe' : 'recipes'}`

const search = (query: string) => ({ search: query ? `?${query}` : '' })

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
  const [loaded, setLoaded] = useState<{ q: string; recipes: RecipeSummary[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(state.q !== '')
  const searchInput = useRef<HTMLInputElement>(null)
  const focusSearch = useRef(false)

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
    listRecipes(side, fetchQ || undefined).then(
      (recipes) => {
        if (!current) return
        setLoaded({ q: fetchQ, recipes })
        setError(null)
      },
      (err: Error) => current && setError(err.message),
    )
    return () => {
      current = false
    }
  }, [side, fetchQ])

  useEffect(() => {
    if (searchOpen && focusSearch.current) searchInput.current?.focus()
    focusSearch.current = false
  }, [searchOpen])

  const recipes = useMemo(
    () => (loaded ? applyBrowse(loaded.recipes, { ...state, q: loaded.q }) : null),
    [loaded, state],
  )
  const counts = useMemo(() => facetCounts(side, loaded?.recipes ?? []), [side, loaded])

  const title = SIDE_LABELS[side]
  const subtitle = recipes ? `${describe(state)} · ${plural(recipes.length)}` : describe(state)

  const onChange = (patch: Partial<BrowseState>) => navigate(search(browseQuery({ ...state, ...patch })))
  const onSearch = (value: string) => {
    setText(value)
    navigate(search(browseQuery({ ...state, q: value.trim() })), { replace: true })
  }
  const reset = () => navigate(search(defaultQuery(side)))
  const changeView = (next: View) => {
    setView(next)
    setViewState(next)
  }

  const results = (
    <Results
      side={side}
      recipes={recipes}
      unfilteredEmpty={loaded?.recipes.length === 0 && !state.q}
      view={view}
      desktop={desktop}
      error={error}
      onClear={() => navigate(`/${side}`)}
    />
  )

  if (desktop) {
    return (
      <Shell side={side} view={view} onView={changeView}>
        <div className="browse browse--desktop">
          <aside className="browse-aside" aria-label={`${title} filters`}>
            <FilterPanel
              side={side}
              state={state}
              counts={counts}
              onChange={onChange}
              search={{ value: text, onChange: onSearch }}
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
        <PageHeading side={side} title={title} subtitle={subtitle}>
          <button
            type="button"
            className="browse-search-btn"
            aria-label={`Search ${title.toLowerCase()}`}
            aria-expanded={searchOpen}
            onClick={toggleSearch}
          >
            <Search />
          </button>
        </PageHeading>
        <div className="gutter browse-body">
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
  onClear: () => void
}

function Results({ recipes, unfilteredEmpty, view, desktop, error, onClear }: ResultsProps) {
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {recipes?.length === 0 &&
        (unfilteredEmpty ? (
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
