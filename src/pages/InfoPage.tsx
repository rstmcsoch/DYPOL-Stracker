import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useSiteContentSettled, useSiteValues } from '../contexts/SiteContentContext'
import { CONTACT_PAGE_PATH, INFO_PAGE_PATHS, infoBlocks, infoPageAvailable, infoPageBody, type InfoBlock, type InfoPageKind } from '../lib/site-content/info-pages'
import { PublicPageShell } from '../components/public/PublicPageShell'
import NotFoundPage from './NotFoundPage'

const PRIVACY_ITEM_COUNT = 6

const TITLES: Record<InfoPageKind, string> = { privacy: 'Privacy Policy', terms: 'Terms & Conditions', about: 'About Stracker' }

const DESCRIPTIONS: Record<InfoPageKind, string> = {
  privacy: 'What Stracker by DYPOL LABS collects, why, where it is kept, and the choices you have.',
  terms: 'The terms for using the Stracker website, study notebook, Stracker AI and Contact page.',
  about: 'Stracker is a digital study notebook by DYPOL LABS for students preparing for an exam.'
}

function Block({ block }: { block: InfoBlock }) {
  if (block.kind === 'heading') return <h2 id={block.id} className="pub-doc-heading">{block.text}</h2>
  if (block.kind === 'list') return <ul className="pub-doc-list">{block.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
  if (block.kind === 'updated') return <p className="pub-doc-updated">{block.text}</p>
  return <p className="info-paragraph pub-doc-paragraph">{block.text}</p>
}

/** Links to the other information pages (and Contact) at the end of each page. */
function SiblingLinks({ current }: { current: InfoPageKind }) {
  const values = useSiteValues()
  const kinds = (['privacy', 'terms', 'about'] as InfoPageKind[]).filter(kind => kind !== current && infoPageAvailable(values, kind))
  return <nav className="pub-doc-siblings" aria-label="More about Stracker">
    {kinds.map(kind => <Link key={kind} to={INFO_PAGE_PATHS[kind]}>{values[`public.footer.${kind}.label`]}<ArrowRight size={15} aria-hidden="true" /></Link>)}
    <Link to={CONTACT_PAGE_PATH}>{values['public.footer.contact.label'] || 'Contact'}<ArrowRight size={15} aria-hidden="true" /></Link>
  </nav>
}

/**
 * /about, /terms and /privacy. Each ships with text written for Stracker by DYPOL LABS that the
 * owner can rewrite in Control Center. A cleared About or Terms page is a 404; a cleared
 * Privacy page shows the homepage Privacy section. Text is plain (the editor rejects markup):
 * "## " headings, "- " lists and paragraphs.
 */
export default function InfoPage({ kind }: { kind: InfoPageKind }) {
  const values = useSiteValues()
  const settled = useSiteContentSettled()
  const body = infoPageBody(values, kind)

  let content: ReactElement
  if (body) {
    const blocks = infoBlocks(body)
    const headings = blocks.filter((block): block is Extract<InfoBlock, { kind: 'heading' }> => block.kind === 'heading')
    content = <>
      <header className="pub-doc-head">
        <p className="pub-eyebrow"><span aria-hidden="true">✎</span> STRACKER BY DYPOL LABS</p>
        <h1 id="info-title">{TITLES[kind]}</h1>
      </header>
      {headings.length >= 4 && <nav className="pub-doc-toc" aria-label="On this page">
        <strong>On this page</strong>
        <ol>{headings.map(heading => <li key={heading.id}><a href={`#${heading.id}`}>{heading.text}</a></li>)}</ol>
      </nav>}
      <div className="pub-doc-body">{blocks.map((block, index) => <Block key={index} block={block} />)}</div>
    </>
  } else if (kind === 'privacy') {
    const items = Array.from({ length: PRIVACY_ITEM_COUNT }, (_, index) => ({
      title: values[`public.privacy.item_${index + 1}.title`] ?? '',
      body: values[`public.privacy.item_${index + 1}.body`] ?? ''
    })).filter(item => item.title || item.body)
    content = <>
      <span className="eyebrow">{values['public.privacy.eyebrow']}</span>
      <h1 id="info-title">{values['public.privacy.title']}</h1>
      <p className="info-paragraph">{values['public.privacy.lede']}</p>
      <ul className="info-list">{items.map(item => <li key={item.title}><strong>{item.title}</strong><span>{item.body}</span></li>)}</ul>
      {values['public.privacy.foot'] && <p className="info-paragraph info-foot">{values['public.privacy.foot']}</p>}
    </>
  } else if (!settled) {
    return <div className="route-loading"><LoaderCircle size={22} className="spin" /><span>Just a moment…</span></div>
  } else {
    return <NotFoundPage signedIn={false} />
  }

  return <PublicPageShell title={TITLES[kind]} description={DESCRIPTIONS[kind]}>
    <div className="pub-shell pub-doc-shell">
      <article className="pub-doc-card" role="region" aria-labelledby="info-title">
        {content}
        <SiblingLinks current={kind} />
      </article>
    </div>
  </PublicPageShell>
}
