import { supabase } from '../supabase'
import { BUILT_IN_EXAMS, visibleCatalog, type ExamDefinition } from './catalog'
import { setSubjectCatalog } from './subjects'

/**
 * Reads the visible exam catalogue (RLS lets anyone read rows that are not hidden).
 * Any failure, including the table not existing yet, returns the built-in list.
 */
export async function fetchExamCatalog(): Promise<ExamDefinition[]> {
  if (!supabase) return visibleCatalog(BUILT_IN_EXAMS)
  try {
    const { data, error } = await supabase.from('exam_catalog').select('*').order('sort_order')
    if (error) return visibleCatalog(BUILT_IN_EXAMS)
    const catalog = visibleCatalog(data)
    setSubjectCatalog(catalog)
    return catalog
  } catch {
    return visibleCatalog(BUILT_IN_EXAMS)
  }
}
