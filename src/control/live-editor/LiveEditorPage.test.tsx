// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ controlFetch: vi.fn() }))
vi.mock('../api', async importOriginal => ({ ...(await importOriginal<typeof import('../api')>()), controlFetch: mocks.controlFetch }))

import { ReauthProvider } from '../reauth'
import { UnsavedChangesProvider } from '../unsaved'
import LiveEditorPage from './LiveEditorPage'

const STATE = {
  ok: true,
  draft: { exists: false, overrides: {}, document: null, updatedAt: null, updatedBy: null },
  published: { overrides: {}, document: null, version: 3, publishedAt: '2026-11-16T09:00:00Z', publishedBy: null },
  versions: []
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><UnsavedChangesProvider><ReauthProvider><LiveEditorPage /></ReauthProvider></UnsavedChangesProvider></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  mocks.controlFetch.mockReset()
  mocks.controlFetch.mockImplementation((path: string) => {
    if (path === 'appearance-state') return Promise.resolve(STATE)
    if (path === 'appearance-draft') return Promise.resolve({ ok: true, updatedAt: '2026-11-16T10:00:00Z' })
    return Promise.resolve({ ok: true })
  })
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
afterEach(() => cleanup())

describe('Live Site Editor workspace', () => {
  it('loads the page layers, adds an element, undoes and redoes it', async () => {
    mount()
    const layers = await screen.findByRole('tree', { name: 'Page layers' })
    expect(within(layers).getByText('Hero')).toBeTruthy()
    expect(screen.getByRole('status', { name: '' }).textContent).toContain('Draft saved')

    fireEvent.click(screen.getAllByRole('tab', { name: /Add/ })[0]!)
    fireEvent.click(screen.getByRole('button', { name: /^Heading/ }))
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeTruthy())
    // The new element is selected and its properties are shown.
    expect(screen.getByRole('tablist', { name: 'Properties' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByText('Draft saved')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeTruthy())
  })

  it('autosaves the draft with the revision check and never publishes on its own', async () => {
    mount()
    await screen.findByRole('tree', { name: 'Page layers' })
    fireEvent.click(screen.getAllByRole('tab', { name: /Add/ })[0]!)
    fireEvent.click(screen.getByRole('button', { name: /^Paragraph/ }))
    await waitFor(() => expect(mocks.controlFetch).toHaveBeenCalledWith('appearance-draft', expect.objectContaining({ method: 'PUT' })), { timeout: 5000 })
    const call = mocks.controlFetch.mock.calls.find(([path]) => path === 'appearance-draft')!
    const body = (call[1] as { body: { document: { pages: Record<string, unknown> }; expectedUpdatedAt: unknown } }).body
    expect(body.expectedUpdatedAt).toBeNull()
    expect(Object.keys(body.document.pages)).toEqual(['home'])
    expect(mocks.controlFetch.mock.calls.some(([path]) => path === 'appearance-publish')).toBe(false)
    await waitFor(() => expect(screen.getByText('Draft saved')).toBeTruthy())
  }, 10_000)

  it('Stracker sections can be hidden but not deleted; the publish dialog lists layout changes', async () => {
    mount()
    const layers = await screen.findByRole('tree', { name: 'Page layers' })
    const heroRow = within(layers).getByText('Hero').closest('.le-layer') as HTMLElement
    expect(within(heroRow).queryByRole('button', { name: 'Delete' })).toBeNull()
    fireEvent.click(within(heroRow).getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(heroRow.className).toContain('is-hidden'))
    fireEvent.click(screen.getByRole('button', { name: /Publish/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish to the live site?' })
    expect(within(dialog).getByText(/Page layout, added elements/)).toBeTruthy()
  })

  it('selecting a Stracker section shows its existing text fields', async () => {
    mount()
    const layers = await screen.findByRole('tree', { name: 'Page layers' })
    fireEvent.click(within(layers).getByText('Final CTA'))
    expect(await screen.findByText('Stracker section')).toBeTruthy()
    expect(document.querySelector('[data-field-key="public.final.title"]')).toBeTruthy()
  })

  it('editing a card list moves it into the document once, with the old slots reset', async () => {
    mocks.controlFetch.mockImplementation((path: string) => {
      if (path === 'appearance-state') return Promise.resolve({ ...STATE, published: { ...STATE.published, overrides: { 'public.features.item_1.title': 'Owner title' } } })
      if (path === 'appearance-draft') return Promise.resolve({ ok: true, updatedAt: '2026-11-16T10:00:00Z' })
      return Promise.resolve({ ok: true })
    })
    mount()
    const layers = await screen.findByRole('tree', { name: 'Page layers' })
    fireEvent.click(within(layers).getByText('Feature cards'))
    fireEvent.click(await screen.findByRole('button', { name: 'Hide Owner title' }))
    await waitFor(() => expect(mocks.controlFetch).toHaveBeenCalledWith('appearance-draft', expect.objectContaining({ method: 'PUT' })), { timeout: 5000 })
    const call = mocks.controlFetch.mock.calls.find(([path]) => path === 'appearance-draft')!
    const body = (call[1] as { body: { overrides: Record<string, string>; document: { pages: { home: { blocks: Array<{ id: string; props?: { items?: Array<{ title: string; hidden: boolean }> } }> } } } } }).body
    const items = body.document.pages.home.blocks.find(block => block.id === 'home-features')!.props!.items!
    expect(items).toHaveLength(8)
    expect(items[0]).toMatchObject({ title: 'Owner title', hidden: true })
    expect(Object.keys(body.overrides).some(key => key.startsWith('public.features.item_'))).toBe(false)
  }, 10_000)
})
