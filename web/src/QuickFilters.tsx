// Food's quick filters: category tabs over tag chips, at the top of the Food page.
// A tab sets `cat=`, a chip adds or removes a `tag=`, as the filter sheet does; what is
// shown and counted comes from `quickFilters` in browse.ts. On a phone the rows scroll
// sideways and stick to the top of the screen once the heading has gone; on desktop they wrap.

import { useEffect, useRef, useState } from 'react'
import type { BrowseState, QuickChip, QuickTab } from './browse'
import { Check } from './icons'

const plural = (n: number) => `${n} ${n === 1 ? 'recipe' : 'recipes'}`

export interface QuickFiltersProps {
  tabs: QuickTab[]
  /** Null until the settings have arrived: no chip row yet. */
  chips: QuickChip[] | null
  /** A category or a tag is on: the chip row ends with Clear. */
  active: boolean
  state: BrowseState
  onChange: (patch: Partial<BrowseState>) => void
  /** Opens the filter sheet (phone) or moves to More tags (desktop); no More chip without it. */
  onMore?: () => void
  desktop: boolean
}

export function QuickFilters({ tabs, chips, active, state, onChange, onMore, desktop }: QuickFiltersProps) {
  // Phone only: whether the rows have stuck to the top, for the hairline and shadow under them.
  const sentinel = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const element = sentinel.current
    if (desktop || !element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) =>
      setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [desktop])

  const pick = (tab: QuickTab) => {
    if (!tab.disabled && !tab.on) onChange({ category: tab.category })
  }
  const toggle = (chip: QuickChip) => {
    if (chip.disabled) return
    onChange({ tags: chip.on ? state.tags.filter((tag) => tag !== chip.tag) : [...state.tags, chip.tag] })
  }

  const variant = desktop ? 'desktop' : 'phone'
  return (
    <>
      {!desktop && <div ref={sentinel} className="quick-sentinel" aria-hidden="true" />}
      <div className={`quick-filters quick-filters--${variant}${stuck ? ' is-stuck' : ''}`}>
        <div role="radiogroup" aria-label="Category" className="quick-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.category ?? ''}
              type="button"
              role="radio"
              className="quick-tab"
              aria-checked={tab.on}
              aria-disabled={tab.disabled || undefined}
              onClick={() => pick(tab)}
            >
              {tab.label} <span className="quick-count">{tab.count}</span>
            </button>
          ))}
        </div>
        {chips && chips.length > 0 && (
          <div role="group" aria-label="Quick tags" className="quick-chips">
            {chips.map((chip) => (
              <button
                key={chip.tag}
                type="button"
                className={chip.quick ? 'quick-chip' : 'quick-chip quick-chip--other'}
                aria-pressed={chip.on}
                aria-disabled={chip.disabled || undefined}
                aria-label={chip.on ? chip.label : `${chip.label}, ${plural(chip.count)}`}
                onClick={() => toggle(chip)}
              >
                {chip.on && <Check size={16} strokeWidth={3} />}
                {chip.label}
                {!chip.on && <span className="quick-count">{chip.count}</span>}
              </button>
            ))}
            {onMore && (
              <button type="button" className="quick-chip quick-chip--more" aria-haspopup={desktop ? undefined : 'dialog'} onClick={onMore}>
                More
              </button>
            )}
            {active && (
              <button type="button" className="quick-clear" onClick={() => onChange({ category: null, tags: [] })}>
                Clear
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
