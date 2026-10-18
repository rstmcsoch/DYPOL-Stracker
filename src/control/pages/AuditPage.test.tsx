// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TimeZoneProvider } from '../time'

/**
 * Renders the real audit page against a fake API so the request it issues is observable.
 * This is the client half of the "One of the audit filters is not valid" regression: the
 * server test proves which query strings are rejected, this proves the page never sends them.
 */
const harness = vi.hoisted(() => ({
  calls: [] as string[],
  downloads: [] as string[],
  respond: null as null | ((path: string) => unknown)
}))

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    controlFetch: vi.fn(async (path: string) => {
      harness.calls.push(path)
      if (harness.respond) return harness.respond(path)
      return { events: [], total: 0, page: 1, pageSize: 50 }
    }),
    controlDownload: vi.fn(async (path: string) => {
      harness.downloads.push(path)
      return { blob: new Blob(['a,b']), filename: 'audit.csv' }
    })
  }
})
vi.mock('../ControlSession', () => ({
  useControlSession: () => ({ phase: { kind: 'granted', session: { userId: '00000000-0000-4000-8000-000000000001', role: 'owner', aal: 'aal2', recentMfa: true } } })
}))
vi.mock('../reauth', () => ({ useSensitiveAction: () => async <T,>(run: () => Promise<T>) => run() }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ notify: vi.fn() }) }))

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

async function renderAudit(initialEntry = '/control-panel/audit') {
  const { default: AuditPage } = await import('./AuditPage')
  // Same defaults as the app-level QueryClient in src/App.tsx (minus retries, to keep the test fast).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } } })
  return render(
    <QueryClientProvider client={client}>
      <TimeZoneProvider initialMode="utc">
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes><Route path="/control-panel/audit" element={<><AuditPage /><LocationProbe /></>} /></Routes>
        </MemoryRouter>
      </TimeZoneProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => { harness.calls = []; harness.downloads = []; harness.respond = null })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('AuditPage', () => {
  it('loads with no filter parameters besides the display zone and paging', async () => {
    await renderAudit()
    await waitFor(() => expect(harness.calls.length).toBe(1))
    const url = new URL(`https://x/${harness.calls[0]}`)
    expect(url.pathname).toBe('/audit')
    expect([...url.searchParams.keys()].sort()).toEqual(['page', 'pageSize', 'tz'])
    expect(url.searchParams.get('tz')).toBe('UTC')
    expect(url.searchParams.get('page')).toBe('1')
    expect(await screen.findByText('No matching events')).toBeTruthy()
  })

  it('shows every filter with a visible label, including Outcome, and a primary Apply button', async () => {
    await renderAudit()
    const form = screen.getByRole('search', { name: 'Audit log filters' })
    expect(form).toBeTruthy()
    for (const label of ['Action', 'Target account ID', 'From', 'To', 'Outcome']) expect(screen.getByLabelText(label)).toBeTruthy()
    const action = screen.getByLabelText('Action') as HTMLSelectElement
    const options = [...action.options].map(option => option.value)
    expect(options[0]).toBe('')
    expect(options).toContain('control.access')
    expect(options).toContain('user.suspend')
    expect(options).toContain('audit.export')
    const apply = screen.getByRole('button', { name: 'Apply filters' })
    expect(apply.getAttribute('type')).toBe('submit')
    expect(apply.className).toContain('cc-btn--primary')
  })

  it('applies filters to the URL and the request identically, and Clear resets both', async () => {
    await renderAudit()
    await waitFor(() => expect(harness.calls.length).toBe(1))
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'denied' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-04' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(harness.calls.length).toBe(2))
    expect(screen.getByTestId('location').textContent).toBe('/control-panel/audit?outcome=denied&from=2026-10-04')
    const applied = new URL(`https://x/${harness.calls[1]}`).searchParams
    expect(applied.get('outcome')).toBe('denied')
    expect(applied.get('from')).toBe('2026-10-04')
    expect(applied.has('to')).toBe(false)
    expect(applied.has('action')).toBe(false)
    expect(applied.has('target')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/control-panel/audit'))
    expect((screen.getByLabelText('Outcome') as HTMLSelectElement).value).toBe('all')
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('')
    // The cleared query is identical to the initial one, so react-query serves it from cache: no new request.
    expect(harness.calls.length).toBe(2)
  })

  it('shows a field-specific error for an invalid filter and disables export until a query succeeds', async () => {
    const { ControlApiError } = await import('../api')
    harness.respond = path => {
      if (path.includes('from=2026-10-20')) throw new ControlApiError(400, 'invalid_filter', 'The From date is not valid.', 'field:from')
      return { events: [], total: 0, page: 1, pageSize: 50 }
    }
    await renderAudit('/control-panel/audit?from=2026-10-20')
    // Both the field and the results area announce the failure; the field one names the exact control.
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Choose a valid date.').className).toBe('cc-field__error')
    expect(screen.getByText('The From date is not valid.')).toBeTruthy()
    const exportButton = screen.getByRole('button', { name: /Export CSV/ }) as HTMLButtonElement
    expect(exportButton.disabled).toBe(true)
    fireEvent.click(exportButton)
    expect(harness.downloads).toEqual([])

    // The error panel offers its own Clear filters shortcut in addition to the one in the form.
    const clearButtons = screen.getAllByRole('button', { name: 'Clear filters' })
    expect(clearButtons.length).toBe(2)
    fireEvent.click(clearButtons[1]!)
    await waitFor(() => expect((screen.getByRole('button', { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByTestId('location').textContent).toBe('/control-panel/audit')
    expect(screen.queryByText('Choose a valid date.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
    await waitFor(() => expect(harness.downloads.length).toBe(1))
    const exported = new URL(`https://x/${harness.downloads[0]}`).searchParams
    expect(exported.get('format')).toBe('csv')
    expect(exported.get('tz')).toBe('UTC')
    expect(exported.has('from')).toBe(false)
  })
})
