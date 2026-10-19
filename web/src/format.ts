// Small display helpers shared by the browse and recipe pages.

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "20 min", "1 h", "1 h 10 min". */
export function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}
