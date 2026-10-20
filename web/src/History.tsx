// The History section of the recipe page: a note box and the timeline, newest first.
// Layout follows the History sections of RecipeDesktop and RecipePhone; there are no
// avatars (the app has no users), so each entry gets an icon for its kind.

import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Clock, Edit, Heart, Note, Plus, Restore, Star } from './icons'
import { Stars } from './Stars'
import { entryTitle, formatDate, restorableVersion } from './timeline'
import type { Change, TimelineEntry } from './types'

/** How many entries the phone shows before "Show full history". */
const COMPACT_COUNT = 3

const RESTORE_CONFIRM = 'Restore the recipe as it was after this change? Later changes stay in the history.'

function KindIcon({ kind }: { kind: TimelineEntry['kind'] }) {
  switch (kind) {
    case 'created':
      return <Plus size={18} />
    case 'baseline':
      return <Clock size={18} />
    case 'edit':
      return <Edit size={18} />
    case 'note':
      return <Note size={18} />
    case 'rating':
      return <Star filled size={18} />
    case 'made':
      return <Check />
    case 'marks':
      return <Heart filled size={18} />
  }
}

const DIFF_SIGNS: Record<Change['kind'], { sign: string; label: string }> = {
  added: { sign: '+', label: 'Added' },
  removed: { sign: '−', label: 'Removed' },
  changed: { sign: '•', label: 'Changed' },
}

function Diff({ changes }: { changes: Change[] }) {
  if (changes.length === 0) return null
  return (
    <ul className="history-diff" aria-label="Changes">
      {changes.map((change, i) => (
        <li key={i} className={`history-diff-line history-diff-line--${change.kind}`}>
          <span role="img" aria-label={DIFF_SIGNS[change.kind].label} className="history-diff-sign">
            {DIFF_SIGNS[change.kind].sign}
          </span>
          <span className="history-diff-text">{change.text}</span>
        </li>
      ))}
    </ul>
  )
}

function Body({ entry }: { entry: TimelineEntry }): ReactNode {
  switch (entry.kind) {
    case 'edit':
      return <Diff changes={entry.changes} />
    case 'note':
      return <p className="history-note">{entry.text}</p>
    case 'made':
      return (
        (entry.rating !== null || entry.note) && (
          <>
            {entry.rating !== null && <Stars value={entry.rating} size={18} />}
            {entry.note && <p className="history-note">{entry.note}</p>}
          </>
        )
      )
    default:
      return null
  }
}

function Entry({
  entry,
  all,
  currentVersion,
  last,
  onRestore,
}: {
  entry: TimelineEntry
  all: TimelineEntry[]
  currentVersion: number | null
  last: boolean
  onRestore: (version: number) => void
}) {
  const version = restorableVersion(entry, currentVersion)
  const restore = () => {
    if (version !== null && window.confirm(RESTORE_CONFIRM)) onRestore(version)
  }
  return (
    <li className={`history-entry${last ? ' history-entry--last' : ''}`}>
      <div className="history-rail">
        <span className="history-icon">
          <KindIcon kind={entry.kind} />
        </span>
        <span className="history-line" />
      </div>
      <div className="history-body">
        <div className="history-head">
          <span className="history-title">
            <strong>{entryTitle(entry, all)}</strong> · <time dateTime={entry.at}>{formatDate(entry.at)}</time>
          </span>
          {version !== null && (
            <button type="button" className="history-restore" onClick={restore}>
              <Restore />
              Restore this version
            </button>
          )}
        </div>
        <Body entry={entry} />
      </div>
    </li>
  )
}

export function History({
  entries,
  currentVersion,
  onRestore,
  onNote,
  compact = false,
  error = null,
}: {
  entries: TimelineEntry[]
  currentVersion: number | null
  onRestore: (version: number) => void
  /** Resolves true when the note was saved, so the box can be cleared. */
  onNote: (text: string) => Promise<boolean>
  /** The phone: the newest three entries and a button for the rest. */
  compact?: boolean
  error?: string | null
}) {
  const headingId = useId()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const shown = compact && !expanded ? entries.slice(0, COMPACT_COUNT) : entries

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const note = text.trim()
    if (!note || saving) return
    setSaving(true)
    try {
      if (await onNote(note)) setText('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="history" aria-labelledby={headingId}>
      <h2 id={headingId}>History</h2>
      <form className="history-form" onSubmit={submit}>
        <label className="history-label">
          <span className="visually-hidden">Add a note</span>
          <textarea
            rows={2}
            value={text}
            placeholder="Add a note: what worked, what you changed"
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <button type="submit" className="history-add" disabled={saving || text.trim() === ''}>
          Add note
        </button>
      </form>
      {error && (
        <p role="alert" className="recipe-error">
          {error}
        </p>
      )}
      <ol className="history-list" aria-label="Timeline">
        {shown.map((entry, i) => (
          <Entry
            key={entry.id}
            entry={entry}
            all={entries}
            currentVersion={currentVersion}
            last={i === shown.length - 1}
            onRestore={onRestore}
          />
        ))}
      </ol>
      {compact && !expanded && entries.length > COMPACT_COUNT && (
        <button type="button" className="history-more" onClick={() => setExpanded(true)}>
          Show full history
        </button>
      )}
    </section>
  )
}
