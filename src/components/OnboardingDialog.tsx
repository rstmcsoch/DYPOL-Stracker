import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Moon, Sun } from 'lucide-react'
import { Button, Field } from './ui'
import { useData } from '../contexts/DataContext'
import { useAuth } from '../contexts/AuthContext'
import { BUILT_IN_EXAMS, SCHOOL_BOARDS, examYears, groupByCategory, isJeeExam, visibleCatalog } from '../lib/exams/catalog'
import { fetchExamCatalog } from '../lib/exams/fetch-catalog'
import { examSubjects } from '../lib/exams/subjects'
import { seedChapters } from '../lib/defaults'
import type { AppSettings } from '../types'

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * First-run setup. It cannot be dismissed (no close button, Escape or backdrop click) and
 * covers every notebook route until name, exam (with the year/attempt/board it needs) and
 * light/dark are chosen. The Control Center lives on its own route and is never blocked.
 */
export function OnboardingDialog() {
  const { data, upsert, upsertMany } = useData()
  const { user } = useAuth()
  const { data: fetched } = useQuery({ queryKey: ['exam-catalog'], queryFn: fetchExamCatalog, staleTime: 10 * 60_000 })
  const catalog = fetched ?? visibleCatalog(BUILT_IN_EXAMS)
  const settings = data.settings
  const [name, setName] = useState(() => settings.owner_name || data.profile?.display_name || (user?.isLocal ? '' : user?.displayName ?? ''))
  const [examId, setExamId] = useState('')
  const [year, setYear] = useState('')
  const [session, setSession] = useState('')
  const [board, setBoard] = useState('')
  const [addon, setAddon] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark' | ''>('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const panel = useRef<HTMLDivElement>(null)

  const exam = catalog.find(item => item.id === examId)
  const years = exam ? examYears(exam) : []
  const needsBoard = Boolean(exam?.boards.length) || (Boolean(exam?.boards_addon) && addon)
  const boardChoices = exam?.boards.length ? exam.boards : SCHOOL_BOARDS
  const subjects = useMemo(() => exam ? examSubjects({ exam_id: exam.id, exam_session: session || null, boards_addon: addon }, catalog) : [], [exam, session, addon, catalog])

  // Focus trap; Escape is swallowed so the dialog cannot be dismissed from the keyboard.
  useEffect(() => {
    const timer = window.setTimeout(() => panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus(), 30)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return }
      if (event.key !== 'Tab' || !panel.current) return
      const elements = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = elements[0]
      const last = elements.at(-1)
      if (!panel.current.contains(document.activeElement)) { event.preventDefault(); first?.focus(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    document.body.classList.add('modal-open')
    return () => { clearTimeout(timer); document.removeEventListener('keydown', onKey, true); document.body.classList.remove('modal-open') }
  }, [])

  const chooseExam = (id: string) => {
    setExamId(id)
    const next = catalog.find(item => item.id === id)
    if (next && !next.sessions.includes(session)) setSession('')
    if (next && !next.boards_addon) setAddon(false)
    if (next?.boards.length && !next.boards.includes(board)) setBoard('')
    setYear(current => next && examYears(next).includes(Number(current)) ? current : '')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    const cleanName = name.trim()
    if (!cleanName) return setProblem('Add your name.')
    if (cleanName.length > 80) return setProblem('Keep your name under 80 characters.')
    if (!exam) return setProblem('Choose the exam you are preparing for.')
    if (!year) return setProblem('Choose your target year.')
    if (exam.sessions.length && !session) return setProblem(`Choose your ${(exam.session_label || 'attempt / session').toLowerCase()}.`)
    if (needsBoard && !board) return setProblem('Choose your board.')
    if (!theme) return setProblem('Choose light or dark mode.')
    setProblem(null)
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const next: AppSettings = {
        ...settings, owner_name: cleanName, theme,
        exam_id: exam.id, exam_year: Number(year), exam_session: exam.sessions.length ? session : null,
        exam_board: needsBoard ? board : null, boards_addon: exam.boards_addon && addon,
        onboarding_completed: true, updated_at: now
      }
      if (isJeeExam(exam.id) && data.chapters.length === 0) {
        // New JEE notebooks get the JEE syllabus once the exam is known.
        await upsertMany('chapters', seedChapters(settings.user_id ?? settings.id))
      }
      await upsert('app_settings', next)
      if (data.profile && data.profile.display_name !== cleanName) await upsert('profiles', { ...data.profile, display_name: cleanName, updated_at: now })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save. Check your connection and try again.')
    } finally { setSaving(false) }
  }

  return <div className="dialog-backdrop onboarding-backdrop">
    <div className="dialog-panel onboarding-panel" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-intro" ref={panel}>
      <div className="dialog-head"><div>
        <h2 className="type-h2" id="onboarding-title">Set up your notebook</h2>
        <p className="type-body" id="onboarding-intro">Three quick choices so Stracker shows the right subjects, dates and look. You can change them later in Settings.</p>
      </div></div>
      <form className="dialog-content form-stack" onSubmit={event => void submit(event)} noValidate>
        <Field label="Your name" required><input value={name} maxLength={80} autoComplete="name" onChange={event => setName(event.target.value)} /></Field>
        <Field label="Exam" required>
          <select value={examId} onChange={event => chooseExam(event.target.value)}>
            <option value="" disabled>Choose your exam</option>
            {groupByCategory(catalog).map(([category, exams]) => <optgroup key={category} label={category}>
              {exams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </optgroup>)}
          </select>
        </Field>
        {exam && <div className="form-grid two">
          <Field label="Target year" required>
            <select value={year} onChange={event => setYear(event.target.value)}>
              <option value="" disabled>Choose a year</option>
              {years.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          {exam.sessions.length > 0 && <Field label={exam.session_label || 'Attempt / session'} required>
            <select value={session} onChange={event => setSession(event.target.value)}>
              <option value="" disabled>Choose one</option>
              {exam.sessions.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>}
        </div>}
        {exam?.boards_addon && <label className="exam-addon-toggle"><input type="checkbox" checked={addon} onChange={event => setAddon(event.target.checked)} /> Also track my Class 12 boards</label>}
        {needsBoard && <Field label={exam?.boards.length ? 'Board' : 'Class 12 board'} required>
          <select value={board} onChange={event => setBoard(event.target.value)}>
            <option value="" disabled>Choose a board</option>
            {boardChoices.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>}
        {subjects.length > 0 && <p className="jee-small jee-muted">Subjects: {subjects.join(', ')}</p>}
        <fieldset className="onboarding-theme">
          <legend>Appearance <span aria-hidden="true">*</span></legend>
          <label className={theme === 'light' ? 'selected' : ''}><input type="radio" name="onboarding-theme" value="light" checked={theme === 'light'} onChange={() => setTheme('light')} /><Sun size={16} aria-hidden="true" /> Light</label>
          <label className={theme === 'dark' ? 'selected' : ''}><input type="radio" name="onboarding-theme" value="dark" checked={theme === 'dark'} onChange={() => setTheme('dark')} /><Moon size={16} aria-hidden="true" /> Dark</label>
        </fieldset>
        {user?.isLocal && <p className="jee-small jee-muted">Local preview: these choices are saved on this device only.</p>}
        {problem && <p className="field-error" role="alert">{problem}</p>}
        <div className="dialog-actions"><Button type="submit" loading={saving}>{saving ? 'Saving…' : 'Start studying'}</Button></div>
      </form>
    </div>
  </div>
}
