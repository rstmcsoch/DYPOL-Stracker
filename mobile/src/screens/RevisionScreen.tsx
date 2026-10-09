import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/AppearanceContext'
import { indiaDate, indiaToday, plusDays, prettyDate } from '../shared/lib/date'
import { completeRevision } from '../shared/lib/revision-actions'
import type { AppData, Revision } from '../shared/types'
import { AlarmClock, ArrowRight, CalendarClock, Check, CheckCheck, Clock, Sparkles } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Screen } from '../components/ui/Screen'
import { EmptyState, NotebookCard, PageHeader, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'

type Tone = 'overdue' | 'today' | 'tomorrow' | 'upcoming'

/** The revision desk: overdue first, then today, tomorrow, and the upcoming schedule, with a finished-history board. */
export function RevisionScreen() {
  const theme = useTheme()
  const { data, upsert, upsertMany, refresh, syncState } = useData()
  const { notify } = useToast()
  const [showCompleted, setShowCompleted] = useState(false)
  const today = indiaToday()
  const tomorrow = plusDays(today, 1)
  const overdue = useMemo(() => data.revisions.filter(item => !item.completed_at && item.due_on < today).sort((a, b) => a.due_on.localeCompare(b.due_on)), [data.revisions, today])
  const dueToday = useMemo(() => data.revisions.filter(item => !item.completed_at && item.due_on === today), [data.revisions, today])
  const dueTomorrow = useMemo(() => data.revisions.filter(item => !item.completed_at && item.due_on === tomorrow), [data.revisions, tomorrow])
  const upcoming = useMemo(() => data.revisions.filter(item => !item.completed_at && item.due_on > tomorrow).sort((a, b) => a.due_on.localeCompare(b.due_on)), [data.revisions, tomorrow])
  const completed = useMemo(() => data.revisions.filter(item => item.completed_at).sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')).slice(0, 30), [data.revisions])

  const complete = async (revision: Revision) => {
    const chapter = data.chapters.find(item => item.id === revision.chapter_id)
    try {
      const done = await completeRevision(
        revision, chapter,
        records => upsertMany('chapter_revisions', records),
        record => upsert('chapters', record),
        { revisions: data.revisions, gaps: data.settings.revision_gaps, today, now: new Date().toISOString() }
      )
      if (done) notify('Revision done. Your memory just got a little stronger.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not mark revision complete.', 'error')
    }
  }

  const snooze = async (revision: Revision) => {
    try {
      await upsert('chapter_revisions', { ...revision, due_on: plusDays(today, 1), updated_at: new Date().toISOString() })
      notify('Moved to tomorrow. It is still in your queue.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not reschedule revision.', 'error')
    }
  }

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader
        eyebrow="SPACED PRACTICE, BETTER RECALL"
        title="Revision desk"
        subtitle="Small returns, spaced out. Every repeat makes a pathway easier to find."
        action={
          <View style={[styles.pill, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
            <AlarmClock size={16} color={theme.colors.accent} />
            <Text style={[theme.type.label, { color: theme.colors.ink }]}>{overdue.length + dueToday.length}</Text>
            <Text style={[theme.type.caption, { color: theme.colors.muted }]}>need attention</Text>
          </View>
        }
      />
      {overdue.length > 0 ? (
        <RevisionSection title="Overdue" note="Oldest first — one at a time is enough." tone="overdue" icon={<Clock size={17} color={theme.colors.red} />} revisions={overdue} data={data} onComplete={complete} onSnooze={snooze} />
      ) : null}
      <RevisionSection title="Due today" note={dueToday.length ? `${dueToday.length} ready for a quick recall pass.` : 'Nothing due today. Keep progressing.'} tone="today" icon={<CalendarClock size={17} color={theme.colors.green} />} revisions={dueToday} data={data} onComplete={complete} onSnooze={snooze} />
      <RevisionSection title="Tomorrow" note="A little peek at what’s coming." tone="tomorrow" icon={<Sparkles size={17} color={theme.colors.accent} />} revisions={dueTomorrow} data={data} onComplete={complete} onSnooze={snooze} />
      <RevisionSection title="Coming up" note="Scheduled next, so today can stay focused." tone="upcoming" icon={<ArrowRight size={17} color={theme.colors.inkSoft} />} revisions={upcoming} data={data} onComplete={complete} onSnooze={snooze} limit={10} />

      <NotebookCard padding={14} style={styles.completedToggle}>
        <View style={styles.inline}>
          <View style={[styles.stamp, { backgroundColor: theme.colors.greenBg, borderColor: theme.colors.green }]}><CheckCheck size={16} color={theme.colors.green} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[theme.type.label, { color: theme.colors.ink }]}>Recently completed</Text>
            <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{completed.length} revision{completed.length === 1 ? '' : 's'} in your record</Text>
          </View>
        </View>
        <Button variant="secondary" size="sm" onPress={() => setShowCompleted(value => !value)}>{showCompleted ? 'Hide ↑' : 'Show ↓'}</Button>
      </NotebookCard>
      {showCompleted ? (
        <NotebookCard padding={14} style={{ gap: 10 }}>
          {completed.length ? completed.map(revision => <RevisionRow key={revision.id} revision={revision} data={data} completed />) : (
            <EmptyState icon={<CheckCheck size={23} color={theme.colors.muted} />} title="No finished revisions yet." description="The ones you complete will show up here." />
          )}
        </NotebookCard>
      ) : null}
    </Screen>
  )
}

function RevisionSection({ title, note, tone, icon, revisions, data, onComplete, onSnooze, limit }: {
  title: string
  note: string
  tone: Tone
  icon: ReactNode
  revisions: Revision[]
  data: AppData
  onComplete: (revision: Revision) => void
  onSnooze: (revision: Revision) => void
  limit?: number
}) {
  const theme = useTheme()
  const visible = limit ? revisions.slice(0, limit) : revisions
  const empty = title === 'Due today' ? 'Nothing is due today. Keep progressing.' : title === 'Tomorrow' ? 'No revision due tomorrow.' : title === 'Overdue' ? 'You’re all caught up.' : 'No upcoming revisions scheduled.'
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.sectionHead}>
        <View style={[styles.sectionIcon, { backgroundColor: theme.colors.paperSoft, borderColor: theme.colors.line }]}>{icon}</View>
        <View style={{ flex: 1 }}>
          <View style={styles.inline}>
            <Text accessibilityRole="header" style={[theme.type.h3, { color: tone === 'overdue' ? theme.colors.red : theme.colors.ink }]}>{title}</Text>
            <View style={[styles.count, { backgroundColor: theme.colors.paperMuted }]}><Text style={[theme.type.badge, { color: theme.colors.inkSoft }]}>{revisions.length}</Text></View>
          </View>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{note}</Text>
        </View>
      </View>
      <NotebookCard padding={12} accent={tone === 'overdue' ? 'orange' : tone === 'today' ? 'green' : 'plain'}>
        {!visible.length ? (
          <Text style={[theme.type.caption, { color: theme.colors.muted, textAlign: 'center', paddingVertical: 10 }]}>{empty}</Text>
        ) : (
          <View style={{ gap: 10 }}>
            {visible.map(revision => (
              <View key={revision.id} style={{ gap: 8 }}>
                <RevisionRow revision={revision} data={data} overdue={tone === 'overdue'} />
                <View style={styles.buttons}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Move revision to tomorrow" onPress={() => onSnooze(revision)} style={[styles.snooze, { borderColor: theme.colors.line }]}>
                    <Text style={[theme.type.badge, { color: theme.colors.inkSoft }]}>+1d</Text>
                  </Pressable>
                  <Button size="sm" onPress={() => onComplete(revision)} icon={<Check size={14} color={theme.colors.buttonPrimaryInk} />}>Revised</Button>
                </View>
              </View>
            ))}
          </View>
        )}
        {limit && revisions.length > limit ? <Text style={[theme.type.caption, { color: theme.colors.muted, marginTop: 8 }]}>And {revisions.length - limit} more scheduled.</Text> : null}
      </NotebookCard>
    </View>
  )
}

function RevisionRow({ revision, data, overdue = false, completed = false }: { revision: Revision; data: AppData; overdue?: boolean; completed?: boolean }) {
  const theme = useTheme()
  const chapter = data.chapters.find(item => item.id === revision.chapter_id)
  if (!chapter) return null
  const detail = completed
    ? `Completed ${prettyDate(revision.completed_at ? indiaDate(revision.completed_at) : '')}`
    : `Due ${prettyDate(revision.due_on)}`
  return (
    <View style={styles.row}>
      <View style={[styles.mark, { backgroundColor: completed ? theme.colors.greenBg : theme.colors.paperSoft, borderColor: completed ? theme.colors.green : theme.colors.line }]}>
        {completed ? <Check size={15} color={theme.colors.green} /> : <Text style={[theme.type.badge, { color: theme.colors.accent }]}>R{revision.revision_number}</Text>}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[theme.type.label, { color: theme.colors.ink }]}>{chapter.name}</Text>
        <View style={styles.inline}>
          <SubjectBadge subject={chapter.subject} />
          <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{detail}</Text>
          {overdue ? <StatusBadge tone="bad">Overdue</StatusBadge> : null}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  completedToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  stamp: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionIcon: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  count: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10 },
  snooze: { minHeight: 36, minWidth: 48, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }
})
