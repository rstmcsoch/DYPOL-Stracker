import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../contexts/AppearanceContext'
import { Check, Clock, Flame, NotebookPen, CalendarDays } from '../../components/icons'
import { ProgressBar, ProgressRing } from '../../components/ui/Progress'
import { StatusBadge, SubjectBadge } from '../../components/ui/Surfaces'
import { SYLLABUS } from '../../shared/lib/syllabus'
import type { Subject } from '../../shared/types'

/**
 * A composed notebook page used as the landing hero. It is an illustration, labelled as one: the
 * figures are example values, and the chapter totals come from the seeded syllabus.
 */
const SAMPLE = {
  streakDays: 7,
  done: { Physics: 12, Chemistry: 11, Maths: 13 } as Record<Subject, number>,
  test: { title: 'Rotational Motion · Chapter Test', marks: 41, totalMarks: 60, correct: 11, wrong: 3, skipped: 1 }
}
const SUBJECTS: Subject[] = ['Physics', 'Chemistry', 'Maths']
const TASKS = [
  { title: 'Current Electricity — formulas + PYQs', subject: 'Physics' as Subject, minutes: 45, done: true },
  { title: 'Rotational Motion — 20 problems', subject: 'Physics' as Subject, minutes: 60, done: false },
  { title: 'Equilibrium — NCERT review', subject: 'Chemistry' as Subject, minutes: 40, done: false }
]

export function NotebookPreview() {
  const theme = useTheme()
  const totals = SUBJECTS.map(subject => ({ subject, total: SYLLABUS[subject].length, done: SAMPLE.done[subject] }))
  const chaptersDone = totals.reduce((sum, item) => sum + item.done, 0)
  const chaptersTotal = totals.reduce((sum, item) => sum + item.total, 0)
  const covered = Math.round((chaptersDone / chaptersTotal) * 100)
  const doneTasks = TASKS.filter(task => task.done).length
  const panel = [styles.panel, { borderColor: theme.colors.line, backgroundColor: theme.colors.paper }]
  return (
    <View accessible accessibilityLabel="Illustrative preview of a Stracker notebook page with example figures" style={[styles.sheet, { borderColor: theme.colors.line, backgroundColor: theme.colors.paper }, theme.shadow.float]}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[theme.type.overline, { color: theme.colors.accent, fontSize: 11, lineHeight: 14 }]}>
            <NotebookPen size={12} color={theme.colors.accent} /> ILLUSTRATIVE PREVIEW
          </Text>
          <Text style={[theme.type.h3, { color: theme.colors.ink }]}>Today’s page · example</Text>
        </View>
        <View style={[styles.streak, { backgroundColor: theme.colors.surfaceWarm, borderColor: theme.colors.surfaceWarmBorder }]}>
          <Flame size={13} color={theme.colors.surfaceWarmInk} />
          <Text style={[theme.type.badge, { color: theme.colors.surfaceWarmInk }]}>example · {SAMPLE.streakDays}-day streak</Text>
        </View>
      </View>

      <View style={[...panel, styles.row]}>
        <View style={styles.ringCol}>
          <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>SYLLABUS</Text>
          <ProgressRing value={covered} size={84} label={`${covered}%`} sublabel={`${chaptersDone}/${chaptersTotal}`} />
        </View>
        <View style={{ flex: 1, gap: 9 }}>
          {totals.map(item => (
            <View key={item.subject} style={styles.subjectRow}>
              <SubjectBadge subject={item.subject} />
              <View style={{ flex: 1 }}>
                <ProgressBar value={(item.done / item.total) * 100} color={subjectColor(theme, item.subject)} />
              </View>
              <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{item.done}/{item.total}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={panel}>
        <View style={styles.panelHead}>
          <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>TODAY’S PLAN</Text>
          <View style={styles.inline}>
            <CalendarDays size={13} color={theme.colors.muted} />
            <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{doneTasks} of {TASKS.length} done</Text>
          </View>
        </View>
        {TASKS.map(task => (
          <View key={task.title} style={styles.task}>
            <View style={[styles.check, { borderColor: task.done ? theme.colors.green : theme.colors.lineStrong, backgroundColor: task.done ? theme.colors.greenBg : 'transparent' }]}>
              {task.done ? <Check size={12} strokeWidth={3} color={theme.colors.green} /> : null}
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[theme.type.label, { color: task.done ? theme.colors.muted : theme.colors.ink, textDecorationLine: task.done ? 'line-through' : 'none' }]}>{task.title}</Text>
              <View style={styles.inline}>
                <SubjectBadge subject={task.subject} />
                <Clock size={12} color={theme.colors.muted} />
                <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{task.minutes} min</Text>
              </View>
            </View>
          </View>
        ))}
      </View>

      <View style={panel}>
        <View style={styles.panelHead}>
          <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>LAST TEST · EXAMPLE</Text>
          <StatusBadge tone="muted">CHAPTER TEST</StatusBadge>
        </View>
        <View style={styles.inline}>
          <Text style={[theme.type.metric, { color: theme.colors.ink }]}>{SAMPLE.test.marks}</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted }]}>/ {SAMPLE.test.totalMarks}</Text>
        </View>
        <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{SAMPLE.test.title}</Text>
        <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{SAMPLE.test.correct} correct · {SAMPLE.test.wrong} wrong · {SAMPLE.test.skipped} skipped</Text>
      </View>
    </View>
  )
}

function subjectColor(theme: ReturnType<typeof useTheme>, subject: Subject): string {
  if (subject === 'Physics') return theme.colors.subjectPhysics
  if (subject === 'Chemistry') return theme.colors.subjectChemistry
  return theme.colors.subjectMaths
}

const styles = StyleSheet.create({
  sheet: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  panel: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ringCol: { alignItems: 'center', gap: 4 },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  task: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 2 }
})
