/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { ControlApiError } from './api'
import { MfaChallengeForm } from './MfaPanels'
import { Button, Dialog } from './ui'

interface ReauthValue {
  /** Opens the fresh-code dialog. Resolves true once a new TOTP verification has succeeded. */
  requestReauth: () => Promise<boolean>
}

const ReauthContext = createContext<ReauthValue | null>(null)

export function ReauthProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const requestReauth = useCallback(() => new Promise<boolean>(resolve => {
    resolver.current = resolve
    setOpen(true)
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
          title="Verify again to continue"
          description="This change needs a fresh authenticator code from the last 15 minutes. Nothing has been changed yet."
          onClose={() => finish(false)}
          footer={<Button variant="ghost" onClick={() => finish(false)}>Cancel</Button>}
        >
          <MfaChallengeForm heading="Enter a fresh code" submitLabel="Verify and retry" onVerified={() => finish(true)} />
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
