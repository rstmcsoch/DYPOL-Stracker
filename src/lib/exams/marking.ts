/**
 * Researched marking defaults for the Add Test form.
 *
 * These values only pre-fill a new form. They are never written over a saved test, and every
 * field stays editable. `full` is used for Full Mock; `other` for Chapter Test, Subject Test
 * and PYQ Practice. Where an official exam has alternative subject groups or separate stages,
 * `combine: 'per_subject'` means there is no honest single combined total: each entered
 * subject/paper keeps its own official total and the saved test sums only what was entered.
 */
export interface MarkingPaper {
  id: string
  label: string
  total: number
  perSubject: Record<string, number>
}

export interface MarkingPattern {
  /** Official combined total, or null when it depends on the subjects/papers entered. */
  total: number | null
  perSubject: Record<string, number>
  defaultPerSubject?: number
  papers?: MarkingPaper[]
}

export type MarkingCombineRule = 'sum_subjects' | 'sum_papers' | 'per_subject'

export interface MarkingScheme {
  full: MarkingPattern
  other: MarkingPattern
  combine: MarkingCombineRule
  /** Official body/source used for the researched pattern. */
  source: string
  notes?: string
}

const pattern = (total: number | null, perSubject: Record<string, number> = {}, defaultPerSubject?: number, papers?: MarkingPaper[]): MarkingPattern =>
  ({ total, perSubject, ...(defaultPerSubject ? { defaultPerSubject } : {}), ...(papers?.length ? { papers } : {}) })
const scheme = (full: MarkingPattern, other: MarkingPattern, source: string, combine: MarkingCombineRule = 'sum_subjects', notes?: string): MarkingScheme =>
  ({ full, other, combine, source, ...(notes ? { notes } : {}) })
const each = (subjects: readonly string[], full: number, other = full): [MarkingPattern, MarkingPattern] => [
  pattern(null, Object.fromEntries(subjects.map(subject => [subject, full]))),
  pattern(null, Object.fromEntries(subjects.map(subject => [subject, other])))
]

const jeePaper = (id: string, label: string): MarkingPaper => ({ id, label, total: 180, perSubject: { Physics: 60, Chemistry: 60, Maths: 60 } })

/** Built-in fallback for every catalog exam. Owner edits in exam_catalog.marking_scheme win. */
export const BUILT_IN_MARKING_SCHEMES: Record<string, MarkingScheme> = {
  jee: scheme(
    pattern(300, { Physics: 100, Chemistry: 100, Maths: 100 }, undefined, [jeePaper('advanced-paper-1', 'Paper 1'), jeePaper('advanced-paper-2', 'Paper 2')]),
    pattern(180, { Physics: 60, Chemistry: 60, Maths: 60 }),
    'NTA JEE (Main) and IIT JEE (Advanced) 2026', 'sum_papers',
    'Full Mock asks Main, Advanced Paper 1 only, or Advanced Paper 1 + Paper 2. Both Advanced papers combine to 360.'
  ),
  'mht-cet': scheme(pattern(200, { Physics: 50, Chemistry: 50, Maths: 100, Biology: 100 }), pattern(100, { Physics: 25, Chemistry: 25, Maths: 50, Biology: 50 }), 'Maharashtra State CET Cell, MHT CET 2026', 'sum_subjects', 'PCM and PCB are alternative groups; do not enter Maths and Biology for one official full paper.'),
  bitsat: scheme(pattern(390, { Physics: 90, Chemistry: 90, Maths: 120, Biology: 120, 'English Proficiency': 30, English: 30, 'Logical Reasoning': 60 }), pattern(195, { Physics: 45, Chemistry: 45, Maths: 60, Biology: 60, 'English Proficiency': 15, English: 15, 'Logical Reasoning': 30 }), 'BITS Pilani, BITSAT 2026', 'sum_subjects', 'Maths and Biology are alternatives. Optional extra questions can raise the attempted maximum beyond the standard 390.'),
  viteee: scheme(pattern(500, { Maths: 160, Biology: 160, Physics: 140, Chemistry: 140, Aptitude: 40, English: 20 }), pattern(250, { Maths: 80, Biology: 80, Physics: 70, Chemistry: 70, Aptitude: 20, English: 10 }), 'VIT, VITEEE 2026', 'sum_subjects', 'Maths and Biology are alternative streams.'),
  'comedk-uget': scheme(pattern(180, { Physics: 60, Chemistry: 60, Maths: 60 }), pattern(90, { Physics: 30, Chemistry: 30, Maths: 30 }), 'COMEDK UGET 2026'),
  wbjee: scheme(pattern(200, { Maths: 100, Physics: 50, Chemistry: 50 }), pattern(100, { Maths: 50, Physics: 25, Chemistry: 25 }), 'WBJEEB, WBJEE 2026'),
  kcet: scheme(pattern(180, { Physics: 60, Chemistry: 60, Maths: 60, Biology: 60 }), pattern(180, { Physics: 60, Chemistry: 60, Maths: 60, Biology: 60 }), 'KEA, KCET 2026', 'sum_subjects', 'Each official subject paper is 60; PCM and PCB are alternative groups.'),
  'neet-ug': scheme(pattern(720, { Physics: 180, Chemistry: 180, Biology: 180, Botany: 90, Zoology: 90 }), pattern(360, { Physics: 90, Chemistry: 90, Biology: 180, Botany: 90, Zoology: 90 }), 'NTA, NEET (UG) 2026', 'sum_subjects', 'Use Botany + Zoology (90 each) or a combined Biology entry (180 full / 180 in the 360-mark part pattern), not both.'),
  'cuet-ug': scheme(pattern(null, {}, 250), pattern(null, {}, 250), 'NTA, CUET (UG) 2026', 'per_subject', 'Every chosen subject is a separate 250-mark paper; there is no single combined CUET total.'),
  clat: scheme(pattern(120, { 'English Language': 24, English: 24, 'Current Affairs & GK': 28, 'Legal Reasoning': 30, 'Logical Reasoning': 26, 'Quantitative Techniques': 12 }), pattern(60, { 'English Language': 12, English: 12, 'Current Affairs & GK': 14, 'Legal Reasoning': 15, 'Logical Reasoning': 13, 'Quantitative Techniques': 6 }), 'Consortium of NLUs, CLAT 2026'),
  nda: scheme(pattern(900, { Maths: 300, English: 200, 'General Knowledge': 400 }), pattern(900, { Maths: 300, English: 200, 'General Knowledge': 400 }), 'UPSC, NDA & NA 2026', 'sum_subjects', 'Mathematics is 300 and the General Ability Test is 600 (English 200 + General Knowledge 400).'),
  'class-9': scheme(pattern(null, {}, 80), pattern(null, {}, 80), 'CBSE Class IX assessment scheme', 'per_subject', 'Written paper default is 80 of a 100-mark subject total (20 internal assessment). School patterns can vary.'),
  'class-10': scheme(pattern(null, {}, 80), pattern(null, {}, 80), 'CBSE Classes X subject-wise marks distribution 2026', 'per_subject', 'Written paper default is 80 of a 100-mark subject total (20 internal assessment).'),
  'class-11': scheme(pattern(null, { Physics: 70, Chemistry: 70, Biology: 70, Geography: 70, Psychology: 70 }, 80), pattern(null, { Physics: 70, Chemistry: 70, Biology: 70, Geography: 70, Psychology: 70 }, 80), 'CBSE Class XI assessment scheme', 'per_subject', 'Most written papers are 80; practical subjects commonly use 70 theory + 30 practical. School patterns can vary.'),
  'class-12': scheme(pattern(null, { Physics: 70, Chemistry: 70, Biology: 70, Geography: 70, Psychology: 70 }, 80), pattern(null, { Physics: 70, Chemistry: 70, Biology: 70, Geography: 70, Psychology: 70 }, 80), 'CBSE Class XII subject-wise marks distribution 2026', 'per_subject', 'Most written papers are 80 + 20 internal/project; practical sciences are commonly 70 + 30.'),
  'ca-foundation': scheme(...each(['Accounting', 'Business Laws', 'Quantitative Aptitude', 'Business Economics'], 100), 'ICAI CA Foundation', 'per_subject', 'Four papers of 100 each (400 in aggregate).'),
  'ca-intermediate': scheme(pattern(null, {}, 100), pattern(null, {}, 100), 'ICAI CA Intermediate', 'per_subject', 'Six papers of 100 each (600 in aggregate).'),
  'ca-final': scheme(pattern(null, {}, 100), pattern(null, {}, 100), 'ICAI CA Final', 'per_subject', 'Six papers of 100 each (600 in aggregate).'),
  'cs-executive': scheme(pattern(null, {}, 100), pattern(null, {}, 100), 'ICSI CS Executive', 'per_subject', 'Seven papers of 100 each (700 in aggregate).'),
  'cs-professional': scheme(pattern(null, {}, 100), pattern(null, {}, 100), 'ICSI CS Professional', 'per_subject', 'Seven papers of 100 each (700 in aggregate).'),
  'cma-intermediate': scheme(pattern(null, {}, 100), pattern(null, {}, 100), 'ICMAI CMA Intermediate Syllabus 2022', 'per_subject', 'Eight papers of 100 each (800 in aggregate).'),
  'cma-final': scheme(pattern(null, {}, 100), pattern(null, {}, 100), 'ICMAI CMA Final Syllabus 2022', 'per_subject', 'Eight papers of 100 each (800 in aggregate).'),
  gate: scheme(pattern(100, { 'General Aptitude': 15, 'Engineering Maths': 13, 'Core Subject': 72 }), pattern(100, { 'General Aptitude': 15, 'Engineering Maths': 13, 'Core Subject': 72 }), 'IIT Guwahati, GATE 2026', 'sum_subjects', 'One GATE paper is 100: General Aptitude 15 and subject component 85 (Engineering Mathematics 13 + core 72 in engineering papers).'),
  cat: scheme(pattern(204, { 'Verbal Ability and Reading Comprehension': 72, 'Data Interpretation and Logical Reasoning': 66, 'Quantitative Ability': 66 }), pattern(204, { 'Verbal Ability and Reading Comprehension': 72, 'Data Interpretation and Logical Reasoning': 66, 'Quantitative Ability': 66 }), 'IIM CAT 2025 pattern (CAT 2026 bulletin structure)', 'sum_subjects', 'CAT totals can change by year; this uses the latest completed official pattern of 68 questions at 3 marks each.'),
  'upsc-cse': scheme(pattern(null, { 'GS Paper I (Prelims)': 200, 'CSAT (Prelims)': 200, Essay: 250, 'GS I': 250, 'GS II': 250, 'GS III': 250, 'GS IV': 250, 'Optional Subject': 250 }, 250), pattern(null, { 'GS Paper I (Prelims)': 200, 'CSAT (Prelims)': 200, Essay: 250, 'GS I': 250, 'GS II': 250, 'GS III': 250, 'GS IV': 250, 'Optional Subject': 250 }, 250), 'UPSC Civil Services Examination 2026', 'per_subject', 'Prelims papers are 200 each; each merit Mains paper is 250. Prelims and Mains are separate stages, not one combined test.'),
  'ssc-cgl': scheme(pattern(null, { 'Quantitative Aptitude': 50, Reasoning: 50, English: 50, 'General Awareness': 50, 'Computer Knowledge': 60 }), pattern(null, { 'Quantitative Aptitude': 50, Reasoning: 50, English: 50, 'General Awareness': 50, 'Computer Knowledge': 60 }), 'SSC CGL 2026 notification', 'per_subject', 'Tier I is 200 (four sections of 50). Tier II has a different 450-mark Paper I structure; Computer Knowledge is shown at its Tier II module value.'),
  'ibps-po': scheme(pattern(null, { English: 30, 'Quantitative Aptitude': 35, Reasoning: 35, 'Data Analysis and Interpretation': 60, 'General, Economy and Banking Awareness': 60 }), pattern(null, { English: 30, 'Quantitative Aptitude': 35, Reasoning: 35, 'Data Analysis and Interpretation': 60, 'General, Economy and Banking Awareness': 60 }), 'IBPS PO/MT-XVI 2026 notification', 'per_subject', 'Prelims is 100 (English 30, Quantitative Aptitude 35, Reasoning 35). Mains-only sections use their 2026 Mains values; stages are not combined.'),
  'sbi-po': scheme(pattern(null, { English: 30, 'Quantitative Aptitude': 35, 'Reasoning and Computer Aptitude': 60, 'Data Analysis and Interpretation': 60, 'General, Economy and Banking Awareness': 60 }), pattern(null, { English: 30, 'Quantitative Aptitude': 35, 'Reasoning and Computer Aptitude': 60, 'Data Analysis and Interpretation': 60, 'General, Economy and Banking Awareness': 60 }), 'SBI PO 2026 notification', 'per_subject', 'Prelims is 100 (English 30, Quantitative Aptitude 35, Reasoning 35 within the combined section). Mains-only sections use their 2026 Mains values; stages are not combined.')
}

export function builtInMarkingScheme(examId: string | null | undefined): MarkingScheme | null {
  return examId ? BUILT_IN_MARKING_SCHEMES[examId] ?? null : BUILT_IN_MARKING_SCHEMES.jee ?? null
}

const positive = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000 ? value : null
const label = (value: unknown, max = 60): string | null => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null

function normalizePattern(value: unknown): MarkingPattern | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const total = record.total === null ? null : positive(record.total)
  if (record.total !== null && total === null) return null
  if (!record.perSubject || typeof record.perSubject !== 'object' || Array.isArray(record.perSubject)) return null
  const entries = Object.entries(record.perSubject as Record<string, unknown>).slice(0, 40)
  const perSubject: Record<string, number> = {}
  for (const [subject, marks] of entries) {
    const name = label(subject); const amount = positive(marks)
    if (!name || amount === null) return null
    perSubject[name] = amount
  }
  const defaultPerSubject = record.defaultPerSubject === undefined ? undefined : positive(record.defaultPerSubject)
  if (record.defaultPerSubject !== undefined && defaultPerSubject === null) return null
  let papers: MarkingPaper[] | undefined
  if (record.papers !== undefined) {
    if (!Array.isArray(record.papers) || record.papers.length > 6) return null
    papers = []
    for (const raw of record.papers) {
      if (!raw || typeof raw !== 'object') return null
      const paper = raw as Record<string, unknown>
      const id = label(paper.id, 40); const paperLabel = label(paper.label, 60); const paperTotal = positive(paper.total)
      if (!id || !paperLabel || paperTotal === null || !paper.perSubject || typeof paper.perSubject !== 'object') return null
      const subjects: Record<string, number> = {}
      for (const [subject, marks] of Object.entries(paper.perSubject as Record<string, unknown>).slice(0, 40)) {
        const name = label(subject); const amount = positive(marks)
        if (!name || amount === null) return null
        subjects[name] = amount
      }
      papers.push({ id, label: paperLabel, total: paperTotal, perSubject: subjects })
    }
  }
  return pattern(total, perSubject, defaultPerSubject ?? undefined, papers)
}

/** Structural validation for a stored scheme. Returns null for anything unusable. */
export function normalizeMarkingScheme(value: unknown): MarkingScheme | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const full = normalizePattern(record.full); const other = normalizePattern(record.other)
  const source = label(record.source, 200)
  const combine = record.combine === 'sum_papers' || record.combine === 'per_subject' ? record.combine : record.combine === 'sum_subjects' || record.combine === undefined ? 'sum_subjects' : null
  if (!full || !other || !source || !combine) return null
  const notes = record.notes === undefined ? undefined : label(record.notes, 500)
  if (record.notes !== undefined && !notes) return null
  return { full, other, combine, source, ...(notes ? { notes } : {}) }
}

export function markingSchemeFor(exam: { id: string; marking_scheme?: unknown } | null | undefined): MarkingScheme | null {
  return normalizeMarkingScheme(exam?.marking_scheme) ?? builtInMarkingScheme(exam?.id)
}

/** Base subject for a paper-specific score label such as "Physics — Paper 1". */
export function scoreSubjectBase(subject: string): string {
  return subject.replace(/\s+—\s+Paper\s+[12]$/i, '')
}

export function defaultForSubject(patternValue: MarkingPattern, subject: string): number | null {
  const base = scoreSubjectBase(subject)
  if (patternValue.perSubject[subject] !== undefined) return patternValue.perSubject[subject] ?? null
  if (patternValue.perSubject[base] !== undefined) return patternValue.perSubject[base] ?? null
  if ((base === 'Botany' || base === 'Zoology') && patternValue.perSubject.Biology !== undefined) return (patternValue.perSubject.Biology ?? 0) / 2
  if (base === 'Biology' && patternValue.perSubject.Botany !== undefined && patternValue.perSubject.Zoology !== undefined) return (patternValue.perSubject.Botany ?? 0) + (patternValue.perSubject.Zoology ?? 0)
  return patternValue.defaultPerSubject ?? null
}

export type JeeFullPattern = 'main' | 'advanced-paper-1' | 'advanced-both'

/** Pre-filled subject totals for a Full Mock. JEE Advanced both-papers expands to paper entries. */
export function fullMockDefaults(schemeValue: MarkingScheme | null, subjects: readonly string[], jeePattern: JeeFullPattern = 'main'): Record<string, { marks: string; total: string }> {
  const out: Record<string, { marks: string; total: string }> = {}
  if (!schemeValue) return Object.fromEntries(subjects.map(subject => [subject, { marks: '', total: '' }]))
  if (jeePattern !== 'main' && schemeValue.full.papers?.length) {
    const papers = jeePattern === 'advanced-paper-1' ? schemeValue.full.papers.slice(0, 1) : schemeValue.full.papers
    for (const paper of papers) for (const subject of subjects) {
      const total = paper.perSubject[subject] ?? paper.perSubject[scoreSubjectBase(subject)]
      if (total) out[`${subject} — ${paper.label}`] = { marks: '', total: String(total) }
    }
    return out
  }
  for (const subject of subjects) {
    const total = defaultForSubject(schemeValue.full, subject)
    out[subject] = { marks: '', total: total ? String(total) : '' }
  }
  return out
}

export function defaultTotalFor(schemeValue: MarkingScheme | null, testType: string, subject?: string | null): string {
  if (!schemeValue) return ''
  const selected = testType === 'Full Mock' ? schemeValue.full : schemeValue.other
  if (subject) return defaultForSubject(selected, subject)?.toString() ?? ''
  return selected.total?.toString() ?? ''
}

/** Sum entered subject/paper scores. This is the Advanced both-papers combine rule (360 max). */
export function combinedSubjectTotal(scores: readonly { marks_obtained: number | null; total_marks: number | null }[]): { marks: number; total: number } | null {
  if (!scores.length || scores.some(score => score.marks_obtained === null || score.total_marks === null)) return null
  return { marks: scores.reduce((sum, score) => sum + (score.marks_obtained ?? 0), 0), total: scores.reduce((sum, score) => sum + (score.total_marks ?? 0), 0) }
}

/** Combine paper-specific rows back into their base subject for subject-level analytics. */
export function aggregateScoresBySubject<T extends { subject: string; marks_obtained: number | null; total_marks: number | null }>(scores: readonly T[]): Map<string, { marks: number; total: number; rows: T[] }> {
  const grouped = new Map<string, { marks: number; total: number; rows: T[] }>()
  for (const score of scores) {
    const base = scoreSubjectBase(score.subject)
    const current = grouped.get(base) ?? { marks: 0, total: 0, rows: [] }
    current.marks += score.marks_obtained ?? 0; current.total += score.total_marks ?? 0; current.rows.push(score)
    grouped.set(base, current)
  }
  return grouped
}
