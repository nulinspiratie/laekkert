// The app shell: the desktop header (brand, Food/Drinks nav, the bar on the
// drinks side, grid/list toggle) or the phone bottom bar, around the page.
// `side` picks the theme through `data-side` (see styles/tokens.css).

import { useLayoutEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { defaultQuery } from './browse'
import { Bottle, DrinksTab, FoodTab, Grid, List, Logo } from './icons'
import type { View } from './prefs'
import { SIDE_LABELS, SIDES, type Side } from './types'
import { useIsDesktop } from './useIsDesktop'

export interface ShellProps {
  side: Side
  /** The browse page's current view. The desktop grid/list toggle shows only with `onView` too. */
  view?: View
  onView?: (view: View) => void
  /** Buttons for the phone bottom bar, beside the nav (filters, view switch). */
  phoneActions?: ReactNode
  /** false: no bottom bar on a phone (the recipe page has its own back button). */
  phoneBar?: boolean
  children: ReactNode
}

export function Shell({ side, view, onView, phoneActions, phoneBar = true, children }: ShellProps) {
  const desktop = useIsDesktop()
  const onBar = useLocation().pathname === '/bar'

  // The page background lives on <body>, outside this element, so it needs the side too.
  useLayoutEffect(() => {
    document.documentElement.dataset.side = side
  }, [side])

  const bar = !desktop && phoneBar
  return (
    <div className={`shell${bar ? ' shell--bar' : ''}`} data-side={side}>
      {desktop && (
        <header className="shell-header">
          <Link to="/" className="shell-brand">
            <Logo />
            <span>Lækkert</span>
          </Link>
          <SideNav current={side} icons />
          <div className="shell-spacer" />
          {side === 'drinks' && (
            <Link to="/bar" className="shell-link" aria-current={onBar ? 'page' : undefined}>
              <Bottle size={18} strokeWidth={1.75} />
              The bar
            </Link>
          )}
          {view && onView && <ViewToggle view={view} onView={onView} />}
        </header>
      )}
      <main className="shell-main">{children}</main>
      {bar && (
        <div className="shell-bar">
          <SideNav current={side} />
          {phoneActions}
        </div>
      )}
    </div>
  )
}

function SideNav({ current, icons = false }: { current: Side; icons?: boolean }) {
  return (
    <nav className="side-nav" aria-label="Food or drinks">
      {SIDES.map((side) => {
        const query = defaultQuery(side)
        return (
          <Link
            key={side}
            to={`/${side}${query ? `?${query}` : ''}`}
            aria-current={side === current ? 'page' : undefined}
          >
            {icons && (side === 'food' ? <FoodTab /> : <DrinksTab />)}
            {SIDE_LABELS[side]}
          </Link>
        )
      })}
    </nav>
  )
}

function ViewToggle({ view, onView }: { view: View; onView: (view: View) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="View mode">
      <button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => onView('grid')}>
        <Grid />
      </button>
      <button type="button" aria-label="List view" aria-pressed={view === 'list'} onClick={() => onView('list')}>
        <List />
      </button>
    </div>
  )
}

export interface PageHeadingProps {
  side: Side
  title: string
  /** Under the title, for example what the list is filtered to. */
  subtitle?: string
  /** Beside the title: the sort select on desktop, the search button on a phone. */
  children?: ReactNode
  /** Under the title row, inside the block (on a phone, inside the Drinks masthead). */
  below?: ReactNode
}

/**
 * The page title block. Drinks gets the "The bar" eyebrow and a double rule; on a
 * phone the Drinks block is the design's full-width dark masthead, so place it
 * first in the page, outside any gutter. On desktop put it inside the page's own
 * padded column.
 */
export function PageHeading({ side, title, subtitle, children, below }: PageHeadingProps) {
  return (
    <div className="page-heading">
      <div className="page-heading-row">
        <div className="page-heading-text">
          {side === 'drinks' && <div className="page-heading-eyebrow">The bar</div>}
          <h1>{title}</h1>
          {subtitle && <p className="page-heading-sub">{subtitle}</p>}
        </div>
        {children}
      </div>
      {below}
      <div className="page-heading-rule" aria-hidden="true" />
    </div>
  )
}
