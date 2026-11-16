/**
 * Declarative catalogue of editor blocks: which props each block accepts, which blocks can
 * hold children, and the defaults a new block starts with. Shared by the validator (browser
 * and API), the renderer and the editor's Add Elements library. No browser/Node APIs.
 */

export type PropSpec =
  | { k: 'text'; max: number; optional?: boolean }
  | { k: 'rich'; max: number; optional?: boolean }
  | { k: 'link'; optional?: boolean }
  | { k: 'media'; media: 'image' | 'video'; optional?: boolean }
  | { k: 'select'; options: readonly string[] }
  | { k: 'number'; min: number; max: number; int?: boolean }
  | { k: 'bool' }
  | { k: 'list'; max: number; item: Record<string, PropSpec> }
  | { k: 'strings'; max: number; itemMax: number }
  | { k: 'table' }
  | { k: 'chart' }

export type BlockCategory = 'Layout' | 'Text' | 'Buttons & links' | 'Media' | 'Information' | 'Data' | 'Interactive'

export interface BlockSpec {
  type: string
  label: string
  category: BlockCategory
  /** Short description for the library. */
  hint: string
  props: Record<string, PropSpec>
  /** Can contain child blocks. */
  container?: boolean
  defaults: () => Record<string, unknown>
  /** Optional starting children for templates (ids are assigned on insert). */
  children?: () => Array<{ type: string; props?: Record<string, unknown> }>
  keywords?: string
}

export const TONES = ['plain', 'blue', 'mint', 'orange', 'pink', 'violet', 'sky', 'teal', 'yellow'] as const
export const ICONS = ['sparkles', 'book-open', 'list-checks', 'notebook-pen', 'alarm-clock', 'calendar-check', 'timer', 'trending-up', 'target', 'shield-check', 'compass', 'repeat', 'check', 'star', 'lightbulb', 'arrow-right'] as const
export const CHART_KINDS = ['bar', 'line', 'pie', 'donut', 'progress'] as const
export const CHART_COLORS = ['accent', 'blue', 'mint', 'orange', 'pink', 'violet', 'sky', 'teal', 'yellow', 'ink'] as const
export const VALUE_FORMATS = ['number', 'decimal', 'percent', 'compact'] as const

export const TABLE_LIMITS = { columns: 12, rows: 100, cell: 300 } as const
export const CHART_LIMITS = { labels: 24, series: 6, label: 40 } as const

const text = (max: number, optional = false): PropSpec => ({ k: 'text', max, optional })
const rich = (max: number, optional = false): PropSpec => ({ k: 'rich', max, optional })
const select = (...options: string[]): PropSpec => ({ k: 'select', options })
const tone: PropSpec = { k: 'select', options: TONES }
const icon: PropSpec = { k: 'select', options: ICONS }

const specs: BlockSpec[] = [
  // ------------------------------------------------------------------ layout
  { type: 'section', label: 'Section', category: 'Layout', hint: 'Full-width page band with the site’s spacing', container: true, keywords: 'band wrapper',
    props: { background: select('none', 'band', 'paper', 'card', 'yellow', 'accent'), width: select('normal', 'narrow', 'wide', 'full'), anchor: text(40, true), label: text(80, true) },
    defaults: () => ({ background: 'none', width: 'normal', anchor: '', label: '' }),
    children: () => [{ type: 'heading', props: { text: 'A new section', level: '2' } }, { type: 'paragraph', props: { text: 'Write what this section is about.' } }] },
  { type: 'container', label: 'Container', category: 'Layout', hint: 'Groups blocks; nest freely', container: true, keywords: 'wrapper box group nested content',
    props: { surface: select('none', 'card', 'paper', 'outline') }, defaults: () => ({ surface: 'none' }) },
  { type: 'columns', label: 'Columns', category: 'Layout', hint: '2–4 columns that stack on phones', container: true, keywords: 'two three four column grid',
    props: { columns: { k: 'number', min: 1, max: 6, int: true }, tablet: { k: 'number', min: 1, max: 6, int: true }, mobile: { k: 'number', min: 1, max: 6, int: true }, gap: select('sm', 'md', 'lg') },
    defaults: () => ({ columns: 2, tablet: 2, mobile: 1, gap: 'md' }),
    children: () => [{ type: 'container' }, { type: 'container' }] },
  { type: 'flex', label: 'Flex row', category: 'Layout', hint: 'Items in a row that wrap', container: true, keywords: 'flex row inline',
    props: { direction: select('row', 'column'), align: select('start', 'center', 'end', 'stretch'), justify: select('start', 'center', 'end', 'between'), wrap: { k: 'bool' }, gap: select('sm', 'md', 'lg') },
    defaults: () => ({ direction: 'row', align: 'center', justify: 'start', wrap: true, gap: 'md' }) },
  { type: 'spacer', label: 'Spacer', category: 'Layout', hint: 'Empty vertical space', props: { size: select('xs', 'sm', 'md', 'lg', 'xl') }, defaults: () => ({ size: 'md' }) },
  { type: 'divider', label: 'Divider', category: 'Layout', hint: 'Horizontal or vertical line', keywords: 'separator line rule hr',
    props: { style: select('solid', 'dashed', 'dotted', 'pencil'), orientation: select('horizontal', 'vertical') }, defaults: () => ({ style: 'dashed', orientation: 'horizontal' }) },

  // -------------------------------------------------------------------- text
  { type: 'heading', label: 'Heading', category: 'Text', hint: 'Section title (H2–H4)', keywords: 'title subheading h2 h3',
    props: { text: rich(160), level: select('2', '3', '4'), highlight: text(80, true) }, defaults: () => ({ text: 'New heading', level: '2', highlight: '' }) },
  { type: 'paragraph', label: 'Paragraph', category: 'Text', hint: 'Body text with **bold**, *italic*, __underline__', keywords: 'text rich body copy',
    props: { text: rich(2000), size: select('sm', 'md', 'lg') }, defaults: () => ({ text: 'Write something helpful here.', size: 'md' }) },
  { type: 'eyebrow', label: 'Eyebrow label', category: 'Text', hint: 'Small label above a heading', keywords: 'kicker label',
    props: { text: text(80), pill: { k: 'bool' } }, defaults: () => ({ text: 'NEW', pill: false }) },
  { type: 'list', label: 'List', category: 'Text', hint: 'Bullet or numbered list', keywords: 'bullet numbered ordered checklist',
    props: { items: { k: 'strings', max: 30, itemMax: 300 }, ordered: { k: 'bool' }, marker: select('check', 'dot', 'number') },
    defaults: () => ({ items: ['First point', 'Second point', 'Third point'], ordered: false, marker: 'check' }) },
  { type: 'quote', label: 'Quote', category: 'Text', hint: 'Pull quote or testimonial', keywords: 'testimonial blockquote',
    props: { text: rich(600), cite: text(80, true) }, defaults: () => ({ text: 'A short, honest quote.', cite: '' }) },
  { type: 'note', label: 'Caption / small note', category: 'Text', hint: 'Small muted text', keywords: 'caption footnote small',
    props: { text: rich(400) }, defaults: () => ({ text: 'A small note.' }) },
  { type: 'badge', label: 'Badge', category: 'Text', hint: 'Tiny coloured tag', keywords: 'tag chip label highlighted',
    props: { text: text(40), tone }, defaults: () => ({ text: 'New', tone: 'yellow' }) },

  // ----------------------------------------------------------------- buttons
  { type: 'button', label: 'Button', category: 'Buttons & links', hint: 'Primary, secondary or text link', keywords: 'cta link primary secondary external icon',
    props: { label: text(60), href: { k: 'link' }, variant: select('primary', 'secondary', 'link'), size: select('md', 'lg'), arrow: { k: 'bool' } },
    defaults: () => ({ label: 'Start free', href: '/signup', variant: 'primary', size: 'md', arrow: true }) },
  { type: 'button-group', label: 'Button group', category: 'Buttons & links', hint: 'Buttons side by side', container: true, keywords: 'cta row',
    props: { align: select('start', 'center', 'end') }, defaults: () => ({ align: 'start' }),
    children: () => [{ type: 'button' }, { type: 'button', props: { label: 'Log in', href: '/login', variant: 'secondary', size: 'md', arrow: false } }] },
  { type: 'cta', label: 'CTA block', category: 'Buttons & links', hint: 'Heading, text and a button on a card', keywords: 'call to action promo',
    props: { title: text(120), body: rich(400, true), label: text(60), href: { k: 'link' }, tone },
    defaults: () => ({ title: 'Ready to start?', body: 'Your notebook is free and private.', label: 'Start free', href: '/signup', tone: 'yellow' }) },
  { type: 'back-to-top', label: 'Back-to-top link', category: 'Buttons & links', hint: 'Jumps to the top', props: { label: text(40) }, defaults: () => ({ label: 'Back to top' }) },

  // ------------------------------------------------------------------- media
  { type: 'image', label: 'Image', category: 'Media', hint: 'Uploaded image with alt text', keywords: 'picture photo logo illustration',
    props: { src: { k: 'media', media: 'image', optional: true }, alt: text(200, true), caption: text(200, true), ratio: select('auto', '16:9', '4:3', '1:1', '3:4'), fit: select('cover', 'contain'), focus: select('center', 'top', 'bottom', 'left', 'right'), frame: select('none', 'card', 'tape') },
    defaults: () => ({ src: '', alt: '', caption: '', ratio: 'auto', fit: 'cover', focus: 'center', frame: 'card' }) },
  { type: 'gallery', label: 'Image gallery', category: 'Media', hint: 'Grid of images', keywords: 'images photos',
    props: { images: { k: 'list', max: 12, item: { src: { k: 'media', media: 'image', optional: true }, alt: text(200, true) } }, columns: { k: 'number', min: 1, max: 4, int: true } },
    defaults: () => ({ images: [{ src: '', alt: '' }, { src: '', alt: '' }, { src: '', alt: '' }], columns: 3 }) },
  { type: 'video', label: 'Video', category: 'Media', hint: 'Uploaded MP4 with poster, loads on demand', keywords: 'mp4 movie poster',
    props: { src: { k: 'media', media: 'video', optional: true }, poster: { k: 'media', media: 'image', optional: true }, caption: text(200, true), ratio: select('16:9', '4:3', '1:1', '9:16') },
    defaults: () => ({ src: '', poster: '', caption: '', ratio: '16:9' }) },
  { type: 'icon', label: 'Icon', category: 'Media', hint: 'One of the site’s line icons', keywords: 'svg symbol',
    props: { icon, tone, size: select('sm', 'md', 'lg') }, defaults: () => ({ icon: 'sparkles', tone: 'blue', size: 'md' }) },

  // ------------------------------------------------------------- information
  { type: 'card', label: 'Feature card', category: 'Information', hint: 'Icon, title, text and points', keywords: 'feature info card',
    props: { icon, tone, title: text(120), body: rich(600, true), points: { k: 'strings', max: 8, itemMax: 160 }, image: { k: 'media', media: 'image', optional: true } },
    defaults: () => ({ icon: 'sparkles', tone: 'blue', title: 'Feature title', body: 'What it does for a student.', points: [], image: '' }) },
  { type: 'stat', label: 'Statistics card', category: 'Information', hint: 'Big number with a label', keywords: 'metric number',
    props: { value: text(24), label: text(160), tone }, defaults: () => ({ value: '24/7', label: 'Your notebook, whenever you study', tone: 'yellow' }) },
  { type: 'callout', label: 'Callout / highlight box', category: 'Information', hint: 'Boxed note that stands out', keywords: 'highlight info alert box',
    props: { title: text(120, true), body: rich(800), tone, icon }, defaults: () => ({ title: 'Good to know', body: 'A short highlighted note.', tone: 'yellow', icon: 'lightbulb' }) },
  { type: 'steps', label: 'Step-by-step / timeline', category: 'Information', hint: 'Numbered steps', keywords: 'timeline process how',
    props: { items: { k: 'list', max: 12, item: { title: text(120), body: rich(400, true) } }, layout: select('list', 'timeline', 'grid') },
    defaults: () => ({ items: [{ title: 'Sign up', body: 'Create your free notebook.' }, { title: 'Add your syllabus', body: 'Pick your exam.' }, { title: 'Study', body: 'Track every session.' }], layout: 'list' }) },
  { type: 'testimonial', label: 'Testimonial', category: 'Information', hint: 'Quote with a name', props: { quote: rich(600), name: text(80), role: text(80, true) },
    defaults: () => ({ quote: 'Add a real, consented quote here.', name: 'Name', role: '' }) },
  { type: 'comparison', label: 'Comparison', category: 'Information', hint: 'Two columns: before / after', keywords: 'versus compare',
    props: { leftTitle: text(80), left: { k: 'strings', max: 10, itemMax: 160 }, rightTitle: text(80), right: { k: 'strings', max: 10, itemMax: 160 } },
    defaults: () => ({ leftTitle: 'Scattered notes', left: ['Tests in one app', 'Mistakes forgotten'], rightTitle: 'One notebook', right: ['Everything in one place', 'Mistakes come back for revision'] }) },
  { type: 'brand', label: 'Brand attribution', category: 'Information', hint: '“by DYPOL LABS” mark', props: { text: text(80) }, defaults: () => ({ text: 'Stracker by DYPOL LABS' }) },

  // -------------------------------------------------------------------- data
  { type: 'table', label: 'Table', category: 'Data', hint: 'Rows and columns, scrolls on phones', keywords: 'grid data rows columns',
    props: { table: { k: 'table' } },
    defaults: () => ({ table: { caption: '', header: true, striped: true, bordered: true, scroll: true, padding: 'md',
      columns: [{ label: 'Item', align: 'left', width: 'auto', hidden: false }, { label: 'Details', align: 'left', width: 'auto', hidden: false }],
      rows: [['Syllabus', 'Track every chapter'], ['Tests', 'Log scores and mistakes']] } }) },
  { type: 'chart', label: 'Chart', category: 'Data', hint: 'Bar, line, pie, donut or progress (SVG)', keywords: 'bar line pie donut progress graph metric comparison',
    props: { chart: { k: 'chart' } },
    defaults: () => ({ chart: { kind: 'bar', title: 'Example chart', xLabel: '', yLabel: '', legend: true, height: 260, format: 'number', unit: '', max: 100,
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], series: [{ name: 'Hours', color: 'accent', values: [2, 3, 1.5, 4, 2.5] }] } }) },
  { type: 'metrics', label: 'Metric cards', category: 'Data', hint: 'Row of small number cards', keywords: 'kpi numbers',
    props: { items: { k: 'list', max: 8, item: { value: text(24), label: text(120) } } },
    defaults: () => ({ items: [{ value: '5', label: 'steps in the study loop' }, { value: '4', label: 'test types' }, { value: '0', label: 'ads' }] }) },
  { type: 'progress', label: 'Progress indicator', category: 'Data', hint: 'Labelled progress bar', props: { label: text(80), value: { k: 'number', min: 0, max: 100 }, tone },
    defaults: () => ({ label: 'Syllabus covered (example)', value: 60, tone: 'mint' }) },

  // ------------------------------------------------------------- interactive
  { type: 'accordion', label: 'FAQ / accordion', category: 'Interactive', hint: 'Questions that expand', keywords: 'faq collapsible panel',
    props: { items: { k: 'list', max: 20, item: { title: text(160), body: rich(1200) } }, single: { k: 'bool' } },
    defaults: () => ({ items: [{ title: 'Is Stracker free?', body: 'Yes, the notebook is free to use.' }, { title: 'Who can see my notes?', body: 'Only you.' }], single: false }) },
  { type: 'tabs', label: 'Tab group', category: 'Interactive', hint: 'Content in switchable tabs', props: { items: { k: 'list', max: 8, item: { title: text(60), body: rich(1200) } } },
    defaults: () => ({ items: [{ title: 'Students', body: 'Plan, study and revise.' }, { title: 'Parents', body: 'Nothing is shared without the student.' }] }) },
  { type: 'banner', label: 'Announcement banner', category: 'Interactive', hint: 'Thin strip with a message and link', keywords: 'announcement promo notice',
    props: { text: text(160), label: text(40, true), href: { k: 'link', optional: true }, tone }, defaults: () => ({ text: 'Something new just landed.', label: 'See what’s new', href: '', tone: 'yellow' }) }
]

export const BLOCK_SPECS: Record<string, BlockSpec> = Object.fromEntries(specs.map(spec => [spec.type, spec]))
export const BLOCK_SPEC_LIST: readonly BlockSpec[] = specs
export const BLOCK_CATEGORIES: readonly BlockCategory[] = ['Layout', 'Text', 'Buttons & links', 'Media', 'Information', 'Data', 'Interactive']

/**
 * Extra structured props for registered Stracker sections whose lists used to be fixed in
 * code. Their text-registry fields keep working; these props only add what had no field.
 * An absent prop means "as shipped".
 */
export const BUILTIN_PROP_SPECS: Record<string, Record<string, PropSpec>> = {
  'stracker.exams': { label: text(120, true), items: { k: 'strings', max: 40, itemMax: 40 }, speed: select('slow', 'normal', 'fast') },
  'stracker.stats': { items: { k: 'list', max: 6, item: { value: text(24), label: text(200) } } },
  'stracker.loop': { steps: { k: 'list', max: 8, item: { step: text(40), link: text(60, true), body: rich(400, true) } } }
}

/** The shipped values of those lists (also the editor's starting point). */
export const DEFAULT_EXAM_NAMES = ['JEE', 'NEET UG', 'MHT CET', 'BITSAT', 'CUET UG', 'CLAT', 'NDA', 'Class 9–12 boards', 'CA', 'CS', 'CMA', 'GATE', 'CAT', 'UPSC CSE', 'SSC CGL', 'IBPS PO', 'SBI PO']
export const DEFAULT_EXAMS_LABEL = 'Built for aspirants preparing for'
/** `{modules}` is replaced by the live count of feature cards on the page. */
export const MODULES_TOKEN = '{modules}'
export const DEFAULT_STATS = [
  { value: MODULES_TOKEN, label: 'core modules in one notebook — each one a page you will use weekly' },
  { value: '4', label: 'test types in the journal: chapter, subject, full mock and PYQ practice' },
  { value: '1 · 7 · 30', label: 'day revision gaps ready to use — change them any time' },
  { value: '0', label: 'ads or third-party trackers on your notebook' }
]
export const DEFAULT_LOOP_STEPS = [
  { step: 'Learn', link: 'Syllabus notebook', body: '' },
  { step: 'Test', link: 'Test journal', body: '' },
  { step: 'Analyse', link: 'Analytics', body: '' },
  { step: 'Revise', link: 'Revision desk', body: '' },
  { step: 'Repeat', link: 'Planner + Focus', body: '' }
]
