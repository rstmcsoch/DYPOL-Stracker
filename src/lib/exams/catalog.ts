/**
 * Exam catalogue shared by the student app, the Control Center and the API.
 *
 * The live catalogue is the `public.exam_catalog` table (owner-managed; students can
 * read rows that are not hidden). BUILT_IN_EXAMS is the seed for that table and the
 * fallback when it cannot be read, so the exam picker never ends up empty.
 */

export interface ExamDefinition {
  /** Stable id stored on a student's settings. Never reused for a different exam. */
  id: string
  name: string
  category: string
  /** Allowed target years. Empty = derived (current year to current year + 3). */
  years: number[]
  /** Optional attempt/session choices, e.g. CA attempt months. */
  sessions: string[]
  /** School classes: the board the student studies under. Empty = no board choice. */
  boards: string[]
  /** Student may add Class 12 boards as an extra track alongside this exam. */
  boards_addon: boolean
  sort_order: number
  hidden: boolean
}

export const EXAM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/
/** Existing students have no exam saved; they were all set up for JEE. */
export const LEGACY_DEFAULT_EXAM_ID = 'jee'
export const SCHOOL_BOARDS = ['CBSE', 'ICSE / ISC', 'State board', 'Other board']
const CA_INTER_MONTHS = ['January', 'May', 'September']
const TWICE_A_YEAR_JUNE_DEC = ['June', 'December']

type Seed = [id: string, name: string, category: string, options?: Partial<Pick<ExamDefinition, 'sessions' | 'boards' | 'boards_addon'>>]
const ADDON = { boards_addon: true }
const SEEDS: Seed[] = [
  ['jee', 'JEE (Main + Advanced)', 'Engineering', ADDON],
  ['mht-cet', 'MHT CET', 'Engineering', ADDON],
  ['bitsat', 'BITSAT', 'Engineering', ADDON],
  ['viteee', 'VITEEE', 'Engineering', ADDON],
  ['comedk-uget', 'COMEDK UGET', 'Engineering', ADDON],
  ['wbjee', 'WBJEE', 'Engineering', ADDON],
  ['kcet', 'KCET', 'Engineering', ADDON],
  ['neet-ug', 'NEET UG', 'Medical', ADDON],
  ['cuet-ug', 'CUET UG', 'University admission', ADDON],
  ['clat', 'CLAT', 'Law', ADDON],
  ['nda', 'NDA & NA', 'Defence', { boards_addon: true, sessions: ['NDA I', 'NDA II'] }],
  ['class-9', 'Class 9', 'School', { boards: SCHOOL_BOARDS }],
  ['class-10', 'Class 10', 'School', { boards: SCHOOL_BOARDS }],
  ['class-11', 'Class 11', 'School', { boards: SCHOOL_BOARDS }],
  ['class-12', 'Class 12', 'School', { boards: SCHOOL_BOARDS }],
  ['ca-foundation', 'CA Foundation', 'Commerce & professional', { sessions: CA_INTER_MONTHS }],
  ['ca-intermediate', 'CA Intermediate', 'Commerce & professional', { sessions: CA_INTER_MONTHS }],
  ['ca-final', 'CA Final', 'Commerce & professional', { sessions: ['May', 'November'] }],
  ['cs-executive', 'CS Executive', 'Commerce & professional', { sessions: TWICE_A_YEAR_JUNE_DEC }],
  ['cs-professional', 'CS Professional', 'Commerce & professional', { sessions: TWICE_A_YEAR_JUNE_DEC }],
  ['cma-intermediate', 'CMA Intermediate', 'Commerce & professional', { sessions: TWICE_A_YEAR_JUNE_DEC }],
  ['cma-final', 'CMA Final', 'Commerce & professional', { sessions: TWICE_A_YEAR_JUNE_DEC }],
  ['gate', 'GATE', 'Postgraduate'],
  ['cat', 'CAT', 'Postgraduate'],
  ['upsc-cse', 'UPSC Civil Services', 'Government jobs'],
  ['ssc-cgl', 'SSC CGL', 'Government jobs'],
  ['ibps-po', 'IBPS PO', 'Banking'],
  ['sbi-po', 'SBI PO', 'Banking']
]

export const BUILT_IN_EXAMS: readonly ExamDefinition[] = SEEDS.map(([id, name, category, options], index) => ({
  id, name, category, years: [], sessions: options?.sessions ?? [], boards: options?.boards ?? [],
  boards_addon: options?.boards_addon ?? false, sort_order: (index + 1) * 10, hidden: false
}))

/** Target years offered when an exam has none configured: this year and the next three. */
export function examYears(exam: Pick<ExamDefinition, 'years'>, now: Date = new Date()): number[] {
  if (exam.years.length) return [...exam.years].sort((a, b) => a - b)
  const year = now.getFullYear()
  return [year, year + 1, year + 2, year + 3]
}

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null
const textList = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? [...new Set(value.map(item => text(item, max)).filter((item): item is string => item !== null))].slice(0, 24) : []

/** Validate one stored row; null when it is unusable. */
export function normalizeExam(row: unknown): ExamDefinition | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  const id = typeof record.id === 'string' && EXAM_ID_PATTERN.test(record.id) ? record.id : null
  const name = text(record.name, 80)
  const category = text(record.category, 40)
  if (!id || !name || !category) return null
  const years = Array.isArray(record.years)
    ? [...new Set(record.years.filter((year): year is number => Number.isInteger(year) && year >= 2020 && year <= 2100))].slice(0, 12)
    : []
  return {
    id, name, category, years,
    sessions: textList(record.sessions, 40),
    boards: textList(record.boards, 40),
    boards_addon: record.boards_addon === true,
    sort_order: Number.isInteger(record.sort_order) ? record.sort_order as number : 0,
    hidden: record.hidden === true
  }
}

/** Visible exams in owner order; falls back to the built-in list when rows are unusable. */
export function visibleCatalog(rows: unknown): ExamDefinition[] {
  const list = Array.isArray(rows) ? rows.map(normalizeExam).filter((exam): exam is ExamDefinition => exam !== null && !exam.hidden) : []
  const source = list.length ? list : BUILT_IN_EXAMS.filter(exam => !exam.hidden)
  return [...source].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
}

/** Group for <optgroup>s, keeping the first-seen category order. */
export function groupByCategory(exams: readonly ExamDefinition[]): Array<[string, ExamDefinition[]]> {
  const groups = new Map<string, ExamDefinition[]>()
  for (const exam of exams) groups.set(exam.category, [...(groups.get(exam.category) ?? []), exam])
  return [...groups.entries()]
}

/** Name for an exam id even when it has since been hidden or removed from the catalogue. */
export function examName(id: string | null | undefined, catalog: readonly ExamDefinition[]): string {
  const key = id || LEGACY_DEFAULT_EXAM_ID
  return catalog.find(exam => exam.id === key)?.name ?? BUILT_IN_EXAMS.find(exam => exam.id === key)?.name ?? key
}

export function isJeeExam(id: string | null | undefined): boolean {
  return (id || LEGACY_DEFAULT_EXAM_ID) === LEGACY_DEFAULT_EXAM_ID
}
