import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { CopyButton } from './CopyButton'
import { hasMath, prepareMarkdown } from './prepare'

type HastNode = { type?: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] }
type RehypePlugins = NonNullable<Options['rehypePlugins']>

function hastText(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}

function languageOf(node: HastNode | undefined): string {
  const className = node?.properties?.className
  const list = Array.isArray(className) ? className.map(String) : typeof className === 'string' ? className.split(' ') : []
  const lang = list.find(item => item.startsWith('language-'))?.slice(9) ?? ''
  return /^[\w#+.-]{1,24}$/.test(lang) ? lang : ''
}

/** Links leave the app in a new tab and never carry the opener or referrer. Unsafe protocols are removed. */
function safeUrl(url: string): string {
  const cleaned = defaultUrlTransform(url)
  return /^(https?:|mailto:|#)/i.test(cleaned) ? cleaned : ''
}

const components: Components = {
  a: ({ href, children }) => href
    ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>
    : <span>{children}</span>,
  // Remote images could track the reader; show them as a link instead.
  img: ({ src, alt }) => typeof src === 'string' && src
    ? <a href={src} target="_blank" rel="noopener noreferrer nofollow">{alt ? `Image: ${alt}` : 'Open image'}</a>
    : null,
  pre: ({ node }) => {
    const code = (node as HastNode | undefined)?.children?.find(child => child.tagName === 'code')
    const text = hastText(code).replace(/\n$/, '')
    const lang = languageOf(code)
    return <div className="ai-code-panel">
      <div className="ai-code-head"><span>{lang || 'code'}</span><CopyButton text={text} label={`Copy ${lang || 'code'}`} showLabel /></div>
      <pre className="ai-code-block"><code>{text}</code></pre>
    </div>
  },
  table: ({ children }) => <div className="ai-md-table-wrap" role="region" aria-label="Table" tabIndex={0}><table>{children}</table></div>,
  input: ({ checked, type }) => type === 'checkbox' ? <input type="checkbox" checked={Boolean(checked)} disabled readOnly aria-label={checked ? 'Done' : 'Not done'} /> : null
}

let mathPlugins: RehypePlugins | null = null
let mathLoading: Promise<RehypePlugins> | null = null
/** KaTeX (+ mhchem for \ce{…}) is a separate chunk, fetched only when an answer contains math. */
function loadMath(): Promise<RehypePlugins> {
  mathLoading ??= Promise.all([
    import('rehype-katex'),
    import('katex/dist/katex.min.css'),
    import('katex/contrib/mhchem')
  ]).then(([katex]) => {
    mathPlugins = [[katex.default, { throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml', maxExpand: 500 }]]
    return mathPlugins
  })
  return mathLoading
}

/**
 * Full Markdown for AI answers: GFM (tables, task lists, strikethrough, autolinks), math,
 * code panels with copy, safe links. Raw HTML is never rendered.
 */
function AIMarkdownImpl({ content, streaming = false }: { content: string; streaming?: boolean }): ReactNode {
  const prepared = useMemo(() => prepareMarkdown(content, streaming), [content, streaming])
  const needsMath = useMemo(() => hasMath(prepared), [prepared])
  const [plugins, setPlugins] = useState<RehypePlugins | null>(mathPlugins)
  useEffect(() => {
    if (!needsMath || plugins) return
    let active = true
    void loadMath().then(loaded => { if (active) setPlugins(loaded) }).catch(() => { /* math stays as source text */ })
    return () => { active = false }
  }, [needsMath, plugins])
  return <div className="ai-markdown">
    <ReactMarkdown
      remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath]}
      rehypePlugins={needsMath && plugins ? plugins : []}
      components={components}
      urlTransform={safeUrl}
      skipHtml
    >{prepared}</ReactMarkdown>
  </div>
}

const AIMarkdown = memo(AIMarkdownImpl)
export default AIMarkdown
