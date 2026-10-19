import { useSyncExternalStore } from 'react'

const DESKTOP = '(min-width: 768px)'

// jsdom and old browsers have no matchMedia: treat them as desktop.
function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia?.(DESKTOP)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

function isDesktop() {
  return window.matchMedia?.(DESKTOP).matches ?? true
}

/** True from 768 px up. The shell renders either the header or the bottom bar, never both. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, isDesktop, () => true)
}
