import type { ReactNode } from 'react'

/**
 * Safe "rich" text: plain text with **bold**, *italic* and __underline__ markers and line
 * breaks. It is parsed into React elements (never HTML), so nothing stored can inject markup.
 */
const TOKEN = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g

function inline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(TOKEN)
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={key}>{part.slice(2, -2)}</strong>
    if (part.startsWith('__') && part.endsWith('__') && part.length > 4) return <u key={key}>{part.slice(2, -2)}</u>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>
    return part
  })
}

export function richText(text: string): ReactNode {
  const lines = text.split('\n')
  return lines.map((line, index) => <span key={index}>{inline(line, String(index))}{index < lines.length - 1 && <br />}</span>)
}

/** Strips the markers, for alt text, aria labels and summaries. */
export function plainText(text: string): string {
  return text.replace(/\*\*|__|\*/g, '')
}
