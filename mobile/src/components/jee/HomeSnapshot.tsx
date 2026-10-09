import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { useData } from '../../contexts/DataContext'
import { useTheme } from '../../contexts/AppearanceContext'
import { indiaToday } from '../../shared/lib/date'
import { aggregatePractice, pyqCompletion, syllabusProgress } from '../../shared/lib/jee/progress'
import { currentExamMode, trackReadiness, TRACK_LABEL } from '../../shared/lib/jee/exam'
import { PRIMARY_ACTIVITIES, studyMinutesByActivity, weekRange, type ActivityMinutes } from '../../shared/lib/jee/study-time'
import { computeReminders, isAwake } from '../../shared/lib/jee/reminders'
import { ArrowUpRight, Bell, Clock, ListChecks } from '../icons'
import { NotebookCard } from '../ui/Surfaces'
import { Meter, Pct, minutesLabel } from './shared'

/**
 * Dashboard strip: today's split, the week, raw vs weighted progress, PYQ and practice numbers,
 * the countdown for the active track, and any reminders that apply right now.
 */
export function HomeSnapshot() {
  const theme = useTheme()
  const router = useRouter()
  const { data } = useData()
  const today = indiaToday()
  const todayMinutes = useMemo(() => studyMinutesByActivity(data, today, today), [data, today])
  const week = useMemo(() => studyMinutesByActivity(data, weekRange(today).start, today), [data, today])
  const progress = useMemo(() => syllabusProgress(data.chapters, data.settings), [data.chapters, data.settings])
  const practice = useMemo(() => aggregatePractice(data.practiceSessions), [data.practiceSessions])
  const pyqMain = useMemo(() => pyqCompletion(data.pyqRecords, null, 'Main', data.settings), [data.pyqRecords, data.settings])
  const pyqAdv = useMemo(() => pyqCompletion(data.pyqRecords, null, 'Advanced', data.settings), [data.pyqRecords, data.settings])
  const backlogDue = data.backlogItems.filter(item => isAwake(item, today) && item.due_on !== null && item.due_on <= today).length
  const mode = currentExamMode(data, today)
  const track = trackReadiness(data, data.settings.active_track, today)
  const reminders = computeReminders(data, today)
  const go = (to: string) => router.navigate(to as Href)
  const link = (label: string, to: string) => (
    <Pressable accessibilityRole="link" onPress={() => go(to)} style={styles.linkRow}>
      <Text style={[theme.type.label, { color: theme.colors.accent }]}>{label}</Text>
      <ArrowUpRight size={13} color={theme.colors.accent} />
    </Pressable>
  )
  return (
    <View accessibilityLabel="Study snapshot" style={{ gap: 12 }}>
      <NotebookCard padding={16} style={{ gap: 10 }}>
        <View style={styles.head}>
          <Text style={[theme.type.overline, { color: theme.colors.muted }]}>TODAY</Text>
          {link('Focus', '/focus')}
        </View>
        <SplitRow minutes={todayMinutes} empty="Nothing recorded yet today" />
        <View style={styles.head}>
          <Text style={[theme.type.overline, { color: theme.colors.muted }]}>THIS WEEK</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{minutesLabel(week.total)} total</Text>
        </View>
        <SplitRow minutes={week} compact />
      </NotebookCard>

      <NotebookCard padding={16} style={{ gap: 10 }}>
        <View style={styles.head}>
          <Text style={[theme.type.overline, { color: theme.colors.muted }]}>SYLLABUS</Text>
          {link('Open', '/syllabus')}
        </View>
        <ProgressLine label="Raw completion" value={progress.raw} detail={`${progress.completedChapters}/${progress.totalChapters} chapters`} />
        <ProgressLine label="Weighted completion" value={progress.weighted} detail="by chapter importance" />
        <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>Raw is the plain count. Weighted gives high-importance chapters more say; both stay visible.</Text>
      </NotebookCard>

      <NotebookCard padding={16} style={{ gap: 10 }}>
        <View style={styles.head}>
          <Text style={[theme.type.overline, { color: theme.colors.muted }]}>PRACTICE & PYQs</Text>
          {link('Log', '/practice')}
        </View>
        <View style={styles.stats}>
          <Stat value={practice.attempted.toLocaleString('en-IN')} label="questions" />
          <Stat value={<Pct value={practice.accuracy} />} label="accuracy" />
          <Stat value={<Pct value={pyqMain.percent} />} label="JEE Main PYQs" />
          <Stat value={<Pct value={pyqAdv.percent} />} label="Advanced PYQs" />
        </View>
        <Pressable accessibilityRole="link" onPress={() => go('/backlog')} style={styles.linkRow}>
          <Text style={[theme.type.label, { color: theme.colors.accent }]}>Backlog due: {backlogDue}</Text>
          <ArrowUpRight size={13} color={theme.colors.accent} />
        </Pressable>
      </NotebookCard>

      <NotebookCard padding={16} style={{ gap: 10 }}>
        <View style={styles.head}>
          <Text style={[theme.type.overline, { color: theme.colors.muted }]}>{TRACK_LABEL[data.settings.active_track].toUpperCase()}</Text>
          {link('Exam dates', '/settings')}
        </View>
        <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{mode.active ? mode.reason : 'Exam Mode turns on automatically in the final 30 days. The big countdown lives at the top of Home.'}</Text>
        <ProgressLine label="Track readiness" value={track.percent} detail="weighted syllabus, PYQs and recent tests" />
      </NotebookCard>

      {reminders.length > 0 ? (
        <NotebookCard padding={16} style={{ gap: 8 }}>
          <View style={styles.inline}>
            <Bell size={13} color={theme.colors.muted} />
            <Text style={[theme.type.overline, { color: theme.colors.muted }]}>REMINDERS</Text>
          </View>
          {reminders.map(item => (
            <View key={item.kind} style={styles.reminder}>
              <ListChecks size={14} color={theme.colors.accent} />
              <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}><Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>{item.title}.</Text> {item.body}</Text>
            </View>
          ))}
        </NotebookCard>
      ) : null}
    </View>
  )
}

function SplitRow({ minutes, compact = false, empty }: { minutes: ActivityMinutes; compact?: boolean; empty?: string }) {
  const theme = useTheme()
  if (minutes.total === 0 && empty) return <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{empty}</Text>
  const tint = (activity: string) => (activity === 'Lecture' ? theme.colors.subjectPhysics : activity === 'Practice' ? theme.colors.green : theme.colors.orange)
  return (
    <View style={[styles.split, compact && { gap: 6 }]}>
      {PRIMARY_ACTIVITIES.map(activity => (
        <View key={activity} style={[styles.splitItem, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
          <Clock size={12} color={tint(activity)} />
          <Text style={[theme.type.badge, { color: theme.colors.inkSoft, flex: 1 }]}>{activity}</Text>
          <Text style={[theme.type.badge, { color: theme.colors.ink }]}>{minutesLabel(minutes[activity])}</Text>
        </View>
      ))}
      {!compact && (minutes['Mock/Test'] > 0 || minutes['PYQ practice'] > 0) ? (
        <View style={[styles.splitItem, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
          <Text style={[theme.type.badge, { color: theme.colors.inkSoft, flex: 1 }]}>Mock/Test & PYQ</Text>
          <Text style={[theme.type.badge, { color: theme.colors.ink }]}>{minutesLabel(minutes['Mock/Test'] + minutes['PYQ practice'])}</Text>
        </View>
      ) : null}
    </View>
  )
}

function ProgressLine({ label, value, detail }: { label: string; value: number | null; detail?: string }) {
  const theme = useTheme()
  return (
    <View style={{ gap: 5 }}>
      <View style={styles.head}>
        <Text style={[theme.type.label, { color: theme.colors.inkSoft }]}>{label}</Text>
        <Text style={[theme.type.label, { color: theme.colors.ink }]}><Pct value={value} /></Text>
      </View>
      <Meter value={value} label={label} tone="blue" />
      {detail ? <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{detail}</Text> : null}
    </View>
  )
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  const theme = useTheme()
  return (
    <View style={styles.stat}>
      <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 24, lineHeight: 26 }]}>{value}</Text>
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36 },
  split: { gap: 8 },
  splitItem: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { width: '45%', gap: 2 },
  reminder: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }
})
