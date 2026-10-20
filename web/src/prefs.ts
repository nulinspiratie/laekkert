// Display preferences, remembered per browser. localStorage can be missing or
// throw (private mode, blocked storage), so every read falls back to a default
// and every write is allowed to fail.

import type { UnitMode } from './amounts'
import { isSide, type Side } from './types'

export type View = 'grid' | 'list'

const SIDE_KEY = 'laekkert.side'
const VIEW_KEY = 'laekkert.view'
const UNITS_KEY = 'laekkert.units'

function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not remembering a preference is fine.
  }
}

export function getLastSide(): Side {
  const value = read(SIDE_KEY)
  return isSide(value) ? value : 'food'
}

export function setLastSide(side: Side): void {
  write(SIDE_KEY, side)
}

export function getView(): View {
  const value = read(VIEW_KEY)
  return value === 'list' ? 'list' : 'grid'
}

export function setView(view: View): void {
  write(VIEW_KEY, view)
}

export function getUnitMode(): UnitMode {
  const value = read(UNITS_KEY)
  return value === 'metric' ? 'metric' : 'spoons'
}

export function setUnitMode(mode: UnitMode): void {
  write(UNITS_KEY, mode)
}
