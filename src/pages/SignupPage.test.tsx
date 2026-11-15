// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const signUp = vi.fn()
const resendConfirmation = vi.fn()
const clearError = vi.fn()
const notify = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signInWithOAuth: vi.fn() } },
  supabaseConfigured: true,
  localPreviewEnabled: false
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ signUp, resendConfirmation, error: null, clearError, loading: false })
}))
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ notify })
}))
const isDisposableEmail = vi.fn()
vi.mock('../lib/disposable-email', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/disposable-email')>()
  return {
    DISPOSABLE_EMAIL_MESSAGE: actual.DISPOSABLE_EMAIL_MESSAGE,
    createDisposableEmailPrecheck: () => actual.createDisposableEmailPrecheck((email: string) => isDisposableEmail(email))
  }
})
vi.mock('../components/public/PublicHeader', () => ({ PublicBrand: () => <span>Stracker</span>, PublicThemeToggle: () => null }))

const { default: SignupPage } = await import('./SignupPage')

function visit() {
  return render(<MemoryRouter initialEntries={['/signup']}>
    <Routes>
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/" element={<h1>Notebook home</h1>} />
      <Route path="/login" element={<h1>Log in</h1>} />
    </Routes>
  </MemoryRouter>)
}

function fillStep1(name = 'Ada', email = 'ada@example.com') {
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
}

beforeEach(() => {
  signUp.mockReset()
  resendConfirmation.mockReset()
  clearError.mockReset()
  notify.mockReset()
  signUp.mockResolvedValue({ needsEmailConfirmation: false })
  isDisposableEmail.mockReset()
  isDisposableEmail.mockResolvedValue(false)
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example-ref.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key')
  vi.stubEnv('VITE_GOOGLE_AUTH_FORCE_VISIBLE', '1')
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('two-step sign-up', () => {
  it('starts on step 1 with name and email, a Next button, and Google sign-up', () => {
    visit()
    expect(screen.getByText('Step 1 of 2')).toBeTruthy()
    expect(screen.getByLabelText('Your name')).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByLabelText('Confirm password')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create my Stracker account' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign up with Google' })).toBeTruthy()
  })

  it('stays on step 1 and shows field errors when name or email is missing', () => {
    visit()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Tell Stracker what to call you.')).toBeTruthy()
    expect(screen.getByText('Enter the email address you want to sign in with.')).toBeTruthy()
    expect(screen.getByText('Step 1 of 2')).toBeTruthy()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('rejects an incomplete email before advancing', () => {
    visit()
    fillStep1('Ada', 'not-an-email')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('That email address does not look complete.')).toBeTruthy()
    expect(screen.getByText('Step 1 of 2')).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('advances to the password step when name and email are valid, including when Enter is pressed', async () => {
    visit()
    fillStep1()
    fireEvent.submit(screen.getByRole('button', { name: 'Next' }).closest('form')!)
    expect(await screen.findByText('Step 2 of 2')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.getByLabelText('Confirm password')).toBeTruthy()
    expect(screen.queryByLabelText('Your name')).toBeNull()
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create my Stracker account' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign up with Google' })).toBeNull()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('keeps the entered name and email when going back from step 2', async () => {
    visit()
    fillStep1('Ada Lovelace', 'ada@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'secretword' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Step 1 of 2')).toBeTruthy()
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Ada Lovelace')
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('ada@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect((await screen.findByLabelText('Password') as HTMLInputElement).value).toBe('secretword')
  })

  it('does not create an account when the password is too short or the confirmation does not match', async () => {
    visit()
    fillStep1()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create my Stracker account' }))
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy()
    expect(screen.getByText('Those passwords do not match.')).toBeTruthy()
    expect(screen.getByText('Step 2 of 2')).toBeTruthy()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('submits the account from step 2 with the values collected on both steps', async () => {
    visit()
    fillStep1('Ada Lovelace', 'ada@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'secretword' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secretword' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create my Stracker account' }))
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))
    expect(signUp).toHaveBeenCalledWith('ada@example.com', 'secretword', 'Ada Lovelace', undefined)
    expect(await screen.findByRole('heading', { name: 'Notebook home' })).toBeTruthy()
  })

  it('shows the confirmation screen when Supabase still needs the emailed link', async () => {
    signUp.mockResolvedValue({ needsEmailConfirmation: true })
    visit()
    fillStep1('Ada', 'ada@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'secretword' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secretword' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create my Stracker account' }))
    expect(await screen.findByRole('heading', { name: 'Confirm your email' })).toBeTruthy()
    expect(screen.getByText(/ada@example.com/)).toBeTruthy()
  })

  it('stops on step 1 with a clear message for a disposable email address', async () => {
    isDisposableEmail.mockResolvedValue(true)
    visit()
    fillStep1('Ada', 'ada@mailinator.com')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Temporary or disposable email addresses aren\'t allowed. Please use your regular email.')).toBeTruthy()
    expect(screen.getByText('Step 1 of 2')).toBeTruthy()
    expect(isDisposableEmail).toHaveBeenCalledWith('ada@mailinator.com')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('shows nothing while typing a disposable address; the warning appears only on Next', async () => {
    isDisposableEmail.mockResolvedValue(true)
    visit()
    fillStep1('Ada', 'ada@mailinator.com')
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(isDisposableEmail).toHaveBeenCalledWith('ada@mailinator.com')
    expect(screen.queryByText(/disposable email addresses/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/disposable email addresses/)).toBeTruthy()
    expect(isDisposableEmail).toHaveBeenCalledTimes(1)
  })

  it('never checks built-in providers such as Gmail', async () => {
    visit()
    fillStep1('Ada', ['ada', 'gmail.com'].join('@'))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Step 2 of 2')).toBeTruthy()
    expect(isDisposableEmail).not.toHaveBeenCalled()
  })

  it('does not hold up Next for long when the check is slow', async () => {
    isDisposableEmail.mockImplementation(() => new Promise(() => undefined))
    visit()
    fillStep1('Ada', 'ada@slow-domain.org')
    const started = Date.now()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Step 2 of 2', {}, { timeout: 2000 })).toBeTruthy()
    expect(Date.now() - started).toBeLessThan(1500)
  })
})
