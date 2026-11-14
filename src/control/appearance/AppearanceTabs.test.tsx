// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('./ContentEditor', () => ({ ContentEditorProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('./EditorTabs', () => ({ OverviewTab: () => <p>overview</p>, PublicTab: () => <p>public</p>, NavigationTab: () => <p>nav</p>, StudentThemeTab: () => <p>theme</p> }))
vi.mock('./PublishingTab', () => ({ PublishingTab: () => <p>publishing</p> }))
const { default: AppearancePage } = await import('./AppearancePage')

afterEach(() => cleanup())

describe('Appearance section tabs', () => {
  it.each([
    ['', 'Overview'], ['/public', 'Public website'], ['/navigation', 'Navigation & labels'],
    ['/student-theme', 'Student panel theme'], ['/publishing', 'Preview & publishing']
  ])('marks exactly one tab as current at /control-panel/appearance%s', (suffix, label) => {
    render(<MemoryRouter initialEntries={[`/control-panel/appearance${suffix}`]}><Routes><Route path="/control-panel/appearance/*" element={<AppearancePage />} /></Routes></MemoryRouter>)
    const nav = screen.getByRole('navigation', { name: 'Appearance sections' })
    expect([...nav.querySelectorAll('a[aria-current="page"]')].map(a => a.textContent)).toEqual([label])
    expect(nav.querySelectorAll('a.is-active')).toHaveLength(1)
  })
})
