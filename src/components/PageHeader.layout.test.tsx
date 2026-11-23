// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { PageHeader } from './ui'
import { StudentLayoutProvider } from '../contexts/StudentLayoutContext'
import { sanitizeStudentLayout } from '../lib/student-layout/validate'

afterEach(cleanup)

describe('PageHeader with a registered layout id', () => {
  it('renders the shipped DOM when nothing is published', () => {
    const plain = render(<PageHeader eyebrow="TESTS" title="Tests" subtitle="Log every mock" />).container.innerHTML
    cleanup()
    const slotted = render(<PageHeader eyebrow="TESTS" title="Tests" subtitle="Log every mock" layoutId="tests.header" />).container.innerHTML
    cleanup()
    const withNull = render(<StudentLayoutProvider document={null}><PageHeader eyebrow="TESTS" title="Tests" subtitle="Log every mock" layoutId="tests.header" /></StudentLayoutProvider>).container.innerHTML
    expect(slotted).toBe(plain)
    expect(withNull).toBe(plain)
    expect(plain).not.toContain('data-sl')
  })

  it('applies published static wording only', () => {
    const layout = sanitizeStudentLayout({ schemaVersion: 1, components: { 'tests.header': { text: { title: 'My mocks' } } } })
    const { container } = render(<StudentLayoutProvider document={layout}><PageHeader title="Tests" layoutId="tests.header" /></StudentLayoutProvider>)
    expect(container.querySelector('h1')?.textContent).toBe('My mocks')
    expect(container.querySelector('[data-sl="tests.header"]')).not.toBeNull()
  })

  it('renders the page subtitle once, outside the heading, including Live Editor wording', () => {
    const subtitle = 'Rate each card. Good and Easy push it further out.'
    const { container, rerender } = render(<PageHeader title="Formula & flashcards" subtitle={subtitle} layoutId="decks.header" />)
    expect(container.querySelector('h1')?.textContent).toBe('Formula & flashcards')
    expect(container.querySelector('.info-tip')).toBeNull()
    expect(container.querySelector('.page-header-copy p')?.textContent).toBe(subtitle)
    expect((container.textContent?.split(subtitle).length ?? 1) - 1).toBe(1)

    const layout = sanitizeStudentLayout({ schemaVersion: 1, components: { 'decks.header': { text: { title: 'Cards', subtitle: 'Edited subtitle' } } } })
    rerender(<StudentLayoutProvider document={layout}><PageHeader title="Formula & flashcards" subtitle={subtitle} layoutId="decks.header" /></StudentLayoutProvider>)
    expect(container.querySelector('h1')?.textContent).toBe('Cards')
    expect(container.querySelector('.page-header-copy p')?.textContent).toBe('Edited subtitle')
    expect((container.textContent?.match(/Edited subtitle/g) ?? []).length).toBe(1)
  })
})
