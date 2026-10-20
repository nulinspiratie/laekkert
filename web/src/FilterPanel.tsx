// The browse filters: search (desktop only), what you have (desktop food only), the bar
// (desktop drinks only), marks, category and tags. `aside` is the desktop side panel;
// `sheet` is the same controls bigger, inside the phone's filter sheet (FilterSheet
// below). On a phone the bar filter is chips under the heading and what you have is a
// header button with its own panel (BarChips and the have panel in Browse).

import { useEffect, useRef, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router'
import {
  FILTER_MARKS,
  MARK_LABELS,
  SORT_OPTIONS,
  type BarFilter,
  type BrowseState,
  type FilterMark,
  type facetCounts,
} from './browse'
import { capitalise } from './format'
import { HaveField, type HaveFieldProps } from './HaveField'
import { Bookmark, Bottle, Check, Heart, Question, Search } from './icons'
import { SIDE_LABELS, type Side } from './types'

const MARK_ICONS: Record<FilterMark, () => ReactNode> = {
  favourite: () => <Heart size={20} />,
  try_next: () => <Bookmark size={20} />,
}

export interface FilterPanelProps {
  side: Side
  state: BrowseState
  /** Counts for the recipes on the page, before the marks, category and tags are applied. */
  counts: ReturnType<typeof facetCounts>
  onChange: (patch: Partial<BrowseState>) => void
  variant?: 'aside' | 'sheet'
  /** The search field, shown when given (the phone has a search button instead). */
  search?: { value: string; onChange: (value: string) => void }
  /** The "From your bar" section, shown when given (drinks, once the bar has loaded). */
  bar?: BarSummary
  /** The "What you have" section, shown when given (desktop food; the phone has a button and panel). */
  have?: Omit<HaveFieldProps, 'inputRef'>
}

/** What the browse page knows about the bar. */
export interface BarSummary {
  setUp: boolean
  /** Bottles not sorted yet. */
  unsorted: number
}

export function FilterPanel({ side, state, counts, onChange, variant = 'aside', search, bar, have }: FilterPanelProps) {
  const sheet = variant === 'sheet'
  const Heading = sheet ? 'h3' : 'h2'

  const toggle = <T,>(list: T[], item: T) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item]

  // Hide categories nothing is in, unless one is picked (so it can be unpicked).
  const categories = counts.categories.filter(([name, n]) => n > 0 || name === state.category)
  const total = counts.categories.reduce((sum, [, n]) => sum + n, 0)
  const tags = [...counts.tags, ...state.tags.filter((tag) => !counts.tags.includes(tag))]

  return (
    <div className={`filters filters--${variant}`}>
      {search && <SearchField side={side} value={search.value} onChange={search.onChange} />}

      {have && (
        <section className="filter-section" aria-label="What you have">
          <Heading>What you have</Heading>
          <HaveField {...have} />
        </section>
      )}

      {bar && <BarSection bar={bar} state={state} counts={counts} onChange={onChange} />}

      <section className="filter-section">
        <Heading>Marks</Heading>
        {FILTER_MARKS.map((mark) => {
          const on = state.marks.includes(mark)
          return (
            <button
              key={mark}
              type="button"
              className="filter-mark"
              aria-pressed={on}
              onClick={() => onChange({ marks: toggle(state.marks, mark) })}
            >
              {MARK_ICONS[mark]()}
              <span className="filter-grow">{MARK_LABELS[mark]}</span>
              {sheet ? (
                <span className="filter-box" aria-hidden="true">
                  {on && <Check size={16} strokeWidth={3} />}
                </span>
              ) : (
                on && <Check />
              )}
            </button>
          )
        })}
      </section>

      <section className="filter-section">
        <Heading>{side === 'drinks' ? 'Style' : 'Category'}</Heading>
        {sheet ? (
          <div role="radiogroup" aria-label={side === 'drinks' ? 'Style' : 'Category'} className="filter-pills">
            <CategoryPill name="All" on={state.category === null} onPick={() => onChange({ category: null })} />
            {categories.map(([name]) => (
              <CategoryPill
                key={name}
                name={capitalise(name)}
                on={state.category === name}
                onPick={() => onChange({ category: name })}
              />
            ))}
          </div>
        ) : (
          <div className="filter-categories">
            <CategoryRow name="All" n={total} on={state.category === null} onPick={() => onChange({ category: null })} />
            {categories.map(([name, n]) => (
              <CategoryRow
                key={name}
                name={capitalise(name)}
                n={n}
                on={state.category === name}
                onPick={() => onChange({ category: name })}
              />
            ))}
          </div>
        )}
      </section>

      {tags.length > 0 && (
        <section className="filter-section">
          <Heading>Tags</Heading>
          <div className="filter-pills">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="filter-pill"
                aria-pressed={state.tags.includes(tag)}
                onClick={() => onChange({ tags: toggle(state.tags, tag) })}
              >
                {tag}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

type BarCount = keyof ReturnType<typeof facetCounts>['bar']

const BAR_OPTIONS: readonly { value: BarFilter | null; label: string; count: BarCount }[] = [
  { value: null, label: 'Everything', count: 'all' },
  { value: 'can', label: 'Can make now', count: 'can' },
  { value: 'fresh', label: 'Only need fresh items', count: 'fresh' },
]

function BarSection({
  bar,
  state,
  counts,
  onChange,
}: {
  bar: BarSummary
  state: BrowseState
  counts: ReturnType<typeof facetCounts>
  onChange: (patch: Partial<BrowseState>) => void
}) {
  return (
    <section className="filter-section">
      <h2>From your bar</h2>
      <div role="radiogroup" aria-label="Inventory" className="filter-bar">
        {BAR_OPTIONS.map(({ value, label, count }) => (
          <button
            key={value ?? 'all'}
            type="button"
            role="radio"
            aria-checked={state.bar === value}
            className="filter-bar-option"
            onClick={() => onChange({ bar: value })}
          >
            <span className="filter-radio" aria-hidden="true" />
            <span className="filter-grow">{label}</span>{' '}
            <span className="filter-count">{counts.bar[count]}</span>
          </button>
        ))}
      </div>
      <Link to="/bar" className="filter-bar-edit">
        <Bottle size={18} strokeWidth={1.75} />
        {bar.setUp ? 'Edit the bar' : 'Set up the bar'}
      </Link>
      {bar.setUp && bar.unsorted > 0 && (
        <Link to="/bar" className="filter-bar-unsorted">
          <Question size={20} />
          <span>
            <strong>
              {bar.unsorted} {bar.unsorted === 1 ? 'bottle' : 'bottles'} not sorted yet.
            </strong>{' '}
            Drinks that use {bar.unsorted === 1 ? 'it' : 'them'} count as missing.{' '}
            <span className="filter-bar-sort">Sort them</span>
          </span>
        </Link>
      )}
    </section>
  )
}

/** The search box: in the desktop panel, and under the title on a phone. */
export function SearchField({
  side,
  value,
  onChange,
  inputRef,
}: {
  side: Side
  value: string
  onChange: (value: string) => void
  inputRef?: Ref<HTMLInputElement>
}) {
  const what = SIDE_LABELS[side].toLowerCase()
  return (
    <label className="filter-search">
      <Search size={18} />
      <span className="visually-hidden">Search {what}</span>
      <input
        ref={inputRef}
        type="search"
        placeholder={`Search ${what}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function CategoryRow({ name, n, on, onPick }: { name: string; n: number; on: boolean; onPick: () => void }) {
  return (
    <button type="button" className="filter-category" aria-pressed={on} onClick={onPick}>
      <span>{name}</span>{' '}
      <span className="filter-count">{n}</span>
    </button>
  )
}

function CategoryPill({ name, on, onPick }: { name: string; on: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} className="filter-pill" onClick={onPick}>
      {name}
    </button>
  )
}

export interface FilterSheetProps extends Omit<FilterPanelProps, 'variant' | 'search' | 'bar' | 'have'> {
  open: boolean
  /** How many recipes the filters leave, for the "Show N recipes" button. */
  count: number
  onClose: () => void
  onReset: () => void
}

/** The phone's filter sheet: a modal <dialog> over the page, filtering live. */
export function FilterSheet({ open, count, onClose, onReset, ...panel }: FilterSheetProps) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  return (
    <dialog
      ref={dialog}
      className="filter-sheet"
      aria-labelledby="filter-sheet-title"
      onClose={onClose}
      // A click on the dialog itself, not its content, is a click on the backdrop.
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      {open && (
        <>
          <div className="sheet-grip" aria-hidden="true" />
          <div className="sheet-head">
            <h2 id="filter-sheet-title">Filters</h2>
            <button type="button" className="sheet-reset" onClick={onReset}>
              Reset
            </button>
          </div>
          <div className="sheet-body">
            <FilterPanel {...panel} variant="sheet" />
            <section className="filter-section">
              <h3>Sort by</h3>
              <div role="radiogroup" aria-label="Sort by" className="sheet-sort">
                {SORT_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={panel.state.sort === key}
                    onClick={() => panel.onChange({ sort: key })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
          </div>
          <div className="sheet-foot">
            <button type="button" className="sheet-show" onClick={onClose}>
              Show {count} {count === 1 ? 'recipe' : 'recipes'}
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}
