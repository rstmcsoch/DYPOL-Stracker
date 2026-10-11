import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CONSOLE_BASE, formatDateTime } from '../policy'
import { Disclosure, Panel } from '../ui'
import { useContentEditor, fieldsForArea } from './ContentEditor'
import { FieldRow, LinkSuggestions, SaveBar } from './FieldRow'
import type { FieldDefinition } from '../../lib/site-content/registry'
import { useTimeZone } from '../time'

type Notice = { tone: 'ok' | 'crit'; text: string } | null

/** Groups fields by a key function while keeping first-seen order. */
function groupBy<T>(items: T[], keyOf: (item: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.entries()]
}

function matchesQuery(definition: FieldDefinition, text: string, value: string): boolean {
  if (!text) return true
  const haystack = `${definition.label} ${definition.page} ${definition.section} ${definition.key} ${value}`.toLowerCase()
  return haystack.includes(text)
}

/* ------------------------------------------------------------------ overview */

export function OverviewTab() {
  const { state, loading, loadError, reload, dirtyKeys, draftExists, draftChanges } = useContentEditor()
  const { zone } = useTimeZone()
  const publicFields = fieldsForArea('public')
  const userFields = fieldsForArea('user')
  const publicLive = Object.keys(state?.published.overrides ?? {}).filter(key => key.startsWith('public.')).length
  const userLive = Object.keys(state?.published.overrides ?? {}).filter(key => key.startsWith('user.')).length

  if (loadError) return <Panel title="Appearance could not be loaded"><p className="cc-muted">{loadError.message}</p><button type="button" className="cc-btn cc-btn--default cc-btn--sm" onClick={reload}>Try again</button></Panel>

  return <>
    <div className="cc-appearance-grid">
      <Panel title="Draft and live copy" description="Drafts are saved for you only. Visitors see the live copy until you publish.">
        <dl className="cc-dl">
          <div><dt>Live version</dt><dd>{state && state.published.version > 0 ? `Version ${state.published.version}` : 'Built-in copy (nothing published yet)'}</dd></div>
          <div><dt>Published</dt><dd>{state?.published.publishedAt ? formatDateTime(state.published.publishedAt, zone) : '—'}</dd></div>
          <div><dt>Unpublished draft</dt><dd>{loading ? 'Loading…' : draftExists ? `${draftChanges.length} ${draftChanges.length === 1 ? 'change' : 'changes'} saved, not live` : 'None'}</dd></div>
          <div><dt>Unsaved on screen</dt><dd>{dirtyKeys.length}</dd></div>
        </dl>
        <p className="cc-muted"><Link className="cc-link" to={`${CONSOLE_BASE}/appearance/publishing`}>Review, preview and publish →</Link></p>
      </Panel>
      <Panel title="Public website" description="Copy shown before sign-in: homepage, header, footer and page title.">
        <dl className="cc-dl">
          <div><dt>Editable items</dt><dd>{publicFields.length}</dd></div>
          <div><dt>Customised in the live copy</dt><dd>{publicLive}</dd></div>
        </dl>
        <p className="cc-muted"><Link className="cc-link" to={`${CONSOLE_BASE}/appearance/public`}>Edit public website copy →</Link></p>
      </Panel>
      <Panel title="Navigation and labels" description="Words in the notebook menu. Destinations, icons and access rules stay fixed.">
        <dl className="cc-dl">
          <div><dt>Editable labels</dt><dd>{userFields.length}</dd></div>
          <div><dt>Customised in the live copy</dt><dd>{userLive}</dd></div>
        </dl>
        <p className="cc-muted"><Link className="cc-link" to={`${CONSOLE_BASE}/appearance/navigation`}>Edit navigation labels →</Link></p>
      </Panel>
    </div>

    <Panel title="What this section manages" description="Only items that are wired to the live pages are shown. Anything not listed is system-controlled.">
      <div className="cc-coverage">
        <div>
          <h3>Managed here</h3>
          <ul className="cc-bullets">
            <li>Public homepage: headings, introductions, highlights, feature and principle cards, steps, AI and privacy copy, final call to action.</li>
            <li>Public header and footer labels, footer column headings, and the homepage browser title and description.</li>
            <li>Homepage button labels and destinations (validated: public pages, homepage sections, or https addresses).</li>
            <li>Promotional video section: show or hide, optional heading and text, player size, frame shape, position, and replacing the video and poster.</li>
            <li>Public website appearance: default light/dark/system mode and an accent colour preset.</li>
            <li>Feature cards: order, show or hide each card, and its icon.</li>
            <li>Notebook navigation labels and group headings. Changing a label never changes where it leads.</li>
          </ul>
        </div>
        <div>
          <h3>Not managed yet (system-controlled)</h3>
          <ul className="cc-bullets">
            <li>Logos, favicon, uploaded images, brand colours, typography and design tokens.</li>
            <li>Section order, section visibility and card counts.</li>
            <li>Sign-in, sign-up and password pages, and the notebook’s own page copy.</li>
            <li>Statistics, counts, progress figures and any calculated value: they always come from your data.</li>
          </ul>
        </div>
      </div>
    </Panel>
  </>
}

/* ------------------------------------------------------------- public website */

export function PublicTab() {
  const { loading, loadError, reload, values } = useContentEditor()
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const text = query.trim().toLowerCase()
  const fields = fieldsForArea('public')
  const visible = useMemo(() => fields.filter(definition => matchesQuery(definition, text, values[definition.key] ?? '')), [fields, text, values])
  const pages = groupBy(visible, definition => definition.page)

  if (loadError) return <Panel title="Public website copy could not be loaded"><p className="cc-muted">{loadError.message}</p><button type="button" className="cc-btn cc-btn--default cc-btn--sm" onClick={reload}>Try again</button></Panel>
  if (loading) return <Panel title="Public website"><p className="cc-muted">Loading the current copy…</p></Panel>

  return <>
    <LinkSuggestions />
    <div className="cc-search cc-editor-search">
      <label htmlFor="cc-copy-search" className="cc-sr-only">Search public website copy</label>
      <input id="cc-copy-search" type="search" placeholder="Search by label, section or current text" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    <p className="cc-muted cc-editor-count">{visible.length} of {fields.length} items shown. Changes are saved as a draft first; publish them from Preview &amp; publishing.</p>

    {pages.length === 0 && <Panel title="No matches"><p className="cc-muted">Nothing matches “{query}”. Try a shorter search, or clear it.</p></Panel>}
    {pages.map(([page, pageFields]) => <Panel key={page} title={page} description={`${pageFields.length} ${pageFields.length === 1 ? 'item' : 'items'}`}>
      <div className="cc-stack">
        {groupBy(pageFields, definition => definition.section).map(([section, sectionFields]) => (
          <Disclosure key={section} summary={<>{section} <span className="cc-muted">({sectionFields.length})</span></>} className="cc-copy-section" >
            <div className="cc-stack">
              {sectionFields.map(definition => <FieldRow key={definition.key} definition={definition} showContext={false} />)}
            </div>
          </Disclosure>
        ))}
      </div>
    </Panel>)}

    <SaveBar notice={notice} onNotice={setNotice} />
  </>
}

/* ----------------------------------------------------------- navigation labels */

export function NavigationTab() {
  const { loading, loadError, reload, values } = useContentEditor()
  const [notice, setNotice] = useState<Notice>(null)
  const fields = fieldsForArea('user')
  const groups = groupBy(fields, definition => definition.section)
  const itemLabels = fields.filter(definition => !definition.key.includes('.group.'))

  if (loadError) return <Panel title="Navigation labels could not be loaded"><p className="cc-muted">{loadError.message}</p><button type="button" className="cc-btn cc-btn--default cc-btn--sm" onClick={reload}>Try again</button></Panel>
  if (loading) return <Panel title="Navigation & labels"><p className="cc-muted">Loading the current labels…</p></Panel>

  return <>
    <LinkSuggestions />
    <Panel title="How this works" description="Labels only. A label cannot change where an item leads, which icon it uses, which group it sits in, or who may open it.">
      <p className="cc-muted">Sign-out, Settings and Export &amp; backup are always present in the menu; no label can remove them.</p>
    </Panel>
    {groups.map(([section, sectionFields]) => <Panel key={section} title={section} description={section === 'Items' ? 'Menu items in the notebook. Each row names the destination in brackets.' : 'Headings above each group of menu items.'}>
      <div className="cc-stack">
        {sectionFields.map(definition => <FieldRow key={definition.key} definition={definition} showContext={false} />)}
      </div>
    </Panel>)}
    <Panel title="Menu preview" description="How the labels read with the current draft. Groups and order are fixed.">
      <ul className="cc-nav-preview" aria-label="Menu label preview">
        {itemLabels.map(definition => <li key={definition.key}><span>{values[definition.key] ?? definition.defaultValue}</span><code>{definition.key.replace('user.nav.', '').replace('.label', '')}</code></li>)}
      </ul>
    </Panel>
    <SaveBar notice={notice} onNotice={setNotice} />
  </>
}

