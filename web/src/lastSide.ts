import { isSide, type Side } from './types'

const KEY = 'laekkert.side'

// localStorage can be missing or throw (private mode, blocked storage), so the
// remembered side is a convenience that falls back to food.
export function getLastSide(): Side {
  try {
    const value = localStorage.getItem(KEY) ?? undefined
    return isSide(value) ? value : 'food'
  } catch {
    return 'food'
  }
}

export function setLastSide(side: Side): void {
  try {
    localStorage.setItem(KEY, side)
  } catch {
    // Not remembering the side is fine.
  }
}
