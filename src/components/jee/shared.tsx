/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'
import { Check, Circle, CircleDashed } from 'lucide-react'
import type { Chapter, Subject } from '../../types'
import { SUBJECTS } from '../../types'
import { StatusBadge } from '../ui'
import type { StageState } from '../../lib/jee/progress'

/** Compact chip-style filter group. Each option is a 40px-high tap target on touch screens. */
export function ChipFilter<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void
}) {
  return <div className="jee-chip-filter" role="group" aria-label={label}>
    <span className="jee-chip-filter-label">{label}</span>
    <div className="jee-chip-row">
      {options.map(option => <button key={option.value} type="button" className={`jee-chip ${value === option.value ? 'active' : ''}`} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
  </div>
}

export function ChapterSelect({ chapters, value, onChange, subject, label = 'Chapter', allowNone = false, noneLabel = 'All chapters' }: {
  chapters: Chapter[]; value: string; onChange: (value: string) => void; subject?: Subject | 'all' | ''; label?: string; allowNone?: boolean; noneLabel?: string
}) {
  const visible = chapters.filter(chapter => !subject || subject === 'all' || chapter.subject === subject)
  return <label className="jee-select">
    <span>{label}</span>
    <select value={value} onChange={event => onChange(event.target.value)}>
      {allowNone ? <option value="">{noneLabel}</option> : <option value="" disabled>Choose a chapter</option>}
      {SUBJECTS.map(item => {
        const group = visible.filter(chapter => chapter.subject === item)
        if (!group.length) return null
        return <optgroup key={item} label={item}>{group.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</optgroup>
      })}
    </select>
  </label>
}

export function SubjectSelect({ value, onChange, allowAll = true, label = 'Subject' }: { value: string; onChange: (value: string) => void; allowAll?: boolean; label?: string }) {
  return <label className="jee-select">
    <span>{label}</span>
    <select value={value} onChange={event => onChange(event.target.value)}>
      {allowAll && <option value="all">All subjects</option>}
      {SUBJECTS.map(subject => <option key={subject} value={subject}>{subject}</option>)}
    </select>
  </label>
}

/** The five-stage pipeline, rendered as a row of small stage tokens that wrap on narrow screens. */
export function StagePipeline({ stages, compact = false }: { stages: StageState[]; compact?: boolean }) {
  return <ol className={`jee-pipeline ${compact ? 'compact' : ''}`} aria-label="Chapter stages">
    {stages.map(stage => {
      const partial = !stage.done && stage.progress > 0
      const state = stage.done ? 'done' : partial ? 'partial' : 'todo'
      const Icon = stage.done ? Check : partial ? CircleDashed : Circle
      const sourceNote = stage.source === 'evidence' ? 'from your records' : stage.source === 'manual' ? 'marked by you' : stage.source === 'partial' ? 'in progress' : 'not yet'
      return <li key={stage.key} className={`jee-stage jee-stage-${state}`} title={`${stage.label}: ${sourceNote}`}>
        <Icon size={13} aria-hidden="true" />
        <span className="jee-stage-label">{stage.label}</span>
        {stage.key === 'pyqs' && stage.progress > 0 && <small>{Math.round(stage.progress * 100)}%</small>}
        <span className="visually-hidden">{stage.done ? ' complete' : partial ? ' in progress' : ' not started'}, {sourceNote}</span>
      </li>
    })}
  </ol>
}

export function EvidenceNote({ children }: { children: ReactNode }) {
  return <p className="jee-evidence-note">{children}</p>
}

export function Meter({ value, label, tone = 'blue' }: { value: number | null; label: string; tone?: 'blue' | 'green' | 'orange' | 'muted' }) {
  const safe = value === null ? 0 : Math.max(0, Math.min(100, value))
  return <div className={`jee-meter jee-meter-${tone}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(safe)} aria-valuetext={value === null ? 'No data' : `${Math.round(safe)} percent`}>
    <span style={{ width: `${safe}%` }} />
  </div>
}

export function Pct({ value, digits = 0 }: { value: number | null | undefined; digits?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="jee-muted">—</span>
  return <>{value.toFixed(digits)}%</>
}

export function SourceTag({ children, tone = 'muted' }: { children: ReactNode; tone?: string }) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>
}

export function minutesLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—'
  const safe = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safe / 60)
  const mins = safe % 60
  return hours ? `${hours}h ${String(mins).padStart(2, '0')}m` : `${mins}m`
}

/** Parse a whole-number form field. Returns NaN for blank or non-integer input so validation can reject it. */
export function wholeNumber(value: string): number {
  if (value.trim() === '') return Number.NaN
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : Number.NaN
}

export function uuidOrNull(value: string): string | null {
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null
}
