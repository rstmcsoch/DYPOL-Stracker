import { useMemo } from 'react'
import { NotebookCard } from '../ui'
import { indiaToday, prettyDate } from '../../lib/date'
import { computeStreaks, qualifyingDays } from '../../lib/jee/study-time'
import { useData } from '../../contexts/DataContext'
import { T } from '../../lib/student-layout/T'

/**
 * The last 84 days as one square per day.
 *
 * Three states matter to a student: a day that counted, a day taken deliberately as a rest
 * day (or saved with a monthly freeze), and a day that simply has nothing logged. Rest and
 * study days are drawn differently on purpose — the streak is meant to survive real life,
 * and the calendar should say so rather than painting every gap as a failure.
 */
export function StreakCalendar({ weeks = 12 }: { weeks?: number }) {
  const { data } = useData()
  const today = indiaToday()
  const model = useMemo(() => {
    const streak = computeStreaks(data, today)
    const studied = qualifyingDays(data)
    const restDays = new Set(data.settings.streak_rest_days_used ?? [])
    const freezes = new Set(data.settings.streak_freezes_used ?? [])
    const days: { date: string; state: 'studied' | 'rest' | 'freeze' | 'off' }[] = []
    const cursor = new Date(`${today}T12:00:00`)
    cursor.setDate(cursor.getDate() - (weeks * 7 - 1))
    const end = new Date(`${today}T12:00:00`)
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      const state = studied.has(key) ? 'studied' : restDays.has(key) ? 'rest' : freezes.has(key) ? 'freeze' : 'off'
      days.push({ date: key, state })
      cursor.setDate(cursor.getDate() + 1)
    }
    const studiedCount = days.filter(day => day.state === 'studied').length
    return { days, studiedCount, streak }
  }, [data, today, weeks])

  return <NotebookCard className="streak-calendar-card">
    <div className="streak-calendar-head">
      <div>
        <span className="eyebrow"><T k="profile:consistency">{"CONSISTENCY"}</T></span>
        <h2>Last {weeks} weeks</h2>
        <p>{model.studiedCount} study day{model.studiedCount === 1 ? '' : 's'} · {model.streak.current}-day streak · {model.streak.restAvailableToday ? 'rest day available' : model.streak.restingToday ? 'resting today' : 'no rest day left this week'}</p>
      </div>
      <div className="streak-calendar-legend" aria-hidden="true">
        <span><i className="sc-dot sc-studied" /> Studied</span>
        <span><i className="sc-dot sc-rest" /> Rest</span>
        <span><i className="sc-dot sc-freeze" /> Freeze</span>
        <span><i className="sc-dot sc-off" /> Nothing</span>
      </div>
    </div>
    <div className="streak-calendar-grid" role="img" aria-label={`Study calendar for the last ${weeks} weeks: ${model.studiedCount} study days, ${model.streak.current}-day current streak`}>
      {model.days.map(day => <span key={day.date} className={`sc-cell sc-${day.state}`} title={`${prettyDate(day.date)} · ${day.state === 'studied' ? 'studied' : day.state === 'rest' ? 'rest day' : day.state === 'freeze' ? 'freeze' : 'nothing logged'}`} />)}
    </div>
  </NotebookCard>
}
