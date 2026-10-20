// The bar (/bar): every bottle the household's drinks use, as have or don't have, and
// the things that are not tracked: fresh items, syrups and mixers. Layout follows BarPhone,
// BarDesktop, BarFirstVisitPhone and BarSearchEmptyPhone in docs/design/artboards.

import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { changeBar, getBar } from './api'
import { groupByKind, KIND_LABELS, matchItem, messageOf, shelf, unsorted, untracked, usedText } from './bar'
import { BarItemSheet } from './BarItemSheet'
import { capitalise } from './format'
import { Back, Basket, Bottle, Check, Chevron, DrinksTab, MinusCircle, More, Plus, Question, Search } from './icons'
import { Shell } from './Shell'
import type { Bar, BarChanges, BarItem, BarState } from './types'
import { useIsDesktop } from './useIsDesktop'

/** What a write in flight changes about an item, or what a rollback puts back. */
type Patch = Pick<BarItem, 'state' | 'tracked' | 'untracked_because'>

/** The bar with some items patched: writes in flight, or a rollback. */
function withPatches(bar: Bar, patches: ReadonlyMap<string, Patch>): Bar {
  if (patches.size === 0) return bar
  return {
    ...bar,
    items: bar.items.map((item) => (patches.has(item.name) ? { ...item, ...patches.get(item.name)! } : item)),
  }
}

/** What a rollback restores for a name the bar no longer has: an unsorted, tracked item. */
const UNSORTED: Patch = { state: null, tracked: true, untracked_because: null }

/** An item the person stopped tracking, as the server will return it. */
const UNTRACKED: Patch = { state: null, tracked: false, untracked_because: 'marked' }

/** Opens the item sheet for `name`; `from` gets the focus back when it closes. */
type OpenSheet = (name: string, from: HTMLElement) => void

/**
 * A write the server refused, and where to say so: next to what was tapped, so the
 * sentence shows however far the page is scrolled. `at` is `item:<name>` for a row,
 * `rest` for marking the rest, `add` for adding what the search found nothing for.
 */
interface Problem {
  at: string
  message: string
}

const atItem = (name: string) => `item:${name}`

/** The refusal, if it belongs at `at`. */
function ProblemNote({ problem, at }: { problem: Problem | null; at: string }) {
  if (problem?.at !== at) return null
  return (
    <p role="alert" className="bar-problem">
      {problem.message}
    </p>
  )
}

export function BarPage() {
  const desktop = useIsDesktop()
  // undefined while loading.
  const [bar, setBar] = useState<Bar | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The last write that failed.
  const [problem, setProblem] = useState<Problem | null>(null)
  const [query, setQuery] = useState('')
  // The name of the item in the sheet.
  const [open, setOpen] = useState<string | null>(null)
  // Toggles in flight, by item name, with what they set. One write per item at a time.
  const pending = useRef(new Map<string, Patch>())
  const adding = useRef(false)
  const returnTo = useRef<{ name: string; element: HTMLElement } | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    getBar().then(
      (loaded) => live && setBar(loaded),
      (err: unknown) => live && setLoadError(err instanceof Error ? err.message : 'Something went wrong.'),
    )
    return () => {
      live = false
    }
  }, [])

  // Back to the row (or button) that opened the sheet; if that went, to the item's row, else the search.
  useEffect(() => {
    if (open !== null || returnTo.current === null) return
    const { name, element } = returnTo.current
    returnTo.current = null
    const rows = [...(page.current?.querySelectorAll<HTMLElement>('[data-item]') ?? [])]
    const target = element.isConnected ? element : (rows.find((row) => row.dataset.item === name) ?? search.current)
    target?.focus()
  }, [open])

  /** The server's bar replaces the page's copy, with the toggles still in flight laid over it. */
  const take = (server: Bar) => setBar(withPatches(server, new Map(pending.current)))

  /** Optimistic: the rows change at once and roll back if the server refuses. */
  const write = (names: string[], send: (free: string[]) => BarChanges, patch: Patch, at: string) => {
    if (!bar) return
    const free = names.filter((name) => !pending.current.has(name))
    if (free.length === 0) return
    const previous = new Map<string, Patch>()
    for (const name of free) {
      const { state, tracked, untracked_because } = bar.items.find((item) => item.name === name) ?? UNSORTED
      previous.set(name, { state, tracked, untracked_because })
      pending.current.set(name, patch)
    }
    setProblem(null)
    const optimistic = new Map(pending.current)
    setBar((current) => current && withPatches(current, optimistic))
    changeBar(send(free)).then(
      (server) => {
        for (const name of free) pending.current.delete(name)
        take(server)
      },
      (err: unknown) => {
        for (const name of free) pending.current.delete(name)
        setBar((current) => current && withPatches(current, previous))
        setProblem({ at, message: messageOf(err) })
      },
    )
  }

  const setStates = (names: string[], state: BarState, at = atItem(names[0])) =>
    write(
      names,
      (free) => (state === 'have' ? { have: free } : { dont_have: free }),
      { state, tracked: true, untracked_because: null },
      at,
    )

  const untrack = (name: string) => write([name], (free) => ({ untrack: free }), UNTRACKED, atItem(name))

  /** Adds what the search found nothing for, then clears the search. */
  const add = async (changes: BarChanges) => {
    if (adding.current) return
    adding.current = true
    setProblem(null)
    try {
      take(await changeBar(changes))
      setQuery('')
    } catch (err) {
      setProblem({ at: 'add', message: messageOf(err) })
    } finally {
      adding.current = false
    }
  }

  /** The sheet's writes: the sheet shows a refusal itself. */
  const changeFromSheet = async (changes: BarChanges): Promise<boolean> => {
    if (open !== null && pending.current.has(open)) return false
    take(await changeBar(changes))
    return true
  }

  const openSheet: OpenSheet = (name, from) => {
    returnTo.current = { name, element: from }
    setOpen(name)
  }

  const focusSearch = () => search.current?.focus()

  if (loadError) {
    return (
      <Shell side="drinks" phoneBar={false}>
        <div className="bar-page bar-failure">
          <BackLink />
          <p role="alert">{loadError}</p>
        </div>
      </Shell>
    )
  }
  if (!bar) return <Shell side="drinks" phoneBar={false}>{null}</Shell>

  const bottles = shelf(bar.items)
  const total = bottles.length
  const have = bottles.filter((item) => item.state === 'have').length
  const allUnsorted = unsorted(bar.items)
  const q = query.trim()
  const visible = (items: BarItem[]) => items.filter((item) => matchItem(item, q).ok)
  const unsortedShown = visible(allUnsorted)
  const sortedShown = visible(bottles.filter((item) => item.state !== null))
  const notTrackedShown = visible(untracked(bar.items))
  const noMatch = q !== '' && unsortedShown.length + sortedShown.length + notTrackedShown.length === 0
  const canMake = bar.counts.can_make === 1 ? '1 drink' : `${bar.counts.can_make} drinks`
  const sheetItem = open === null ? null : (bar.items.find((item) => item.name === open) ?? null)

  const verb = desktop ? 'Click' : 'Tap'
  const rowProps = { desktop, query: q, problem, onToggle: setStates, onUntrack: untrack, onOpen: openSheet }

  const title = (
    <div className="bar-title">
      <h1>The bar</h1>
      <p>
        {bar.set_up
          ? `One bar for the household · ${have} of ${total} bottles in`
          : `Lækkert found ${total} bottles in your drinks. ${verb} Have for each one in your cabinet.`}
      </p>
      {!bar.set_up && <Progress sorted={total - allUnsorted.length} total={total} />}
    </div>
  )

  const searchRow = (
    <div className="bar-search-row">
      <label className="bar-search">
        <Search size={18} strokeWidth={1.9} />
        <span className="visually-hidden">Find a bottle</span>
        <input
          ref={search}
          type="search"
          placeholder="Find a bottle"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {desktop ? (
        <button type="button" className="bar-add" onClick={focusSearch}>
          <Plus />
          Add a bottle
        </button>
      ) : (
        <button type="button" className="bar-add-icon" aria-label="Add a bottle" onClick={focusSearch}>
          <Plus size={22} />
        </button>
      )}
    </div>
  )

  const unsortedSection = unsortedShown.length > 0 && (
    <UnsortedSection
      items={unsortedShown}
      count={allUnsorted.length}
      setUp={bar.set_up}
      onRest={() => setStates(unsortedShown.map((item) => item.name), 'dont', 'rest')}
      row={rowProps}
    />
  )

  const groups = groupByKind(sortedShown).map((group) => (
    <KindGroup key={group.kind} label={KIND_LABELS[group.kind]} have={group.have} items={group.items} row={rowProps} />
  ))

  const noMatchSection = noMatch && (
    <NoMatch
      query={q}
      desktop={desktop}
      problem={problem}
      onAdd={() => add({ have: [q] })}
      onUntracked={() => add({ untrack: [q] })}
    />
  )

  const notTrackedSection = notTrackedShown.length > 0 && <NotTrackedSection items={notTrackedShown} onOpen={openSheet} />

  return (
    <Shell side="drinks" phoneBar={false}>
      <div ref={page} className={`bar-page bar-page--${desktop ? 'desktop' : 'phone'}`}>
        <div className="bar-head">
          <BackLink />
          {desktop ? (
            <div className="bar-head-row">
              {title}
              {searchRow}
            </div>
          ) : (
            <>
              {title}
              {bar.set_up && (
                <Link to="/drinks" className="bar-can">
                  <DrinksTab size={20} strokeWidth={2} />
                  <span className="bar-can-text">
                    You can make <strong>{canMake}</strong> now
                  </span>
                  <Chevron size={18} strokeWidth={2} />
                </Link>
              )}
              {searchRow}
            </>
          )}
        </div>

        {desktop ? (
          <div className="bar-columns">
            <div className="bar-main">
              {unsortedSection}
              {groups.length > 0 && <div className="bar-groups">{groups}</div>}
              {noMatchSection}
            </div>
            <aside className="bar-aside">
              {bar.set_up && (
                <Link to="/drinks" className="bar-can-card">
                  <span className="bar-can-eyebrow">From this bar</span>
                  <span className="bar-can-title">You can make {canMake} now</span>
                  <span className="bar-can-see">
                    See them
                    <Chevron size={16} strokeWidth={2} />
                  </span>
                </Link>
              )}
              {total > 0 && allUnsorted.length === 0 && (
                <div className="bar-all-sorted">
                  <Check size={20} />
                  Every bottle is sorted
                </div>
              )}
              {notTrackedSection}
            </aside>
          </div>
        ) : (
          <div className="bar-body">
            {unsortedSection}
            {groups}
            {noMatchSection}
            {notTrackedSection}
            {q === '' && (
              <button type="button" className="bar-add-more" onClick={focusSearch}>
                <Plus />
                Add a bottle
              </button>
            )}
          </div>
        )}

        <BarItemSheet
          item={sheetItem}
          bar={bar}
          open={sheetItem !== null}
          onClose={() => setOpen(null)}
          onChange={changeFromSheet}
        />
      </div>
    </Shell>
  )
}

function BackLink() {
  return (
    <Link to="/drinks" className="bar-back">
      <Back />
      Drinks
    </Link>
  )
}

function Progress({ sorted, total }: { sorted: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((sorted / total) * 100)
  return (
    <div className="bar-progress">
      <div className="bar-progress-track" aria-hidden="true">
        <div style={{ width: `${percent}%` }} />
      </div>
      <span>
        {sorted} of {total} sorted
      </span>
    </div>
  )
}

interface RowProps {
  desktop: boolean
  /** The search, to say which other name matched. */
  query: string
  /** A refused write, shown in the row it belongs to. */
  problem: Problem | null
  onToggle: (names: string[], state: BarState, at?: string) => void
  onUntrack: (name: string) => void
  onOpen: OpenSheet
}

/** The item's name and what it is used in; opens the item sheet. */
function NameButton({ item, query, onOpen }: { item: BarItem; query: string; onOpen: OpenSheet }) {
  const { alias } = matchItem(item, query)
  return (
    <button
      type="button"
      className="bar-row-name"
      data-item={item.name}
      aria-haspopup="dialog"
      onClick={(event) => onOpen(item.name, event.currentTarget)}
    >
      <span className="bar-row-title">{capitalise(item.name)}</span>
      <span className="bar-row-used">{alias === null ? usedText(item.used_in.length) : `Also called ${alias}`}</span>
    </button>
  )
}

/** A sorted item: one tap flips have and don't have. */
function ItemRow({ item, desktop, query, problem, onToggle, onOpen }: RowProps & { item: BarItem }) {
  const name = capitalise(item.name)
  const verb = desktop ? 'Click' : 'Tap'
  const isHave = item.state === 'have'
  return (
    <div className="bar-row">
      <NameButton item={item} query={query} onOpen={onOpen} />
      <button
        type="button"
        className={`bar-toggle bar-toggle--${isHave ? 'have' : 'dont'}`}
        aria-label={
          isHave ? `${name}: have. ${verb} if you've run out.` : `${name}: don't have. ${verb} when you've bought it.`
        }
        onClick={() => onToggle([item.name], isHave ? 'dont' : 'have')}
      >
        {isHave ? <Check size={16} strokeWidth={2.75} /> : <MinusCircle />}
        {isHave ? 'Have' : "Don't have"}
      </button>
      {desktop && (
        <button
          type="button"
          className="bar-more"
          aria-label={`More for ${name}`}
          aria-haspopup="dialog"
          onClick={(event) => onOpen(item.name, event.currentTarget)}
        >
          <More />
        </button>
      )}
      <ProblemNote problem={problem} at={atItem(item.name)} />
    </div>
  )
}

function KindGroup({ label, have, items, row }: { label: string; have: number; items: BarItem[]; row: RowProps }) {
  const id = useId()
  return (
    <section className="bar-group" aria-labelledby={id}>
      <div className="bar-group-head">
        <h2 id={id}>{label}</h2>
        <span>
          {have} of {items.length} in
        </span>
      </div>
      <div className="bar-group-list">
        {items.map((item) => (
          <ItemRow key={item.name} item={item} {...row} />
        ))}
      </div>
    </section>
  )
}

function UnsortedSection({
  items,
  count,
  setUp,
  onRest,
  row,
}: {
  /** The unsorted items the search leaves. */
  items: BarItem[]
  /** All unsorted items. */
  count: number
  setUp: boolean
  onRest: () => void
  row: RowProps
}) {
  const id = useId()
  return (
    <section className="bar-unsorted" aria-labelledby={id}>
      <div className="bar-unsorted-head">
        <Question />
        <h2 id={id}>Not sorted yet</h2>
        <span className="bar-unsorted-count">{count}</span>
      </div>
      <p className="bar-unsorted-help">
        {setUp
          ? "New from drinks you added. Until you sort them, drinks that use them don't show under Can make."
          : 'Nothing is sorted yet, so no drink shows under ‘Can make now’. Tap what you have, then mark the rest in one go.'}
      </p>
      {groupByKind(items).map((group) => (
        <div key={group.kind} className="bar-unsorted-group">
          <h3>{KIND_LABELS[group.kind]}</h3>
          {group.items.map((item) => {
            const name = capitalise(item.name)
            return (
              <div key={item.name} className="bar-row bar-row--unsorted">
                <NameButton item={item} query={row.query} onOpen={row.onOpen} />
                <button
                  type="button"
                  className="bar-pick bar-pick--have"
                  aria-label={`${name}: have`}
                  onClick={() => row.onToggle([item.name], 'have')}
                >
                  <Check size={16} strokeWidth={2.75} />
                  Have
                </button>
                <button
                  type="button"
                  className="bar-pick bar-pick--dont"
                  aria-label={`${name}: don't have`}
                  onClick={() => row.onToggle([item.name], 'dont')}
                >
                  <MinusCircle />
                  Don't have
                </button>
                <button
                  type="button"
                  className="bar-untrack"
                  aria-label={`${name}: don't track`}
                  onClick={() => row.onUntrack(item.name)}
                >
                  Don't track
                </button>
                <ProblemNote problem={row.problem} at={atItem(item.name)} />
              </div>
            )
          })}
        </div>
      ))}
      <ProblemNote problem={row.problem} at="rest" />
      <button type="button" className="bar-rest" onClick={onRest}>
        {items.length === 1 ? 'Mark it as don’t have' : `Mark the other ${items.length} as don’t have`}
      </button>
    </section>
  )
}

function NotTrackedSection({ items, onOpen }: { items: BarItem[]; onOpen: OpenSheet }) {
  const id = useId()
  return (
    <section className="bar-untracked" aria-labelledby={id}>
      <div className="bar-untracked-head">
        <Basket />
        <h2 id={id}>Not tracked</h2>
      </div>
      <p>Fresh things, syrups and mixers. Drinks that use them still show under Can make and say what else they need.</p>
      <div className="bar-chips">
        {items.map((item) => (
          <button
            key={item.name}
            type="button"
            className="bar-chip"
            data-item={item.name}
            aria-haspopup="dialog"
            onClick={(event) => onOpen(item.name, event.currentTarget)}
          >
            {capitalise(item.name)}
          </button>
        ))}
      </div>
      <p className="bar-untracked-foot">Open an item to start or stop tracking it.</p>
    </section>
  )
}

function NoMatch({
  query,
  desktop,
  problem,
  onAdd,
  onUntracked,
}: {
  query: string
  desktop: boolean
  problem: Problem | null
  onAdd: () => void
  onUntracked: () => void
}) {
  return (
    <section className="bar-nomatch" aria-live="polite">
      {!desktop && <Bottle />}
      <h2>No bottle called ‘{query}’</h2>
      <p>
        {desktop
          ? 'Check the spelling, or add it as a bottle you have.'
          : 'Check the spelling, or add it. It goes in as a bottle you have, and you can change that after.'}
      </p>
      <ProblemNote problem={problem} at="add" />
      <button type="button" className="bar-nomatch-add" onClick={onAdd}>
        <Plus size={20} />
        Add ‘{query}’ to the bar
      </button>
      <button type="button" className="bar-nomatch-untracked" onClick={onUntracked}>
        Add it without tracking
      </button>
    </section>
  )
}
