// The food recipe page's tag picker: every food tag as a toggle. A bottom sheet on a phone,
// a popover under the tag row on desktop (styles/recipe.css). Taps change only the picker;
// closing it hands the change to the page, which saves it as one version.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { listRecipes } from './api'
import { normalise } from './bar'
import { Check, Plus } from './icons'
import { pickerTags, tagChanges } from './tagPicker'

export interface TagPickerProps {
  /** The recipe's tags. */
  own: string[]
  category: string
  desktop: boolean
  /** Called once, on Done, a tap outside or Escape, with what to save (both empty for nothing). */
  onClose: (changes: { add: string[]; remove: string[] }) => void
}

export function TagPicker({ own, category, desktop, onClose }: TagPickerProps) {
  const [offered, setOffered] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState(own)
  const dialog = useRef<HTMLDialogElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    let live = true
    listRecipes('food').then(
      (recipes) => live && setOffered(pickerTags(own, recipes.flatMap((recipe) => recipe.tags), category)),
      (err: unknown) => {
        if (!live) return
        setOffered(pickerTags(own, [], category))
        setError(`Couldn't load the other tags. ${err instanceof Error ? err.message : ''}`.trim())
      },
    )
    return () => {
      live = false
    }
  }, [own, category])

  useEffect(() => {
    if (desktop) popover.current?.focus()
    else if (dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [desktop])

  const changes = tagChanges(own, picked)
  const close = () => onClose(changes)

  const toggle = (tag: string) => {
    const key = normalise(tag)
    setPicked((current) =>
      current.some((t) => normalise(t) === key) ? current.filter((t) => normalise(t) !== key) : [...current, tag],
    )
  }

  const pending = [...changes.add.map((tag) => `+ ${tag}`), ...changes.remove.map((tag) => `− ${tag}`)]

  const body = (
    <>
      {!desktop && <div className="sheet-grip" aria-hidden="true" />}
      <div className="tag-picker-head">
        <h2 id={titleId}>Tags</h2>
        <button type="button" className="tag-picker-done" onClick={close}>
          Done
        </button>
      </div>
      {error && (
        <p role="alert" className="tag-picker-error">
          {error}
        </p>
      )}
      {offered === null ? (
        <p className="tag-picker-note">Loading tags…</p>
      ) : (
        <div className="tag-picker-pills" role="group" aria-labelledby={titleId}>
          {offered.map((tag) => {
            const on = picked.some((t) => normalise(t) === normalise(tag))
            return (
              <button key={tag} type="button" className="tag-pick" aria-pressed={on} onClick={() => toggle(tag)}>
                {on ? <Check size={16} /> : <Plus size={16} />}
                {tag}
              </button>
            )
          })}
        </div>
      )}
      <p className="tag-picker-note" aria-live="polite">
        {pending.length > 0 ? `Saves when you close: ${pending.join(', ')}` : 'Tap a tag to add it or take it off.'}
      </p>
    </>
  )

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    close()
  }

  if (desktop) {
    return (
      <>
        <button type="button" className="tag-picker-scrim" aria-label="Close tags" tabIndex={-1} onClick={close} />
        <div
          ref={popover}
          className="tag-picker tag-picker--popover"
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {body}
        </div>
      </>
    )
  }
  return (
    <dialog
      ref={dialog}
      className="tag-picker tag-picker--sheet"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      // Android's back gesture cancels the dialog: that closes it too.
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      // Only a click outside the sheet's box is on the backdrop; its own padding is not.
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        const { clientX: x, clientY: y } = event
        if (event.target === event.currentTarget && (x < box.left || x > box.right || y < box.top || y > box.bottom))
          close()
      }}
    >
      {body}
    </dialog>
  )
}
