// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../contexts/ToastContext'
import { TimeZoneProvider } from '../time'

const calls = vi.hoisted(() => [] as Array<{ path: string; init?: { method?: string; body?: unknown } }>)
const id = '11111111-1111-4111-8111-111111111111'

vi.mock('../api', () => ({
  controlFetch: async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, init })
    if (path.startsWith('messages?status=')) return { messages: [{ id, created_at: '2026-11-14T04:00:00Z', name: 'Asha', email: 'asha@example.com', reason: 'bug_report', subject: 'Planner will not save', status: 'new', read_at: null, preview: 'When I drag a task…', fileCount: 1, linkCount: 1 }], total: 1, unread: 1, page: 1, pageSize: 25 }
    if (path === `messages?id=${id}`) return { message: { id, created_at: '2026-11-14T04:00:00Z', name: 'Asha', email: 'asha@example.com', reason: 'bug_report', subject: 'Planner will not save', message: 'When I drag a task it jumps back.', details: { area: 'Planner', device: 'Android tablet', actual: 'Old-form answer' }, links: ['https://example.com/video', 'javascript:alert(1)'], status: 'new', read_at: null, signedIn: true, files: [{ name: 'shot.png', size: 2048, type: 'image/png', viewUrl: 'https://x.supabase.co/v', downloadUrl: 'https://x.supabase.co/d' }], linkExpiresInSeconds: 300 } }
    if (path === 'messages') return (init?.body as { action: string }).action === 'delete' ? { deleted: true } : { status: (init?.body as { status: string }).status }
    throw new Error(`unexpected ${path}`)
  }
}))

import { readFileSync } from 'node:fs'
import MessagesPage from './MessagesPage'
import { NAV_GROUPS, activeNavItem } from '../policy'
import { replyHref, safeHttpUrl } from './format'

afterEach(() => { cleanup(); calls.length = 0 })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ToastProvider><TimeZoneProvider><MessagesPage /></TimeZoneProvider></ToastProvider></QueryClientProvider>)
}

describe('Control Center → Messages', () => {
  it('lists messages, opens one, marks it read and renders details, safe links and files', async () => {
    renderPage()
    const row = await screen.findByRole('button', { name: /Asha/ })
    expect(screen.getByText(/1 message · 1 unread/)).toBeTruthy()
    fireEvent.click(row)
    await screen.findByText('When I drag a task it jumps back.')
    await waitFor(() => expect(calls.some(call => call.path === 'messages' && (call.init?.body as { status?: string }).status === 'read')).toBe(true))
    const labels = [...document.querySelectorAll('.cc-msg-details dt')].map(term => term.textContent)
    expect(labels).toEqual(['Where it happened', 'What went wrong', 'Device and browser', 'What actually happened'])
    expect(screen.getByText('When I drag a task it jumps back.')).toBeTruthy()
    expect(screen.getByText('Old-form answer')).toBeTruthy()
    expect(screen.getByText('Android tablet')).toBeTruthy()
    const link = screen.getByRole('link', { name: /example\.com\/video/ })
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow')
    expect(screen.queryByRole('link', { name: /javascript/ })).toBeNull()
    expect(screen.getByText('javascript:alert(1)')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Attachment shot.png' }).getAttribute('src')).toBe('https://x.supabase.co/v')
    expect(screen.getByRole('link', { name: /Reply by email/ }).getAttribute('href')).toMatch(/^mailto:asha@example\.com\?subject=Re%3A%20Planner/)
  })

  it('filters by status, reason and search', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Asha/ })
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.change(screen.getByLabelText('Filter by reason'), { target: { value: 'copyright' } })
    await waitFor(() => expect(calls.some(call => call.path.includes('status=archived') && call.path.includes('reason=copyright'))).toBe(true))
    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'planner' } })
    await waitFor(() => expect(calls.some(call => call.path.includes('q=planner'))).toBe(true))
  })

  it('asks before deleting', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Asha/ }))
    await screen.findByText('When I drag a task it jumps back.')
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
    expect(screen.getByRole('dialog', { name: 'Delete this message?' })).toBeTruthy()
    expect(calls.some(call => (call.init?.body as { action?: string } | undefined)?.action === 'delete')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete message' }))
    await waitFor(() => expect(calls.some(call => (call.init?.body as { action?: string } | undefined)?.action === 'delete')).toBe(true))
  })
})

describe('Messages tab wiring', () => {
  it('the Control Center sidebar has a Messages tab at /control-panel/messages', () => {
    const items = NAV_GROUPS.flatMap(group => group.items)
    expect(items.find(item => item.label === 'Messages')).toMatchObject({ to: 'messages', icon: 'messages' })
    expect(activeNavItem('/control-panel/messages')?.label).toBe('Messages')
    const app = readFileSync(`${process.cwd()}/src/control/ControlPanelApp.tsx`, 'utf8')
    expect(app).toContain('<Route path="messages" element={<MessagesPage />} />')
    expect(readFileSync(`${process.cwd()}/src/control/ControlLayout.tsx`, 'utf8')).toContain("controlFetch<{ unread: number }>('messages?summary=1')")
  })

  it('renders only http(s) links and builds a reply mailto', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('https://a.example/x')).toBe('https://a.example/x')
    expect(replyHref({ email: 'asha@example.com', subject: null, reason: 'bug_report' })).toBe('mailto:asha@example.com?subject=Re%3A%20Bug%20report%20%C2%B7%20Stracker')
    const page = readFileSync(`${process.cwd()}/src/control/messages/MessagesPage.tsx`, 'utf8')
    expect(page.match(/rel="noopener noreferrer nofollow"/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
