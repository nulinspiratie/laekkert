// One bar item's sheet (BarItemSheetPhone): its state, drinks, other names, kind,
// fresh or not, fold and delete. A bottom sheet on a phone, a centred dialog on
// desktop (styles/bar.css). Each action is one change; a refusal shows inside.

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { KIND_LABELS, KINDS, messageOf, usedText } from './bar'
import { capitalise } from './format'
import { Check, Chevron, Close, Fold, MinusCircle } from './icons'
import type { Bar, BarChanges, BarItem, Kind } from './types'

export interface BarItemSheetProps {
  /** The item shown; null when there is none. */
  item: BarItem | null
  /** The whole bar, for the fold picker. */
  bar: Bar
  open: boolean
  onClose: () => void
  /**
   * Sends one change. Resolves true once the bar has taken it and false when it was not
   * sent; rejects with the server's sentence, which the sheet shows.
   */
  onChange: (changes: BarChanges) => Promise<boolean>
}

export function BarItemSheet({ item, bar, open, onClose, onChange }: BarItemSheetProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const shown = open && item !== null

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (shown && !element.open) element.showModal()
    if (!shown && element.open) element.close()
  }, [shown])

  return (
    <dialog
      ref={dialog}
      className="bar-sheet"
      aria-modal="true"
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        onClose()
      }}
      // Only a click outside the sheet's box is on the backdrop; its own padding is not.
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        const { clientX: x, clientY: y } = event
        if (event.target === event.currentTarget && (x < box.left || x > box.right || y < box.top || y > box.bottom))
          onClose()
      }}
    >
      {shown && (
        <SheetBody key={item.name} item={item} bar={bar} titleId={titleId} onClose={onClose} onChange={onChange} />
      )}
    </dialog>
  )
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

interface SheetBodyProps extends Omit<BarItemSheetProps, 'item' | 'open'> {
  item: BarItem
  titleId: string
}

function SheetBody({ item, bar, titleId, onClose, onChange }: SheetBodyProps) {
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  // The kind picked while its write is in flight, so the select does not jump back.
  const [kindPicked, setKindPicked] = useState<Kind | null>(null)
  const [folding, setFolding] = useState(false)
  const [foldInto, setFoldInto] = useState('')
  const [deleting, setDeleting] = useState(false)
  const busy = useRef(false)
  const freshId = useId()
  const whyId = useId()

  const name = capitalise(item.name)
  const used = item.used_in.length
  const others = bar.items.filter((other) => other.name !== item.name)

  /** One change at a time; true when the bar took it. */
  const run = async (changes: BarChanges): Promise<boolean> => {
    if (busy.current) return false
    busy.current = true
    setError(null)
    try {
      return await onChange(changes)
    } catch (err) {
      setError(messageOf(err))
      return false
    } finally {
      busy.current = false
    }
  }

  const addName = async (event: FormEvent) => {
    event.preventDefault()
    const other = newName.trim()
    if (other === '') return
    if (await run({ add_names: { [item.name]: [other] } })) setNewName('')
  }

  const pickKind = async (kind: Kind) => {
    setKindPicked(kind)
    await run({ kinds: { [item.name]: kind } })
    setKindPicked(null)
  }

  const setState = (state: 'have' | 'dont') => {
    if (item.state === state) return
    void run(state === 'have' ? { have: [item.name] } : { dont_have: [item.name] })
  }

  return (
    <>
      <div className="sheet-grip" aria-hidden="true" />
      <div className="bar-sheet-head">
        <div className="bar-sheet-title">
          <h2 id={titleId}>{name}</h2>
          <span>
            {KIND_LABELS[item.kind]} · {lowerFirst(usedText(used))}
          </span>
        </div>
        <button type="button" className="bar-sheet-close" aria-label="Close" onClick={onClose}>
          <Close size={22} />
        </button>
      </div>
      {error && (
        <p role="alert" className="bar-sheet-error">
          {error}
        </p>
      )}

      <div className="bar-sheet-body">
        {item.tracked && (
          <div role="radiogroup" aria-label="In the bar" className="bar-sheet-state">
            <button
              type="button"
              role="radio"
              aria-checked={item.state === 'have'}
              className="bar-state bar-state--have"
              onClick={() => setState('have')}
            >
              <Check size={18} strokeWidth={2.75} />
              Have
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={item.state === 'dont'}
              className="bar-state bar-state--dont"
              onClick={() => setState('dont')}
            >
              <MinusCircle size={18} />
              Don't have
            </button>
          </div>
        )}

        {used > 0 && (
          <section className="bar-sheet-section">
            <h3>Used in</h3>
            <div className="bar-sheet-chips">
              {item.used_in.map((drink) => (
                <Link key={drink.slug} to={`/drinks/${encodeURIComponent(drink.slug)}`} className="bar-sheet-drink">
                  {drink.name}
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="bar-sheet-section">
          <h3>Other names</h3>
          <p>A recipe that says one of these means {item.name}.</p>
          {item.aliases.length > 0 && (
            <div className="bar-sheet-chips">
              {item.aliases.map((alias) => (
                <span key={alias} className="bar-alias">
                  {alias}
                  <button
                    type="button"
                    aria-label={`Remove the name ${alias}`}
                    onClick={() => void run({ remove_names: { [item.name]: [alias] } })}
                  >
                    <Close size={14} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form className="bar-sheet-add" onSubmit={addName}>
            <label>
              <span className="visually-hidden">Add another name</span>
              <input
                type="text"
                placeholder="Add another name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <button type="submit">Add</button>
          </form>
        </section>

        <label className="bar-sheet-section bar-sheet-kind">
          <span className="bar-sheet-label">Kind</span>
          <select
            value={kindPicked ?? item.kind}
            onChange={(event) => void pickKind(event.target.value as Kind)}
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>

        <div className="bar-sheet-fresh">
          <span className="bar-sheet-fresh-text">
            <span id={freshId} className="bar-sheet-fresh-label">
              Fresh item
            </span>
            <span>Never tracked. Drinks that use it say ‘Buy fresh’.</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!item.tracked}
            aria-labelledby={freshId}
            className="bar-switch"
            onClick={() => void run(item.tracked ? { untrack: [item.name] } : { track: [item.name] })}
          >
            <span className="bar-switch-track" aria-hidden="true">
              <span className="bar-switch-knob" />
            </span>
          </button>
        </div>

        <section className="bar-sheet-section">
          <h3>Same bottle as another item?</h3>
          {folding ? (
            <div className="bar-sheet-pick">
              <label>
                <span className="bar-sheet-label">Fold into</span>
                <select value={foldInto} onChange={(event) => setFoldInto(event.target.value)}>
                  <option value="">Pick an item</option>
                  {others.map((other) => (
                    <option key={other.name} value={other.name}>
                      {capitalise(other.name)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="bar-sheet-confirm">
                {foldInto !== '' && (
                  <button
                    type="button"
                    className="bar-sheet-go"
                    onClick={async () => {
                      if (await run({ fold: { [item.name]: foldInto } })) onClose()
                    }}
                  >
                    Fold into {capitalise(foldInto)}
                  </button>
                )}
                <button
                  type="button"
                  className="bar-sheet-cancel"
                  onClick={() => {
                    setFolding(false)
                    setFoldInto('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="bar-sheet-fold" onClick={() => setFolding(true)}>
              <Fold />
              <span>Fold into another item</span>
              <Chevron size={18} strokeWidth={2} />
            </button>
          )}
          <p>Its names and drinks move to the other item, then this one goes.</p>
        </section>

        <section className="bar-sheet-section">
          {used > 0 ? (
            <>
              <button type="button" className="bar-sheet-delete" disabled aria-describedby={whyId}>
                Delete from the bar
              </button>
              <p id={whyId}>
                {`Only items no drink uses can be deleted. ${used === 1 ? '1 drink uses' : `${used} drinks use`} ${item.name}.`}
              </p>
            </>
          ) : deleting ? (
            <div className="bar-sheet-confirm">
              <button
                type="button"
                className="bar-sheet-go bar-sheet-go--delete"
                onClick={async () => {
                  if (await run({ delete: [item.name] })) onClose()
                }}
              >
                Delete {name}
              </button>
              <button type="button" className="bar-sheet-cancel" onClick={() => setDeleting(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="bar-sheet-delete" onClick={() => setDeleting(true)}>
              Delete from the bar
            </button>
          )}
        </section>
      </div>
    </>
  )
}
