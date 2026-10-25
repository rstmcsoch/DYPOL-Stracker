// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AIMarkdown from './AIMarkdown'
import { CopyButton } from './CopyButton'
import { hasMath, prepareMarkdown } from './prepare'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('AIMarkdown', () => {
  it('renders emphasis, headings, nested lists, blockquotes, rules and task lists', () => {
    const { container } = render(<AIMarkdown content={'# Title\n\n**bold** and *italic*\n\n- one\n  - nested\n\n> quoted\n\n---\n\n- [x] done\n- [ ] todo'} />)
    expect(container.querySelector('h1')?.textContent).toBe('Title')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
    expect(container.querySelector('ul ul li')?.textContent).toBe('nested')
    expect(container.querySelector('blockquote')?.textContent).toContain('quoted')
    expect(container.querySelector('hr')).not.toBeNull()
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    expect(boxes[0]?.checked).toBe(true)
    expect(boxes[0]?.disabled).toBe(true)
  })

  it('renders GFM tables inside a horizontally scrollable region', () => {
    const { container } = render(<AIMarkdown content={'| Topic | Weight |\n| --- | --- |\n| Optics | 12% |'} />)
    const wrap = container.querySelector('.ai-md-table-wrap')
    expect(wrap?.getAttribute('role')).toBe('region')
    expect(wrap?.querySelector('th')?.textContent).toBe('Topic')
    expect(wrap?.querySelector('td:last-child')?.textContent).toBe('12%')
  })

  it('renders fenced code in a separate panel with its language and a copy button', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { container } = render(<AIMarkdown content={'Run:\n\n```python\nprint("hi")\n```'} />)
    const panel = container.querySelector('.ai-code-panel')
    expect(panel?.querySelector('.ai-code-head')?.textContent).toContain('python')
    expect(panel?.querySelector('pre code')?.textContent).toBe('print("hi")')
    fireEvent.click(screen.getByRole('button', { name: 'Copy python' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('print("hi")'))
  })

  it('keeps inline code and closes an unfinished fence while streaming', () => {
    const { container } = render(<AIMarkdown content={'Use `x = 1` then\n\n```js\nconst a = 1'} streaming />)
    expect(container.querySelector(':not(pre) > code')?.textContent).toBe('x = 1')
    expect(container.querySelector('.ai-code-panel pre code')?.textContent).toBe('const a = 1')
  })

  it('renders inline and display math with KaTeX (all delimiter styles)', async () => {
    const { container } = render(<AIMarkdown content={'Inline $E=mc^2$ and \\(a^2+b^2\\)\n\n$$\\frac{1}{2}$$\n\n\\[\\sqrt{x}\\]\n\nWater: $\\ce{H2O}$'} />)
    await waitFor(() => expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(5), { timeout: 5000 })
    expect(container.querySelectorAll('.katex-display').length).toBe(2)
    // Visible output is typeset (the TeX source only survives in the MathML annotation for screen readers).
    const visible = [...container.querySelectorAll('.katex-html')].map(node => node.textContent).join(' ')
    expect(visible).not.toContain('\\frac')
    expect(container.querySelector('.ai-markdown > p')?.textContent).not.toContain('$')
  })

  it('never renders raw HTML or unsafe links', () => {
    const { container } = render(<AIMarkdown content={'<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[click](javascript:alert(1)) [ok](https://example.com)\n\n<b onclick="x()">b</b>'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onerror],[onclick]')).toBeNull()
    expect(container.innerHTML).not.toContain('javascript:')
    const link = screen.getByRole('link', { name: 'ok' })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('keeps chemical subscripts and Unicode symbols', () => {
    const { container } = render(<AIMarkdown content={'H~2~O, H<sub>2</sub>SO<sub>4</sub>, x<sup>2</sup>, ∑ ∫ → ≤ ∞'} />)
    expect(container.textContent).toContain('H~2~O')
    expect(container.textContent).toContain('H₂SO₄')
    expect(container.textContent).toContain('x²')
    expect(container.textContent).toContain('∑ ∫ → ≤ ∞')
    expect(container.querySelector('del,sub,sup')).toBeNull()
  })
})

describe('prepareMarkdown', () => {
  it('converts LaTeX delimiters outside code only', () => {
    expect(prepareMarkdown('a \\(x\\) b')).toBe('a $x$ b')
    expect(prepareMarkdown('\\[y\\]')).toContain('$$\ny\n$$')
    expect(prepareMarkdown('`\\(x\\)`')).toBe('`\\(x\\)`')
    expect(prepareMarkdown('```\n\\(x\\)\n```')).toBe('```\n\\(x\\)\n```')
  })
  it('detects when math is present', () => {
    expect(hasMath('just text')).toBe(false)
    expect(hasMath('$x^2$')).toBe(true)
    expect(hasMath('\\frac{1}{2}')).toBe(true)
  })
})

describe('CopyButton', () => {
  it('copies the raw text and announces Copied', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<CopyButton text={'**raw** text'} label="Copy response" />)
    const button = screen.getByRole('button', { name: 'Copy response' })
    await act(async () => { fireEvent.click(button) })
    expect(writeText).toHaveBeenCalledWith('**raw** text')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Copied')
  })
})
