import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { Panel } from '../ui'
import { PageHeader } from '../pageParts'
import { BrandMark } from '../BrandMark'
import { CONSOLE_BASE, IDLE_TIMEOUT_MS, RECENT_MFA_SECONDS } from '../policy'
import { useControlSession } from '../ControlSession'
import { useTimeZone } from '../time'

/** The operator handbook lives in the repository; this is the published copy of that file. */
export const CONTROL_CENTER_DOCS_URL = 'https://github.com/rstmcsoch/DYPOL-Stracker/blob/main/docs/control-center.md'

export default function AboutPage() {
  const { phase } = useControlSession()
  const { longLabel } = useTimeZone()
  const session = phase.kind === 'granted' ? phase.session : null
  return (
    <>
      <PageHeader title="Help & About" description="What this console is, how access works, and how to get help." />
      <div className="cc-stack">
        <div className="cc-grid cc-grid--main">
          <Panel title="Stracker Control Center">
            <div className="cc-stack cc-stack--tight">
              <BrandMark />
              <p className="cc-muted">A private operations console for DYPOL Stracker. It is separate from the public homepage and from the student notebook, and it is never linked from either. The address stays <code>/control-panel/</code> for compatibility with existing bookmarks.</p>
              <p className="cc-muted">Stracker by DYPOL LABS · Control Center</p>
            </div>
          </Panel>
          <Panel title="Your session">
            <dl className="cc-dl">
              <div><dt>Role</dt><dd>{session?.role ?? '—'}</dd></div>
              <div>
                <dt>Assurance</dt>
                <dd>
                  {session?.aal ?? '—'}
                  <span className="cc-dl__note">{session?.aal === 'aal2' ? 'Authenticator Assurance Level 2: this session completed two-step verification with an authenticator app. Every console request requires it.' : 'Authenticator Assurance Level 2 (two-step verification) is required for every console request.'}</span>
                </dd>
              </div>
              <div><dt>Idle sign-out</dt><dd>After {IDLE_TIMEOUT_MS / 60000} minutes without activity, with a warning 2 minutes before</dd></div>
              <div><dt>Sensitive changes</dt><dd>Requires an authenticator code verified within the last {RECENT_MFA_SECONDS / 60} minutes</dd></div>
              <div><dt>Dates and times</dt><dd>Shown in {longLabel}; stored in UTC. Change the zone on the Overview or Audit log page.</dd></div>
            </dl>
          </Panel>
        </div>
        <Panel title="How access is controlled" description="The console is protected on the server. Hiding a page is never the control.">
          <ul className="cc-bullets">
            <li>Every request is verified with Supabase Auth before any data is read.</li>
            <li>Access requires an active owner role held in a server-only table. Profile fields, email addresses and browser data never grant it.</li>
            <li>Access requires a second factor on every console request (<code>aal2</code>: Authenticator Assurance Level 2, meaning a verified authenticator-app code in this session).</li>
            <li>Account restrictions require a fresh code, a written reason and the account email typed in full.</li>
            <li>Console access, denials, privileged account changes and exports are written to an append-only audit log.</li>
          </ul>
        </Panel>
        <Panel title="Getting help" description="Operator documentation lives in the repository.">
          <p>
            Read <a href={CONTROL_CENTER_DOCS_URL} target="_blank" rel="noopener noreferrer" className="cc-link cc-link--icon">docs/control-center.md on GitHub <ExternalLink size={13} aria-hidden="true" /><span className="cc-sr-only"> (opens in a new tab)</span></a> for
            owner provisioning, the authenticator recovery procedure, the time-zone policy, the list of audit events and the required environment variables.
            {' '}<Link to={`${CONSOLE_BASE}/security`} className="cc-link">Open the security center</Link>.
          </p>
        </Panel>
      </div>
    </>
  )
}
