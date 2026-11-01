import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, LoaderCircle } from 'lucide-react'
import { NotebookCard } from '../components/ui'
import { useSiteContentSettled, useSiteValues } from '../contexts/SiteContentContext'
import { infoPageBody, infoParagraphs, type InfoPageKind } from '../lib/site-content/info-pages'
import NotFoundPage from './NotFoundPage'

const PRIVACY_ITEM_COUNT = 6

/**
 * /about, /terms and /privacy. Shows only text the owner wrote in Control Center; About and
 * Terms are a 404 until written. Privacy without owner text shows the homepage Privacy section.
 * Text is rendered as plain paragraphs (the editor rejects markup).
 */
export default function InfoPage({ kind }: { kind: InfoPageKind }) {
  const values = useSiteValues()
  const settled = useSiteContentSettled()
  const body = infoPageBody(values, kind)
  const label = values[`public.footer.${kind}.label`] ?? ''

  let content: ReactElement
  if (body) {
    content = <>
      <h1 id="info-title">{label}</h1>
      {infoParagraphs(body).map((paragraph, index) => <p key={index} className="info-paragraph">{paragraph}</p>)}
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

  return <main className="info-page">
    <NotebookCard className="info-card" role="region" aria-labelledby="info-title">
      <Link className="info-back" to="/"><ArrowLeft size={15} aria-hidden="true" /> Stracker</Link>
      {content}
    </NotebookCard>
  </main>
}
