// "What you have": a text field that turns each typed ingredient into a removable chip.
// The terms live in the URL (see browse.ts); this component only reports what was typed.

import { useState, type KeyboardEvent, type Ref } from 'react'
import { Close } from './icons'

/** The server cuts a term at this length; the field stops there too. */
const MAX_TERM_LENGTH = 60

export interface HaveFieldProps {
  terms: string[]
  onAdd: (text: string) => void
  onRemove: (term: string) => void
  onClear: () => void
  inputRef?: Ref<HTMLInputElement>
}

export function HaveField({ terms, onAdd, onRemove, onClear, inputRef }: HaveFieldProps) {
  const [text, setText] = useState('')

  const add = (value: string) => {
    if (value.trim() !== '') onAdd(value.trim())
  }

  // A comma ends a term; a pasted list adds every complete term and keeps the tail.
  const change = (value: string) => {
    if (!value.includes(',')) return setText(value)
    const parts = value.split(',')
    for (const part of parts.slice(0, -1)) add(part)
    setText(parts[parts.length - 1].trimStart())
  }

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      add(text)
      setText('')
    } else if (event.key === 'Backspace' && text === '' && terms.length > 0) {
      onRemove(terms[terms.length - 1])
    }
  }

  return (
    <div className="have-field">
      <input
        ref={inputRef}
        type="text"
        className="have-input"
        placeholder="Add an ingredient"
        aria-label="Add an ingredient"
        enterKeyHint="done"
        autoComplete="off"
        autoCapitalize="none"
        maxLength={MAX_TERM_LENGTH}
        value={text}
        onChange={(event) => change(event.target.value)}
        onKeyDown={keyDown}
      />
      {terms.length > 0 ? (
        <div className="have-terms">
          <ul className="have-chips" aria-label="Ingredients you have">
            {terms.map((term) => (
              <li key={term} className="have-chip">
                <span className="have-chip-text">{term}</span>
                <button type="button" className="have-chip-remove" aria-label={`Remove ${term}`} onClick={() => onRemove(term)}>
                  <Close size={14} />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="have-clear" onClick={onClear}>
            Clear
          </button>
        </div>
      ) : (
        <p className="have-hint">See what you can cook with what's in the fridge.</p>
      )}
    </div>
  )
}
