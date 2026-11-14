/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { ControlApiError } from './api'
import { MfaChallengeForm } from './MfaPanels'
import { Button, Dialog } from './ui'

interface ReauthValue {
  /** Opens the fresh-code dialog. Resolves true once a new TOTP verification has succeeded. */
  requestReauth: (purpose?: 'reauth' | 'step-up') => Promise<boolean>
}

const ReauthContext = createContext<ReauthValue | null>(null)

export function ReauthProvider({ children }: { children: ReactNode }) {
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
          title={open === 'step-up' ? 'Confirm with your authenticator' : 'Verify again to continue'}
          description={open === 'step-up'
            ? 'Settings are only saved after a fresh code from your own authenticator app. Nothing is saved until you confirm.'
            : 'This change needs a fresh authenticator code from the last 15 minutes. Nothing has been changed yet.'}
          onClose={() => finish(false)}
          footer={<Button variant="ghost" onClick={() => finish(false)}>Cancel</Button>}
        >
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
