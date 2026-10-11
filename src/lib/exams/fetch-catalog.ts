import { supabase } from '../supabase'
import { BUILT_IN_EXAMS, visibleCatalog, type ExamDefinition } from './catalog'

/**
 * Reads the visible exam catalogue (RLS lets anyone read rows that are not hidden).
 * Any failure, including the table not existing yet, returns the built-in list.
 */
export async function fetchExamCatalog(): Promise<ExamDefinition[]> {
  if (!supabase) return visibleCatalog(BUILT_IN_EXAMS)
  try {
    const { data, error } = await supabase.from('exam_catalog').select('*').order('sort_order')
    if (error) return visibleCatalog(BUILT_IN_EXAMS)
    return visibleCatalog(data)
  } catch {
    return visibleCatalog(BUILT_IN_EXAMS)
  }
}
