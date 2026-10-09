/**
 * Adds an alpha channel to a theme colour. Theme tokens are #rrggbb strings, so the alpha is appended
 * as a two-digit hex value, which React Native accepts. rgb()/rgba() input is supported too.
 */
export function withAlpha(color: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha))
  const value = color.trim()
  if (value.startsWith('#')) {
    const base = value.length === 4 ? `#${[...value.slice(1)].map(char => char + char).join('')}` : value.slice(0, 7)
    return `${base}${Math.round(clamped * 255).toString(16).padStart(2, '0')}`
  }
  const match = value.match(/rgba?\(([^)]+)\)/)
  if (match?.[1]) {
    const [red = 0, green = 0, blue = 0] = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return `rgba(${red}, ${green}, ${blue}, ${clamped})`
  }
  return color
}
