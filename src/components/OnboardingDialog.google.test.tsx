// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defaultSettings, needsOnboarding, shouldShowOnboarding } from '../lib/defaults'

// A brand-new Google account: the database trigger created the profile with an empty
// display_name (it reads only raw_user_meta_data.display_name), so settings start empty too.
const upsert = vi.fn(async () => undefined)
const upsertMany = vi.fn(async () => undefined)
const settings = defaultSettings('g-user-1', '')
const profile = { id: 'g-user-1', user_id: 'g-user-1', display_name: '', email: 'student@example.com', updated_at: '2026-11-14T06:00:00Z' }
vi.mock('../contexts/DataContext', () => ({ useData: () => ({ data: { settings, chapters: [], profile }, upsert, upsertMany }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'g-user-1', email: 'student@example.com', displayName: 'Asha Rao', isLocal: false, providers: ['google'] } }) }))
vi.mock('../lib/exams/fetch-catalog', () => ({ fetchExamCatalog: vi.fn(async () => { throw new Error('offline') }) }))

const { OnboardingDialog } = await import('./OnboardingDialog')

afterEach(() => { cleanup(); upsert.mockClear() })

describe('first-time setup for a Google sign-in', () => {
  it('is still mandatory for a new OAuth account', () => {
    expect(needsOnboarding(settings)).toBe(true)
    expect(shouldShowOnboarding({ needed: true, loading: false, profileLoaded: true, syncState: 'synced', alreadyShown: false })).toBe(true)
  })

  it('prefills the Google name, keeps it editable and saves the edited name to settings and the profile', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OnboardingDialog /></QueryClientProvider>)
    const name = screen.getByLabelText(/Your name/) as HTMLInputElement
    expect(name.value).toBe('Asha Rao')
    fireEvent.change(name, { target: { value: 'Asha' } })
    fireEvent.change(screen.getByLabelText(/^Exam/), { target: { value: 'neet-ug' } })
    const year = screen.getByLabelText(/Target year/) as HTMLSelectElement
    fireEvent.change(year, { target: { value: year.options[1]!.value } })
    fireEvent.click(screen.getByLabelText(/Light/))
    fireEvent.click(screen.getByRole('button', { name: 'Start studying' }))
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2))
    expect(upsert.mock.calls[0]).toEqual(['app_settings', expect.objectContaining({ owner_name: 'Asha', onboarding_completed: true })])
    expect(upsert.mock.calls[1]).toEqual(['profiles', expect.objectContaining({ id: 'g-user-1', display_name: 'Asha' })])
  })
})
