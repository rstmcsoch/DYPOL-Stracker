// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { isOutsideClick, useOutsideMinimize } from './outsideMinimize'
import { clearAIDraft, getAIDraft, setAIDraft } from './aiDraft'

function Harness({ active, onOutside }: { active: boolean; onOutside: () => void }) {
  useOutsideMinimize(active, onOutside)
  return <div>
    <main><p id="page">Page text</p><button id="fab" className="quick-action-fab">Quick</button></main>
    <div className="ai-launcher-wrap"><button id="launcher">Ask</button></div>
    <section className="ai-floating-window"><textarea id="composer" /><p id="answer">Answer</p></section>
    <div className="dialog-backdrop"><div role="dialog"><button id="dialog-btn">OK</button></div></div>
    <div className="toast-stack"><div className="toast"><button id="toast-btn">x</button></div></div>
  </div>
}

const press = (el: Element, from: [number, number], to: [number, number] = from, upTarget: Element = el, button = 0) => {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: from[0], clientY: from[1], button }))
  upTarget.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: to[0], clientY: to[1], button }))
}
const $ = (id: string) => document.getElementById(id) as HTMLElement

describe('Stracker AI outside-click minimise', () => {
  let onOutside: ReturnType<typeof vi.fn<() => void>>
  beforeEach(() => { onOutside = vi.fn<() => void>() })
  afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges() })

  it('minimises on a plain click or tap on the page outside the window', () => {
    render(<Harness active onOutside={onOutside} />)
    press($('page'), [10, 10])
    expect(onOutside).toHaveBeenCalledTimes(1)
  })

  it('minimises when the quick-action button is pressed (so the two never overlap)', () => {
    render(<Harness active onOutside={onOutside} />)
    press($('fab'), [10, 10], [12, 11])
    expect(onOutside).toHaveBeenCalledTimes(1)
  })

  it('ignores clicks inside the window, on its launcher, in dialogs and on toasts', () => {
    render(<Harness active onOutside={onOutside} />)
    for (const id of ['composer', 'answer', 'launcher', 'dialog-btn', 'toast-btn']) press($(id), [5, 5])
    expect(onOutside).not.toHaveBeenCalled()
  })

  it('ignores drags, including a selection drag that starts in the window and ends outside', () => {
    render(<Harness active onOutside={onOutside} />)
    press($('page'), [10, 10], [80, 40])
    press($('answer'), [10, 10], [11, 10], $('page'))
    expect(onOutside).not.toHaveBeenCalled()
  })

  it('ignores a press that selects text (e.g. a double-click), and non-primary buttons', () => {
    render(<Harness active onOutside={onOutside} />)
    $('page').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
    const range = document.createRange(); range.selectNodeContents($('page'))
    window.getSelection()?.addRange(range)
    $('page').dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
    window.getSelection()?.removeAllRanges()
    press($('page'), [10, 10], [10, 10], $('page'), 2)
    expect(onOutside).not.toHaveBeenCalled()
  })

  it('an older, lingering selection does not block a later outside click', () => {
    render(<Harness active onOutside={onOutside} />)
    const range = document.createRange(); range.selectNodeContents($('answer'))
    window.getSelection()?.addRange(range)
    press($('fab'), [10, 10])
    expect(onOutside).toHaveBeenCalledTimes(1)
  })

  it('does nothing while the assistant is not open', () => {
    render(<Harness active={false} onOutside={onOutside} />)
    press($('page'), [10, 10])
    expect(onOutside).not.toHaveBeenCalled()
  })

  it('isOutsideClick needs a matching press start', () => {
    expect(isOutsideClick(null, { x: 0, y: 0, target: document.body })).toBe(false)
  })
})

describe('Stracker AI draft', () => {
  afterEach(clearAIDraft)
  it('keeps the unsent text outside the composer until it is cleared', () => {
    setAIDraft('Which chapters should I')
    expect(getAIDraft()).toBe('Which chapters should I')
    clearAIDraft()
    expect(getAIDraft()).toBe('')
  })
})
