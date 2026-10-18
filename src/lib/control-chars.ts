/** Drop ASCII controls and DEL so values cannot break headers, paths, or logs. */
export function stripControlChars(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code > 31 && code !== 127) out += char
  }
  return out
}

export function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code <= 31 || code === 127) return true
  }
  return false
}
