import { useState, type ReactNode } from 'react'
import {
  AlarmClock, ArrowRight, ArrowUp, BookOpen, CalendarCheck, Check, ChevronDown, Compass, ImageIcon, Lightbulb, ListChecks,
  NotebookPen, Repeat2, ShieldCheck, Sparkles, Star, Target, Timer, TrendingUp
} from 'lucide-react'
import type { SiteBlock } from '../../lib/site-editor/model'
import { SiteLink } from '../public/SiteLink'
import { Chart, type ChartData } from './Chart'
import { plainText, richText } from './RichText'
import '../../styles/site-blocks.css'

/**
 * React components for every editor block. Blocks arrive already cleaned by
 * `checkSiteDocument`, so props have the right types; text is rendered as React text and
 * links go through SiteLink. Each block root carries `data-sb` (styles, editor selection)
 * and text that can be typed into directly carries `data-se-prop` (editor inline editing).
 */

const ICONS: Record<string, ReactNode> = {
  sparkles: <Sparkles size={20} />, 'book-open': <BookOpen size={20} />, 'list-checks': <ListChecks size={20} />, 'notebook-pen': <NotebookPen size={20} />,
  'alarm-clock': <AlarmClock size={20} />, 'calendar-check': <CalendarCheck size={20} />, timer: <Timer size={20} />, 'trending-up': <TrendingUp size={20} />,
  target: <Target size={20} />, 'shield-check': <ShieldCheck size={20} />, compass: <Compass size={20} />, repeat: <Repeat2 size={20} />,
  check: <Check size={20} />, star: <Star size={20} />, lightbulb: <Lightbulb size={20} />, 'arrow-right': <ArrowRight size={20} />
}

type P = Record<string, unknown>
const str = (props: P, key: string, fallback = ''): string => (typeof props[key] === 'string' ? props[key] as string : fallback)
const num = (props: P, key: string, fallback: number): number => (typeof props[key] === 'number' ? props[key] as number : fallback)
const bool = (props: P, key: string, fallback = false): boolean => (typeof props[key] === 'boolean' ? props[key] as boolean : fallback)
const strings = (props: P, key: string): string[] => (Array.isArray(props[key]) ? (props[key] as unknown[]).filter((item): item is string => typeof item === 'string') : [])
const list = (props: P, key: string): P[] => (Array.isArray(props[key]) ? (props[key] as unknown[]).filter((item): item is P => Boolean(item) && typeof item === 'object') : [])
const toneClass = (tone: string) => (tone && tone !== 'plain' ? ` hp-tone-${tone}` : '')

function Placeholder({ label }: { label: string }) {
  return <div className="sb-placeholder"><ImageIcon size={22} aria-hidden="true" /><span>{label}</span></div>
}

function Children({ blocks }: { blocks?: SiteBlock[] }) {
  if (!blocks?.length) return null
  return <>{blocks.map(child => <SiteBlockView key={child.id} block={child} />)}</>
}

const RATIOS: Record<string, string> = { '21:9': '21 / 9', '16:9': '16 / 9', '3:2': '3 / 2', '4:3': '4 / 3', '1:1': '1 / 1', '3:4': '3 / 4', '2:3': '2 / 3', '9:16': '9 / 16' }
const FOCUS: Record<string, string> = { center: 'center', top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' }

/** Image with crop (aspect ratio + zoom), focal point and fit. Zoom crops around the focal point. */
function ImageCrop({ src, alt, ratio, fit, position, zoom }: { src: string; alt: string; ratio?: string; fit: string; position: string; zoom: number }) {
  const image = <img src={src} alt={alt} loading="lazy" decoding="async" style={{ aspectRatio: ratio, objectFit: fit as 'cover', objectPosition: position, ...(zoom > 100 ? { transform: `scale(${zoom / 100})`, transformOrigin: position } : {}) }} />
  return zoom > 100 ? <span className="sb-image-crop">{image}</span> : image
}

function Accordion({ items, single }: { items: P[]; single: boolean }) {
  const [open, setOpen] = useState<number[]>([])
  return <div className="sb-accordion">
    {items.map((item, index) => {
      const isOpen = open.includes(index)
      return <div className={`sb-accordion-item${isOpen ? ' is-open' : ''}`} key={index}>
        <h3><button type="button" aria-expanded={isOpen} onClick={() => setOpen(current => isOpen ? current.filter(value => value !== index) : single ? [index] : [...current, index])}>
          <span data-se-prop={`items.${index}.title`}>{str(item, 'title')}</span><ChevronDown size={18} aria-hidden="true" />
        </button></h3>
        {isOpen && <div className="sb-accordion-body"><p data-se-prop={`items.${index}.body`}>{richText(str(item, 'body'))}</p></div>}
      </div>
    })}
  </div>
}

function Tabs({ items, blockId }: { items: P[]; blockId: string }) {
  const [active, setActive] = useState(0)
  const current = Math.min(active, Math.max(0, items.length - 1))
  return <div className="sb-tabs">
    <div className="sb-tabs-list" role="tablist">
      {items.map((item, index) => <button key={index} type="button" role="tab" id={`${blockId}-tab-${index}`} aria-selected={index === current} aria-controls={`${blockId}-panel`} tabIndex={index === current ? 0 : -1} onClick={() => setActive(index)}>{str(item, 'title')}</button>)}
    </div>
    {items[current] && <div className="sb-tabs-panel" role="tabpanel" id={`${blockId}-panel`} aria-labelledby={`${blockId}-tab-${current}`}><p data-se-prop={`items.${current}.body`}>{richText(str(items[current], 'body'))}</p></div>}
  </div>
}

interface TableData {
  caption: string; header: boolean; striped: boolean; bordered: boolean; scroll: boolean; padding: string
  columns: Array<{ label: string; align: string; width: string; hidden: boolean }>
  rows: string[][]
}

function Table({ data }: { data: TableData }) {
  const visible = data.columns.map((column, index) => ({ ...column, index })).filter(column => !column.hidden)
  const table = <table className={`sb-table pad-${data.padding}${data.striped ? ' is-striped' : ''}${data.bordered ? ' is-bordered' : ''}`}>
    {data.caption && <caption>{data.caption}</caption>}
    {data.header && <thead><tr>{visible.map(column => <th scope="col" key={column.index} className={`al-${column.align} w-${column.width}`} data-se-prop={`table.columns.${column.index}.label`}>{column.label}</th>)}</tr></thead>}
    <tbody>{data.rows.map((row, r) => <tr key={r}>{visible.map(column => <td key={column.index} className={`al-${column.align} w-${column.width}`} data-se-prop={`table.rows.${r}.${column.index}`}>{row[column.index] ?? ''}</td>)}</tr>)}</tbody>
  </table>
  return data.scroll ? <div className="sb-table-scroll" tabIndex={0} role="region" aria-label={data.caption || 'Table'}>{table}</div> : table
}

export function SiteBlockView({ block }: { block: SiteBlock }): ReactNode {
  if (block.hidden) return null
  const props = (block.props ?? {}) as P
  const sb = { 'data-sb': block.id }
  switch (block.type) {
    case 'section': {
      const anchor = str(props, 'anchor')
      return <section {...sb} id={anchor || undefined} aria-label={str(props, 'label') || undefined} className={`hp-section sb-section bg-${str(props, 'background', 'none')}`}>
        <div className={`hp-shell sb-shell w-${str(props, 'width', 'normal')}`}><Children blocks={block.children} /></div>
      </section>
    }
    case 'container': return <div {...sb} className={`sb-container surface-${str(props, 'surface', 'none')}`}><Children blocks={block.children} /></div>
    case 'columns': return <div {...sb} className={`sb-columns gap-${str(props, 'gap', 'md')}`} style={{ ['--sb-cols-d' as string]: num(props, 'columns', 2), ['--sb-cols-t' as string]: num(props, 'tablet', 2), ['--sb-cols-m' as string]: num(props, 'mobile', 1) }}><Children blocks={block.children} /></div>
    case 'flex': return <div {...sb} className={`sb-flex dir-${str(props, 'direction', 'row')} al-${str(props, 'align', 'center')} js-${str(props, 'justify', 'start')} gap-${str(props, 'gap', 'md')}${bool(props, 'wrap', true) ? ' is-wrap' : ''}`}><Children blocks={block.children} /></div>
    case 'spacer': return <div {...sb} className={`sb-spacer size-${str(props, 'size', 'md')}`} aria-hidden="true" />
    case 'divider': return <hr {...sb} className={`sb-divider st-${str(props, 'style', 'dashed')} or-${str(props, 'orientation', 'horizontal')}`} />
    case 'heading': {
      const level = str(props, 'level', '2')
      const Tag = (level === '3' ? 'h3' : level === '4' ? 'h4' : 'h2') as 'h2'
      const highlight = str(props, 'highlight')
      return <Tag {...sb} className={`sb-heading lv-${level}${level === '2' ? ' hp-h2' : ''}`}><span data-se-prop="text">{richText(str(props, 'text'))}</span>{highlight && <> <em className="hp-highlight" data-se-prop="highlight">{highlight}</em></>}</Tag>
    }
    case 'paragraph': return <p {...sb} className={`sb-paragraph size-${str(props, 'size', 'md')}`} data-se-prop="text">{richText(str(props, 'text'))}</p>
    case 'eyebrow': return <p {...sb} className={`hp-eyebrow sb-eyebrow${bool(props, 'pill') ? ' hp-eyebrow-pill' : ''}`}><span aria-hidden="true">✎</span> <span data-se-prop="text">{str(props, 'text')}</span></p>
    case 'list': {
      const ordered = bool(props, 'ordered')
      const items = strings(props, 'items').map((item, index) => <li key={index}>{str(props, 'marker') === 'check' && !ordered && <Check size={14} strokeWidth={3} aria-hidden="true" />}<span data-se-prop={`items.${index}`}>{item}</span></li>)
      return ordered ? <ol {...sb} className="sb-list is-ordered">{items}</ol> : <ul {...sb} className={`sb-list mk-${str(props, 'marker', 'check')}`}>{items}</ul>
    }
    case 'quote': return <figure {...sb} className="sb-quote"><blockquote data-se-prop="text">{richText(str(props, 'text'))}</blockquote>{str(props, 'cite') && <figcaption data-se-prop="cite">— {str(props, 'cite')}</figcaption>}</figure>
    case 'note': return <p {...sb} className="sb-note" data-se-prop="text">{richText(str(props, 'text'))}</p>
    case 'badge': return <span {...sb} className={`sb-badge${toneClass(str(props, 'tone'))}`} data-se-prop="text">{str(props, 'text')}</span>
    case 'button': {
      const variant = str(props, 'variant', 'primary')
      const className = variant === 'link' ? 'sb-text-link' : `hp-btn hp-btn-${variant}${str(props, 'size') === 'lg' ? ' hp-btn-lg' : ''}`
      return <span {...sb} className="sb-button-wrap"><SiteLink className={className} href={str(props, 'href', '/')}><span data-se-prop="label">{str(props, 'label')}</span>{bool(props, 'arrow') && <ArrowRight size={16} aria-hidden="true" />}</SiteLink></span>
    }
    case 'button-group': return <div {...sb} className={`hp-cta-row sb-button-group al-${str(props, 'align', 'start')}`}><Children blocks={block.children} /></div>
    case 'cta': return <div {...sb} className={`sb-cta${toneClass(str(props, 'tone'))}`}>
      <h3 data-se-prop="title">{str(props, 'title')}</h3>
      {str(props, 'body') && <p data-se-prop="body">{richText(str(props, 'body'))}</p>}
      <SiteLink className="hp-btn hp-btn-primary" href={str(props, 'href', '/signup')}><span data-se-prop="label">{str(props, 'label')}</span> <ArrowRight size={16} aria-hidden="true" /></SiteLink>
    </div>
    case 'back-to-top': return <p {...sb} className="sb-back-top"><a href="#top"><ArrowUp size={15} aria-hidden="true" /> <span data-se-prop="label">{str(props, 'label')}</span></a></p>
    case 'image': {
      const src = str(props, 'src')
      const ratio = str(props, 'ratio', 'auto')
      return <figure {...sb} className={`sb-image frame-${str(props, 'frame', 'card')}`}>
        {src
          ? <ImageCrop src={src} alt={str(props, 'alt')} ratio={RATIOS[ratio]} fit={str(props, 'fit', 'cover')} position={str(props, 'focus') === 'custom' ? `${num(props, 'focusX', 50)}% ${num(props, 'focusY', 50)}%` : FOCUS[str(props, 'focus', 'center')] ?? 'center'} zoom={num(props, 'zoom', 100)} />
          : <Placeholder label="Upload an image" />}
        {str(props, 'caption') && <figcaption data-se-prop="caption">{str(props, 'caption')}</figcaption>}
      </figure>
    }
    case 'gallery': return <div {...sb} className="sb-gallery" style={{ ['--sb-cols-d' as string]: num(props, 'columns', 3) }}>
      {list(props, 'images').map((image, index) => str(image, 'src')
        ? <img key={index} src={str(image, 'src')} alt={str(image, 'alt')} loading="lazy" decoding="async" />
        : <Placeholder key={index} label="Upload an image" />)}
    </div>
    case 'video': {
      const src = str(props, 'src')
      return <figure {...sb} className="sb-video">
        {src
          ? <video src={src} poster={str(props, 'poster') || undefined} controls preload="none" playsInline style={{ aspectRatio: RATIOS[str(props, 'ratio', '16:9')] }} />
          : <Placeholder label="Upload an MP4 video" />}
        {str(props, 'caption') && <figcaption data-se-prop="caption">{str(props, 'caption')}</figcaption>}
      </figure>
    }
    case 'icon': return <span {...sb} className={`sb-icon size-${str(props, 'size', 'md')}${toneClass(str(props, 'tone'))}`} aria-hidden="true">{ICONS[str(props, 'icon')] ?? ICONS.sparkles}</span>
    case 'card': {
      const image = str(props, 'image')
      return <article {...sb} className={`hp-feature sb-card${toneClass(str(props, 'tone'))}${image ? ' has-image' : ''}`}>
        {image && <img className="hp-feature-image" src={image} alt="" loading="lazy" decoding="async" />}
        <div className="hp-feature-head"><span className="hp-feature-icon" aria-hidden="true">{ICONS[str(props, 'icon')] ?? ICONS.sparkles}</span></div>
        <h3 data-se-prop="title">{str(props, 'title')}</h3>
        {str(props, 'body') && <p data-se-prop="body">{richText(str(props, 'body'))}</p>}
        {strings(props, 'points').length > 0 && <ul className="hp-feature-points">{strings(props, 'points').map((point, index) => <li key={index}><Check size={13} strokeWidth={3} aria-hidden="true" /> <span data-se-prop={`points.${index}`}>{point}</span></li>)}</ul>}
      </article>
    }
    case 'stat': return <div {...sb} className={`hp-note sb-stat${toneClass(str(props, 'tone'))}`}><strong data-se-prop="value">{str(props, 'value')}</strong><span data-se-prop="label">{str(props, 'label')}</span></div>
    case 'callout': return <aside {...sb} className={`sb-callout${toneClass(str(props, 'tone'))}`}>
      <span className="sb-callout-icon" aria-hidden="true">{ICONS[str(props, 'icon')] ?? ICONS.lightbulb}</span>
      <div>{str(props, 'title') && <strong data-se-prop="title">{str(props, 'title')}</strong>}<p data-se-prop="body">{richText(str(props, 'body'))}</p></div>
    </aside>
    case 'steps': return <ol {...sb} className={`sb-steps layout-${str(props, 'layout', 'list')}`}>
      {list(props, 'items').map((item, index) => <li key={index}><span className="sb-step-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><h3 data-se-prop={`items.${index}.title`}>{str(item, 'title')}</h3>{str(item, 'body') && <p data-se-prop={`items.${index}.body`}>{richText(str(item, 'body'))}</p>}</div></li>)}
    </ol>
    case 'testimonial': return <figure {...sb} className="sb-quote sb-testimonial"><blockquote data-se-prop="quote">{richText(str(props, 'quote'))}</blockquote><figcaption><strong data-se-prop="name">{str(props, 'name')}</strong>{str(props, 'role') && <span data-se-prop="role">{str(props, 'role')}</span>}</figcaption></figure>
    case 'comparison': return <div {...sb} className="sb-comparison">
      {(['left', 'right'] as const).map(side => <div key={side} className={`sb-compare-col side-${side}`}>
        <h3 data-se-prop={`${side}Title`}>{str(props, `${side}Title`)}</h3>
        <ul>{strings(props, side).map((item, index) => <li key={index}><span data-se-prop={`${side}.${index}`}>{item}</span></li>)}</ul>
      </div>)}
    </div>
    case 'brand': return <p {...sb} className="sb-brand"><span aria-hidden="true">✳</span> <span data-se-prop="text">{str(props, 'text')}</span></p>
    case 'table': return <div {...sb} className="sb-table-block"><Table data={props.table as TableData} /></div>
    case 'chart': return <div {...sb} className="sb-chart-block"><Chart data={props.chart as ChartData} /></div>
    case 'metrics': return <ul {...sb} className="sb-metrics">{list(props, 'items').map((item, index) => <li key={index} className={`hp-note hp-tone-${['yellow', 'mint', 'blue', 'pink', 'violet', 'orange'][index % 6]}`}><strong data-se-prop={`items.${index}.value`}>{str(item, 'value')}</strong><span data-se-prop={`items.${index}.label`}>{str(item, 'label')}</span></li>)}</ul>
    case 'progress': {
      const value = Math.max(0, Math.min(100, num(props, 'value', 0)))
      return <div {...sb} className={`sb-progress sb-progress-single${toneClass(str(props, 'tone'))}`}>
        <div className="sb-progress-head"><span data-se-prop="label">{str(props, 'label')}</span><strong>{value}%</strong></div>
        <div className="sb-progress-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={plainText(str(props, 'label'))}><span style={{ width: `${value}%` }} /></div>
      </div>
    }
    case 'accordion': return <div {...sb}><Accordion items={list(props, 'items')} single={bool(props, 'single')} /></div>
    case 'tabs': return <div {...sb}><Tabs items={list(props, 'items')} blockId={block.id} /></div>
    case 'banner': return <div {...sb} className={`sb-banner${toneClass(str(props, 'tone'))}`} role="note">
      <span data-se-prop="text">{str(props, 'text')}</span>
      {str(props, 'href') && str(props, 'label') && <SiteLink className="sb-text-link" href={str(props, 'href')}><span data-se-prop="label">{str(props, 'label')}</span> <ArrowRight size={14} aria-hidden="true" /></SiteLink>}
    </div>
    default: return null
  }
}
