// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { Switch } from './ui'

afterEach(() => cleanup())

describe('Switch', () => {
  it('is a focusable native button with role="switch" and aria-checked', () => {
    const onChange = vi.fn()
    render(<Switch label="Viewer: View analytics" checked={false} onChange={onChange} />)
    const control = screen.getByRole('switch', { name: 'Viewer: View analytics' })
    expect(control.tagName).toBe('BUTTON') // Space and Enter activate a button natively
    expect(control.getAttribute('type')).toBe('button')
    expect(control.getAttribute('aria-checked')).toBe('false')
    control.focus()
    expect(document.activeElement).toBe(control)
    fireEvent.click(control)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('reports on, honours disabled, and can be labelled by visible text', () => {
    const onChange = vi.fn()
    render(<><span id="lbl">Allow new sign-ups</span><Switch labelledBy="lbl" checked onChange={onChange} disabled /></>)
    const control = screen.getByRole('switch', { name: 'Allow new sign-ups' })
    expect(control.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(control)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('has themed styles with a visible focus ring and reduced-motion support', () => {
    const css = readFileSync('src/control/control.css', 'utf8')
    expect(css).toContain('.cc-switch:focus-visible')
    expect(css).toContain('.cc-switch[aria-checked="true"]')
    expect(css).toMatch(/prefers-reduced-motion[^}]*cc-switch/)
  })
})
