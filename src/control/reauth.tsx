/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { ControlApiError } from './api'
import { MfaChallengeForm } from './MfaPanels'
import { Button, Dialog } from './ui'
import { PasskeyOption } from './gates'

interface ReauthValue {
  /** Opens the fresh-code dialog. Resolves true once a new TOTP verification has succeeded. */
  requestReauth: (purpose?: 'reauth' | 'step-up') => Promise<boolean>
}

const ReauthContext = createContext<ReauthValue | null>(null)

/**
 * `passkey` is true only for the owner with a registered passkey (from /session). Everyone else
 * confirms with an authenticator code; the server refuses passkey step-up for non-owners anyway.
 */
export function ReauthProvider({ children, passkey = false }: { children: ReactNode; passkey?: boolean }) {
  const [open, setOpen] = useState<false | 'reauth' | 'step-up'>(false)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const requestReauth = useCallback((purpose: 'reauth' | 'step-up' = 'reauth') => new Promise<boolean>(resolve => {
    resolver.current = resolve
    setOpen(purpose)
  }), [])

  const finish = (ok: boolean) => {
    setOpen(false)
    resolver.current?.(ok)
    resolver.current = null
  }

  return (
    <ReauthContext.Provider value={{ requestReauth }}>
      {children}
      {open && (
        <Dialog
          title={open === 'step-up' ? (passkey ? 'Confirm with your passkey or authenticator' : 'Confirm with your authenticator') : 'Verify again to continue'}
          description={open === 'step-up'
            ? (passkey ? 'This change is only applied after a fresh confirmation: your passkey, or a code from your authenticator app. Nothing changes until you confirm.' : 'This change is only applied after a fresh code from your own authenticator app. Nothing changes until you confirm.')
            : 'This change needs a fresh confirmation from the last 15 minutes. Nothing has been changed yet.'}
          onClose={() => finish(false)}
          footer={<Button variant="ghost" onClick={() => finish(false)}>Cancel</Button>}
        >
          {passkey && <PasskeyOption label={open === 'step-up' ? 'Confirm with passkey' : 'Use passkey'} onVerified={() => finish(true)} />}
          <MfaChallengeForm heading="Enter the 6-digit code" submitLabel={open === 'step-up' ? 'Confirm and save' : 'Verify and retry'} onVerified={() => finish(true)} />
        </Dialog>
      )}
    </ReauthContext.Provider>
  )
}

/**
 * Runs a sensitive server call. If the server answers reauthentication_required, the user
 * verifies a fresh code and the call is retried exactly once. The server still decides.
 */
export function useSensitiveAction() {
  const value = useContext(ReauthContext)
  if (!value) throw new Error('useSensitiveAction must be used inside ReauthProvider')
  return useCallback(async <T,>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      if (error instanceof ControlApiError && error.code === 'reauthentication_required') {
        const verified = await value.requestReauth()
        if (verified) return run()
      }
      throw error
    }
  }, [value])
}

/**
 * Step-up for Settings: EVERY save first asks for a fresh authenticator code (a new Supabase MFA
 * challenge + verify), then sends the change once. The server accepts a verification only if it
 * is under two minutes old and has not authorized another save. If the server still answers
 * step_up_required (the code aged out, or was already used), the person is asked once more.
 * Resolves null when the person cancels; nothing is sent in that case.
 */
export function useStepUp() {
  const value = useContext(ReauthContext)
  if (!value) throw new Error('useStepUp must be used inside ReauthProvider')
  return useCallback(async <T,>(save: () => Promise<T>): Promise<T | null> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const verified = await value.requestReauth('step-up')
      if (!verified) return null
      try {
        return await save()
      } catch (error) {
        if (error instanceof ControlApiError && error.code === 'step_up_required' && attempt === 0) continue
        throw error
      }
    }
    return null
  }, [value])
}
