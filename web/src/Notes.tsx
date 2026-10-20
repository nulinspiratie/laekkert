import { Fragment, useId } from 'react'
import { parseNotes, type Span } from './notes'

// React elements and text nodes only, so nothing typed in the notes can become markup.
function Spans({ spans }: { spans: Span[] }) {
  return spans.map((span, i) => {
    let node = <Fragment key={i}>{span.text}</Fragment>
    if (span.italic) node = <em key={i}>{span.text}</em>
    if (span.bold) node = <strong key={i}>{span.italic ? <em>{span.text}</em> : span.text}</strong>
    return node
  })
}

export function Notes({ text }: { text: string }) {
  const headingId = useId()
  const blocks = parseNotes(text)
  if (blocks.length === 0) return null
  return (
    <section className="notes" aria-labelledby={headingId}>
      <h2 id={headingId}>
        <span className="notes-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </span>
        Notes
      </h2>
      {blocks.map((block, i) =>
        block.kind === 'list' ? (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Spans spans={line} />
              </Fragment>
            ))}
          </p>
        ),
      )}
    </section>
  )
}
