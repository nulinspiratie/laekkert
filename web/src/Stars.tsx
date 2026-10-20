// The five-star rating: read-only, or five buttons that take a rating in half stars.

import { StarFraction } from './icons'

const STARS = [1, 2, 3, 4, 5]

/** How much of star `n` is filled for a rating: 0, 0.5 or 1. */
function fraction(value: number | null, n: number): number {
  if (value === null) return 0
  return Math.min(1, Math.max(0, Math.round((value - (n - 1)) * 2) / 2))
}

/**
 * Read-only without `onRate`. With it, tapping star n gives n; tapping the star that already
 * is the rating gives n − 0.5. There is no way to clear a rating.
 */
export function Stars({
  value,
  onRate,
  label = 'Rating',
  size = 28,
  disabled = false,
}: {
  value: number | null
  onRate?: (rating: number) => void
  label?: string
  size?: number
  disabled?: boolean
}) {
  if (!onRate) {
    return (
      <span
        className="stars stars--static"
        role="img"
        aria-label={value === null ? 'Not rated' : `Rated ${value.toFixed(1)} out of 5`}
      >
        {STARS.map((n) => (
          <StarFraction key={n} fraction={fraction(value, n)} size={size} />
        ))}
      </span>
    )
  }
  return (
    <div className="stars" role="group" aria-label={label}>
      {STARS.map((n) => (
        <button
          key={n}
          type="button"
          className="star-btn"
          aria-label={`Rate ${n} ${n === 1 ? 'star' : 'stars'}`}
          disabled={disabled}
          onClick={() => onRate(value === n ? n - 0.5 : n)}
        >
          <StarFraction fraction={fraction(value, n)} size={size} />
        </button>
      ))}
    </div>
  )
}
