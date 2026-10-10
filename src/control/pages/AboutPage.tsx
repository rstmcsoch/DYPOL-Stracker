import { Link } from 'react-router-dom'
import { Panel } from '../ui'
import { PageHeader } from '../pageParts'
import { BrandMark } from '../BrandMark'
import { CONSOLE_BASE, IDLE_TIMEOUT_MS, RECENT_MFA_SECONDS } from '../policy'
import { useControlSession } from '../ControlSession'

export default function AboutPage() {
  const { phase } = useControlSession()
  const session = phase.kind === 'granted' ? phase.session : null
  return (
    <>
      <PageHeader title="Help & about" description="What this console is, how access works, and how to get help." />
      <div className="cc-grid cc-grid--main">
        <Panel title="Stracker Control Center">
          <BrandMark />
          <p className="cc-muted">A private operations console for DYPOL Stracker. It is separate from the public homepage and from the student notebook, and it is never linked from either.</p>
          <p className="cc-muted">Stracker by DYPOL LABS · Control Center</p>
        </Panel>
        <Panel title="Your session">
          <dl className="cc-dl">
            <div><dt>Role</dt><dd>{session?.role ?? '—'}</dd></div>
            <div><dt>Assurance</dt><dd>{session?.aal ?? '—'}</dd></div>
            <div><dt>Idle sign-out</dt><dd>After {IDLE_TIMEOUT_MS / 60000} minutes without activity</dd></div>
            <div><dt>Sensitive changes</dt><dd>Need a code verified within the last {RECENT_MFA_SECONDS / 60} minutes</dd></div>
          </dl>
        </Panel>
      </div>
      <Panel title="How access is controlled" description="The console is protected on the server. Hiding a page is never the control.">
        <ul className="cc-bullets">
          <li>Every request is verified with Supabase Auth before any data is read.</li>
          <li>Access requires an active owner role held in a server-only table. Profile fields, email addresses and browser data never grant it.</li>
          <li>Access requires a second factor (aal2) on every console request.</li>
          <li>Account restrictions require a fresh code, a written reason and the account email typed in full.</li>
          <li>Every privileged action, denial and export is written to an append-only audit log.</li>
        </ul>
      </Panel>
      <Panel title="Getting help" description="Operator documentation lives in the repository.">
        <p>See <code>docs/control-center.md</code> for owner provisioning, the authenticator recovery procedure, and required environment variables. <Link to={`${CONSOLE_BASE}/security`} className="cc-link">Open the security center</Link>.</p>
      </Panel>
    </>
  )
}
