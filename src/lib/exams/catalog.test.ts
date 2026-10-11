import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUILT_IN_EXAMS, EXAM_ID_PATTERN, examName, examYears, groupByCategory, isJeeExam, normalizeExam, visibleCatalog } from './catalog'

describe('exam catalogue', () => {
  it('has unique, valid ids and the required exams', () => {
    const ids = BUILT_IN_EXAMS.map(exam => exam.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(EXAM_ID_PATTERN.test(id)).toBe(true)
    for (const id of ['jee', 'neet-ug', 'mht-cet', 'class-9', 'class-10', 'class-11', 'class-12', 'ca-foundation', 'ca-intermediate', 'ca-final']) expect(ids).toContain(id)
  })

  it('seeds the database with exactly the built-in list', () => {
    const sql = readFileSync(new URL('../../../supabase/migrations/20261011100000_exam_catalog.sql', import.meta.url), 'utf8')
    for (const exam of BUILT_IN_EXAMS) expect(sql).toContain(`('${exam.id}', '${exam.name}'`)
    expect(sql).toContain('force row level security')
    expect(sql).toContain('using (hidden = false)')
  })

  it('derives four target years when none are configured', () => {
    expect(examYears({ years: [] }, new Date('2026-10-11T00:00:00Z'))).toEqual([2026, 2027, 2028, 2029])
    expect(examYears({ years: [2029, 2027] })).toEqual([2027, 2029])
  })

  it('drops invalid and hidden rows and falls back to the built-in list', () => {
    expect(normalizeExam({ id: 'Bad Id', name: 'x', category: 'y' })).toBeNull()
    expect(visibleCatalog(null).length).toBe(BUILT_IN_EXAMS.length)
    const rows = [{ id: 'neet-ug', name: 'NEET UG', category: 'Medical', sort_order: 2 }, { id: 'jee', name: 'JEE', category: 'Engineering', sort_order: 1 }, { id: 'cat', name: 'CAT', category: 'PG', hidden: true }]
    expect(visibleCatalog(rows).map(exam => exam.id)).toEqual(['jee', 'neet-ug'])
    expect(groupByCategory(visibleCatalog(rows)).map(([category]) => category)).toEqual(['Engineering', 'Medical'])
  })

  it('treats a missing selection as JEE and names removed exams', () => {
    expect(isJeeExam(null)).toBe(true)
    expect(isJeeExam('neet-ug')).toBe(false)
    expect(examName(null, [])).toBe('JEE (Main + Advanced)')
    expect(examName('cat', [])).toBe('CAT')
    expect(examName('retired-exam', [])).toBe('retired-exam')
  })
})
