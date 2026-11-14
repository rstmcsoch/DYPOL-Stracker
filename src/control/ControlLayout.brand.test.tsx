// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function filesUnder(path: string): string[] {
  return statSync(path).isDirectory() ? readdirSync(path).flatMap(name => filesUnder(join(path, name))) : [path]
}

const state = { role: 'owner' as string }
Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false }) })
vi.mock('./ControlSession', () => ({ useControlSession: () => ({ signOut: vi.fn(), idle: 'active', markActive: vi.fn(), lastActivity: () => Date.now(), phase: { kind: 'granted', session: { status: 'granted', userId: 'u', role: state.role, permissions: ['overview.view', 'messages.view'], aal: 'aal2', recentMfa: true, idleTimeoutSeconds: 1200 } } }) }))
vi.mock('./api', () => ({ controlFetch: vi.fn(async () => ({ unread: 0 })) }))
vi.mock('./ControlTheme', () => ({ ControlThemeSwitch: () => null }))
vi.mock('./CommandLauncher', () => ({ CommandLauncher: () => null }))
const { ControlLayout } = await import('./ControlLayout')
const { TimeZoneProvider } = await import('./time')
const { UnsavedChangesProvider } = await import('./unsaved')

function renderLayout() {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/control-panel']}><TimeZoneProvider><UnsavedChangesProvider>
    <ControlLayout><p>Page</p></ControlLayout>
  </UnsavedChangesProvider></TimeZoneProvider></MemoryRouter></QueryClientProvider>)
}

afterEach(() => { cleanup(); state.role = 'owner' })

describe('Control Centre branding and owner avatar', () => {
  it('says "Control Centre" with the Stracker logo and no old title or subtitle', () => {
    renderLayout()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Control Centre')
    expect(text).not.toMatch(/Stracker Control Cent|Control Center|Private operations console/)
    expect(document.querySelector('.cc-brand img')?.getAttribute('src')).toBe('/icons/stracker.svg')
  })

  it('shows the owner’s D. logo in the account button', () => {
    renderLayout()
    const button = screen.getByRole('button', { name: /Account menu: Owner/ })
    const img = button.querySelector('img')
    expect(img?.getAttribute('src')).toBe('/control/owner-avatar-64.webp')
    expect(img?.getAttribute('srcset')).toContain('/control/owner-avatar-128.webp 2x')
    expect(button.textContent).not.toContain('OW')
    fireEvent.click(button)
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('keeps initials for every other role', () => {
    for (const [role, initials] of [['administrator', 'AD'], ['moderator', 'MO'], ['viewer', 'VI']] as const) {
      state.role = role
      renderLayout()
      const button = screen.getByRole('button', { name: /Account menu/ })
      expect(button.querySelector('img')).toBeNull()
      expect(button.textContent).toContain(initials)
      cleanup()
    }
  })

  it('ships tiny avatar files, referenced only by the Control Centre', () => {
    expect(statSync('public/control/owner-avatar-64.webp').size).toBeLessThan(4096)
    expect(statSync('public/control/owner-avatar-128.webp').size).toBeLessThan(8192)
    const outside = ['src/App.tsx', 'src/components', 'src/pages', 'index.html']
    for (const file of outside.flatMap(filesUnder)) expect(readFileSync(file, 'utf8'), file).not.toContain('owner-avatar')
    expect(filesUnder('src/control').some(file => readFileSync(file, 'utf8').includes('/control/owner-avatar-64.webp'))).toBe(true)
  })
})
