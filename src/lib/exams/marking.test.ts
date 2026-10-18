import { describe, expect, it } from 'vitest'
import { BUILT_IN_EXAMS } from './catalog'
import { aggregateScoresBySubject, BUILT_IN_MARKING_SCHEMES, combinedSubjectTotal, defaultForSubject, defaultTotalFor, fullMockDefaults, markingSchemeFor, normalizeMarkingScheme, papersText, parsePapersText, parsePerSubjectText, perSubjectText, validateMarkingScheme } from './marking'
import { getFullMockAggregate, getSubjectPerformance } from '../analytics'
import type { AppData } from '../../types'

const scheme = (id: string) => BUILT_IN_MARKING_SCHEMES[id]!

describe('built-in marking defaults', () => {
  it('covers every catalog exam', () => {
    expect(BUILT_IN_EXAMS.map(exam => exam.id).filter(id => !BUILT_IN_MARKING_SCHEMES[id])).toEqual([])
    for (const exam of BUILT_IN_EXAMS) expect(exam.marking_scheme?.source.length).toBeGreaterThan(3)
  })
  it('matches the required JEE Main and other-test defaults', () => {
    expect(scheme('jee').full.total).toBe(300)
    expect(defaultTotalFor(scheme('jee'), 'Full Mock', 'Physics')).toBe('100')
    expect(defaultTotalFor(scheme('jee'), 'Subject Test', 'Chemistry')).toBe('60')
    expect(scheme('jee').other.total).toBe(180)
  })
  it('expands JEE Advanced both papers to six 60-mark entries combining to 360', () => {
    const defaults = fullMockDefaults(scheme('jee'), ['Physics', 'Chemistry', 'Maths'], 'advanced-both')
    expect(Object.keys(defaults)).toHaveLength(6)
    expect(Object.values(defaults).every(entry => entry.total === '60')).toBe(true)
    const scores = Object.entries(defaults).map(([subject, entry]) => ({ subject, marks_obtained: 30, total_marks: Number(entry.total) }))
    expect(combinedSubjectTotal(scores)).toEqual({ marks: 180, total: 360 })
    expect(aggregateScoresBySubject(scores).get('Physics')).toMatchObject({ marks: 60, total: 120 })
  })
  it('matches NEET full and part patterns including the Botany/Zoology split', () => {
    expect(scheme('neet-ug').full.total).toBe(720)
    expect(defaultForSubject(scheme('neet-ug').full, 'Botany')).toBe(90)
    expect(defaultForSubject(scheme('neet-ug').full, 'Zoology')).toBe(90)
    expect(defaultTotalFor(scheme('neet-ug'), 'Chapter Test', 'Physics')).toBe('90')
    expect(scheme('neet-ug').other.total).toBe(360)
  })
  it('has researched totals for the other named exams', () => {
    const totals: Record<string, number | null> = { 'mht-cet': 200, bitsat: 390, viteee: 500, 'comedk-uget': 180, wbjee: 200, kcet: 180, 'cuet-ug': null, clat: 120, nda: 900, gate: 100, cat: 204 }
    for (const [id, total] of Object.entries(totals)) expect(scheme(id).full.total, id).toBe(total)
    expect(defaultTotalFor(scheme('cuet-ug'), 'Subject Test', 'Physics')).toBe('250')
    expect(defaultTotalFor(scheme('gate'), 'Full Mock', 'General Aptitude')).toBe('15')
    expect(defaultTotalFor(scheme('class-12'), 'Subject Test', 'Physics')).toBe('70')
    expect(defaultTotalFor(scheme('class-12'), 'Subject Test', 'English')).toBe('80')
    expect(defaultTotalFor(scheme('ca-final'), 'Subject Test', 'Financial Reporting')).toBe('100')
  })
  it('uses a valid owner/DB scheme and falls back when it is malformed or absent', () => {
    const custom = normalizeMarkingScheme({ full: { total: 10, perSubject: { Physics: 10 } }, other: { total: 5, perSubject: { Physics: 5 } }, combine: 'sum_subjects', source: 'Owner test' })
    expect(markingSchemeFor({ id: 'jee', marking_scheme: custom })?.full.total).toBe(10)
    expect(markingSchemeFor({ id: 'jee', marking_scheme: { full: { total: -1, perSubject: {} }, other: {}, source: 'x' } })?.full.total).toBe(300)
    expect(markingSchemeFor({ id: 'unknown-exam', marking_scheme: null })).toBeNull()
    expect(markingSchemeFor(null)?.full.total).toBe(300)
  })
})

describe('JEE Advanced analytics combine', () => {
  it('combines both papers into a 360 test and one 120-mark subject result', () => {
    const scores = ['Physics', 'Chemistry', 'Maths'].flatMap(subject => [1, 2].map(paper => ({
      id: `${subject}-${paper}`, test_id: 'adv', subject: `${subject} — Paper ${paper}`, marks_obtained: 30, total_marks: 60, created_at: '', updated_at: ''
    })))
    const test = { id: 'adv', title: 'Advanced both', test_date: '2026-10-01', test_type: 'Full Mock' as const, subject: null, chapter_id: null, marks_obtained: 180, total_marks: 360, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: '', created_at: '', updated_at: '' }
    expect(getFullMockAggregate('adv', scores)).toEqual({ marks: 180, total: 360 })
    const data = { settings: { exam_id: 'jee' }, chapters: [], tests: [test], testSubjectScores: scores } as unknown as AppData
    expect(getSubjectPerformance(data).find(row => row.subject === 'Physics')).toEqual({ subject: 'Physics', average: 50, count: 1 })
  })
})

describe('owner marking validation and text formats', () => {
  it('accepts every built-in scheme', () => {
    for (const [id, value] of Object.entries(BUILT_IN_MARKING_SCHEMES)) expect(validateMarkingScheme(value), id).toEqual([])
  })
  it('parses and round-trips per-subject and paper text', () => {
    expect(parsePerSubjectText('Physics = 100\nChemistry = 100')).toEqual({ Physics: 100, Chemistry: 100 })
    expect(perSubjectText({ Physics: 100 })).toBe('Physics = 100')
    const papers = parsePapersText('Paper 1 | 180 | Physics = 60; Chemistry = 60; Maths = 60')
    expect(papers).toEqual([{ id: 'paper-1', label: 'Paper 1', total: 180, perSubject: { Physics: 60, Chemistry: 60, Maths: 60 } }])
    expect(papersText(papers)).toContain('Paper 1 | 180')
    expect(() => parsePerSubjectText('Physics 100')).toThrow('Subject = marks')
  })
  it('rejects paper totals that do not add up and bad combine rules', () => {
    const bad = { ...scheme('jee'), full: { ...scheme('jee').full, papers: [{ id: 'paper-1', label: 'Paper 1', total: 180, perSubject: { Physics: 50 } }] } }
    expect(validateMarkingScheme(bad).join(' ')).toContain('add to 50, not 180')
    expect(validateMarkingScheme({ ...scheme('jee'), combine: 'multiply' }).length).toBeGreaterThan(0)
    expect(validateMarkingScheme({ ...scheme('jee'), source: '' }).length).toBeGreaterThan(0)
  })
})
