import { DataProvider } from '../contexts/DataContext'
import { AIProvider } from '../contexts/AIContext'
import { AppearanceProvider } from '../contexts/AppearanceContext'
import { FocusProvider } from '../contexts/FocusContext'
import { StudentLayoutProvider } from '../contexts/StudentLayoutContext'
import { AppFrame } from './AppShell'
import { AccountNoticeGate } from './AccountNoticeGate'
import type { AppUser } from '../contexts/AuthContext'

/**
 * Signed-in student notebook shell and provider stack, split into its own lazy chunk so
 * public homepage, auth and legal visitors never download or parse Dexie, DataContext,
 * AIContext, FocusContext, StudentLayoutContext or AppShell on initial load.
 */
export default function ProtectedAppShell({ user }: { user: AppUser }) {
  return <>
    <DataProvider key={user.id}>
      <AIProvider>
        <AppearanceProvider>
          <FocusProvider key={user.id}>
            <StudentLayoutProvider><AppFrame /></StudentLayoutProvider>
          </FocusProvider>
        </AppearanceProvider>
      </AIProvider>
    </DataProvider>
    {/* After the app in the DOM so its popup sits above any other dialog. */}
    {!user.isLocal && <AccountNoticeGate key={user.id} userId={user.id} />}
  </>
}
