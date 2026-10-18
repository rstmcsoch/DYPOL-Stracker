import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useData } from '../../contexts/DataContext'
import type { AppData } from '../../types'
import { fetchExamCatalog } from './fetch-catalog'
import { BUILT_IN_EXAMS, LEGACY_DEFAULT_EXAM_ID, type ExamDefinition } from './catalog'
import { currentSubjectCatalog, examSubjects, subjectsFor, subscribeSubjectCatalog } from './subjects'

let requested = false

/** The published catalogue (built-in list until the fetch lands; the fetch runs once per page load). */
function useCatalog() {
  useEffect(() => {
    if (requested) return
    requested = true
    void fetchExamCatalog()
  }, [])
  return useSyncExternalStore(subscribeSubjectCatalog, currentSubjectCatalog, currentSubjectCatalog)
}

/** Subjects for pickers: only the chosen exam's subjects (plus the current value, if it is an older one). */
export function useExamSubjects(current?: string | null): string[] {
  const { data } = useData()
  const catalog = useCatalog()
  return useMemo(() => {
    const list = examSubjects(data.settings, catalog)
    return current && !list.includes(current) ? [...list, current] : list
  }, [data.settings, catalog, current])
}

/** Subjects for analytics and filters over existing records. */
export function useReportSubjects(source?: AppData): string[] {
  const { data } = useData()
  const catalog = useCatalog()
  const scoped = source ?? data
  return useMemo(() => subjectsFor(scoped, catalog), [scoped, catalog])
}

/** The student's current exam definition, including owner-edited marking defaults. */
export function useCurrentExam(): ExamDefinition | null {
  const { data } = useData()
  const catalog = useCatalog()
  return useMemo(() => {
    const id = data.settings.exam_id ?? LEGACY_DEFAULT_EXAM_ID
    return catalog.find(exam => exam.id === id) ?? BUILT_IN_EXAMS.find(exam => exam.id === id) ?? null
  }, [data.settings.exam_id, catalog])
}
