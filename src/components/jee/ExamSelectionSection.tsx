import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, GraduationCap } from 'lucide-react'
import { Button, Field, NotebookCard } from '../ui'
import { useData } from '../../contexts/DataContext'
import { useToast } from '../../contexts/ToastContext'
import { BUILT_IN_EXAMS, LEGACY_DEFAULT_EXAM_ID, SCHOOL_BOARDS, examYears, groupByCategory, isJeeExam, visibleCatalog, type ExamDefinition } from '../../lib/exams/catalog'
import { fetchExamCatalog } from '../../lib/exams/fetch-catalog'

/**
 * Student's exam, target year, attempt and board. Students set up before this existed
 * have no saved exam and are shown (and treated) as JEE, so nothing changes for them
 * until they pick something else. Hidden/removed exams stay selectable for students
 * already on them.
 */
export function ExamSelectionSection() {
  const { data, upsert } = useData()
  const { notify } = useToast()
  const settings = data.settings
  const { data: fetched } = useQuery({ queryKey: ['exam-catalog'], queryFn: fetchExamCatalog, staleTime: 10 * 60_000 })
  const catalog = fetched ?? visibleCatalog(BUILT_IN_EXAMS)

  const [examId, setExamId] = useState(settings.exam_id ?? LEGACY_DEFAULT_EXAM_ID)
  const [year, setYear] = useState<string>(settings.exam_year ? String(settings.exam_year) : '')
  const [session, setSession] = useState(settings.exam_session ?? '')
  const [board, setBoard] = useState(settings.exam_board ?? '')
  const [addon, setAddon] = useState(settings.boards_addon)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setExamId(settings.exam_id ?? LEGACY_DEFAULT_EXAM_ID)
    setYear(settings.exam_year ? String(settings.exam_year) : '')
    setSession(settings.exam_session ?? '')
    setBoard(settings.exam_board ?? '')
    setAddon(settings.boards_addon)
  }, [settings.exam_id, settings.exam_year, settings.exam_session, settings.exam_board, settings.boards_addon])

  const options = useMemo(() => {
    if (catalog.some(exam => exam.id === examId)) return catalog
    const kept = BUILT_IN_EXAMS.find(exam => exam.id === examId)
    const legacy: ExamDefinition = kept ?? { id: examId, name: examId, category: 'Your exam', years: [], sessions: [], boards: [], boards_addon: false, sort_order: 0, hidden: true }
    return [{ ...legacy, name: `${legacy.name} (no longer listed)` }, ...catalog]
  }, [catalog, examId])
  const exam = options.find(item => item.id === examId) ?? options[0]
  const years = exam ? examYears(exam) : []
  const yearChoices = year && !years.includes(Number(year)) ? [Number(year), ...years] : years
  const boardChoices = exam?.boards.length ? exam.boards : SCHOOL_BOARDS
  const needsBoard = Boolean(exam?.boards.length) || (Boolean(exam?.boards_addon) && addon)

  const changeExam = (next: string) => {
    setExamId(next)
    const nextExam = options.find(item => item.id === next)
    if (nextExam && !nextExam.sessions.includes(session)) setSession('')
    if (nextExam && !nextExam.boards_addon) setAddon(false)
  }

  const save = async () => {
    if (saving || !exam) return
    setSaving(true)
    try {
      await upsert('app_settings', {
        ...settings,
        exam_id: exam.id,
        exam_year: year ? Number(year) : null,
        exam_session: exam.sessions.length && session ? session : null,
        exam_board: needsBoard && board ? board : null,
        boards_addon: exam.boards_addon && addon,
        updated_at: new Date().toISOString()
      })
      notify('Exam saved.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save your exam.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return <NotebookCard className="settings-section exam-selection-section">
    <div className="jee-settings-head"><GraduationCap size={18} aria-hidden="true" /><div><strong>Your exam</strong><small className="jee-muted">Pick what you are preparing for and your target year.</small></div></div>
    <div className="settings-section-content">
      <div className="form-grid two">
        <Field label="Exam">
          <select value={exam?.id ?? ''} onChange={event => changeExam(event.target.value)}>
            {groupByCategory(options).map(([category, exams]) => <optgroup key={category} label={category}>
              {exams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </optgroup>)}
          </select>
        </Field>
        <Field label="Target year">
          <select value={year} onChange={event => setYear(event.target.value)}>
            <option value="">Not set</option>
            {yearChoices.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        {exam && exam.sessions.length > 0 && <Field label="Attempt / session">
          <select value={session} onChange={event => setSession(event.target.value)}>
            <option value="">Not set</option>
            {exam.sessions.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>}
        {exam?.boards_addon && <label className="exam-addon-toggle">
          <input type="checkbox" checked={addon} onChange={event => setAddon(event.target.checked)} /> Also track my Class 12 boards
        </label>}
        {needsBoard && <Field label={exam?.boards.length ? 'Board' : 'Class 12 board'}>
          <select value={board} onChange={event => setBoard(event.target.value)}>
            <option value="">Not set</option>
            {boardChoices.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>}
      </div>
      {exam && !isJeeExam(exam.id) && <p className="jee-small jee-muted">Your existing syllabus, tests and notes are kept as they are. A new notebook for this exam starts with an empty syllabus you can fill in on the Syllabus page.</p>}
      <div className="jee-section-save"><Button variant="secondary" size="sm" onClick={() => void save()} loading={saving}><Check size={14} /> Save exam</Button></div>
    </div>
  </NotebookCard>
}
