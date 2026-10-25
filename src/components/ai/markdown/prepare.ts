/**
 * Normalizes an AI answer before Markdown parsing, without touching code:
 * - \( … \) and \[ … \] LaTeX delimiters become $ … $ and $$ … $$ (remark-math syntax).
 * - <sub>/<sup>/<br> written as HTML become Unicode sub/superscripts or line breaks, because
 *   raw HTML is never rendered (it is dropped by the parser, so it can never execute).
 * - While a reply is still streaming, an unclosed code fence is closed so the code panel
 *   renders progressively instead of swallowing the layout.
 */
const SUB: Record<string, string> = { '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋','−':'₋','=':'₌','(':'₍',')':'₎','a':'ₐ','e':'ₑ','o':'ₒ','x':'ₓ','h':'ₕ','k':'ₖ','l':'ₗ','m':'ₘ','n':'ₙ','p':'ₚ','s':'ₛ','t':'ₜ','i':'ᵢ','r':'ᵣ','u':'ᵤ','v':'ᵥ','j':'ⱼ' }
const SUP: Record<string, string> = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','−':'⁻','=':'⁼','(':'⁽',')':'⁾','n':'ⁿ','i':'ⁱ','a':'ᵃ','b':'ᵇ','c':'ᶜ','d':'ᵈ','e':'ᵉ','f':'ᶠ','g':'ᵍ','h':'ʰ','j':'ʲ','k':'ᵏ','l':'ˡ','m':'ᵐ','o':'ᵒ','p':'ᵖ','r':'ʳ','s':'ˢ','t':'ᵗ','u':'ᵘ','v':'ᵛ','w':'ʷ','x':'ˣ','y':'ʸ','z':'ᶻ' }

function mapScript(text: string, table: Record<string, string>, marker: '_' | '^'): string {
  const chars = [...text.trim()]
  if (chars.length && chars.every(char => table[char] !== undefined)) return chars.map(char => table[char]).join('')
  // Not representable in Unicode: fall back to readable math (rendered by KaTeX).
  const safe = text.replace(/[\\{}$]/g, '').trim()
  return safe ? `$${marker}{\\text{${safe}}}$` : ''
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/

function transformText(text: string): string {
  // Protect inline code spans first.
  const spans: string[] = []
  let out = text.replace(/(`+)[\s\S]*?\1/g, match => { spans.push(match); return `\uE000${spans.length - 1}\uE001` })
  out = out
    // A one-line $$…$$ is parsed as inline math by remark-math; models mean a display equation.
    .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, inner: string) => `$$\n${inner.trim()}\n$$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, inner: string) => `\n$$\n${inner.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, inner: string) => `$${inner.trim()}$`)
    .replace(/<sub>([^<]{1,40})<\/sub>/gi, (_, inner: string) => mapScript(inner, SUB, '_'))
    .replace(/<sup>([^<]{1,40})<\/sup>/gi, (_, inner: string) => mapScript(inner, SUP, '^'))
    .replace(/<br\s*\/?>/gi, '  \n')
  return out.replace(/\uE000(\d+)\uE001/g, (_, index: string) => spans[Number(index)] ?? '')
}

export function prepareMarkdown(source: string, streaming = false): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const parts: string[] = []
  let buffer: string[] = []
  let fence: string | null = null
  const flushText = () => { if (buffer.length) parts.push(transformText(buffer.join('\n'))); buffer = [] }
  for (const line of lines) {
    const match = FENCE.exec(line)
    if (fence === null) {
      if (match?.[1]) { flushText(); fence = match[1]; parts.push(line) } else buffer.push(line)
    } else {
      parts.push(line)
      if (match?.[1] && match[1][0] === fence[0] && match[1].length >= fence.length && line.trim() === match[1]) fence = null
    }
  }
  flushText()
  let result = parts.join('\n')
  if (fence !== null && streaming) result += `\n${fence}`
  return result
}

/** True when the text likely contains LaTeX, so the KaTeX renderer is worth loading. */
export function hasMath(source: string): boolean {
  return /\$\$|\\\(|\\\[|\\(frac|sqrt|ce|pu|sum|int|alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega|Delta|times|cdot|le|ge|neq|approx|rightarrow|vec)\b|\$[^$\n]+\$/.test(source)
}
