import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useData } from '../contexts/DataContext'
import { useTheme } from '../contexts/AppearanceContext'
import { indiaToday } from '../shared/lib/date'
import { allTrackReadiness, countdownLabel, currentExamMode, TRACK_LABEL } from '../shared/lib/jee/exam'
import { computeReminders, REMINDER_LABEL } from '../shared/lib/jee/reminders'
import { Settings2 } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Screen } from '../components/ui/Screen'
import { NotebookCard, PageHeader, SectionHeading, StatusBadge } from '../components/ui/Surfaces'
import { StudyNowCard } from '../components/jee/StudyNowCard'
import { Meter, Pct } from '../components/jee/shared'

/** The full "what should I study now" page: the recommendation, Exam Mode, track readiness, and live reminders. */
export function StudyNowScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { data, refresh, syncState } = useData()
  const today = indiaToday()
  const mode = currentExamMode(data, today)
  const tracks = allTrackReadiness(data, today)
  const reminders = computeReminders(data, today)
  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader eyebrow="ONE DECISION AT A TIME" title="Study now" subtitle="The most urgent item across revisions, backlog, flashcards, practice, PYQs, weak chapters and mock losses — and exactly why." />
      <StudyNowCard />

      <SectionHeading title="Exam Mode" note={mode.reason} action={<Button variant="secondary" size="sm" onPress={() => router.navigate('/settings' as never)} icon={<Settings2 size={15} color={theme.colors.ink} />}>Exam settings</Button>} />
      <NotebookCard padding={14} style={{ gap: 8 }}>
        <View style={styles.row}>
          <StatusBadge tone={mode.active ? 'bad' : 'muted'}>{mode.active ? 'On' : 'Off'}</StatusBadge>
          <Text style={[theme.type.label, { color: theme.colors.ink }]}>{mode.label ?? 'No active track'}</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{countdownLabel(mode.daysLeft)}</Text>
        </View>
        {mode.active ? <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>While Exam Mode is on, revision, PYQs, mocks, flashcards and weak-area fixes are weighted up. New theory is not suggested, and backlog only surfaces when it is due or high priority.</Text> : null}
      </NotebookCard>

      <SectionHeading title="Track readiness" note="One shared syllabus. Each track is measured against its own exam’s PYQs." />
      <View style={{ gap: 10 }}>
        {tracks.map(track => (
          <NotebookCard key={track.track} padding={14} style={{ gap: 8 }}>
            <View style={styles.row}>
              <Text style={[theme.type.label, { color: theme.colors.ink, flex: 1 }]}>{TRACK_LABEL[track.track]}</Text>
              <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{countdownLabel(track.daysLeft)}</Text>
            </View>
            <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 30, lineHeight: 32 }]}><Pct value={track.percent} /></Text>
            <Meter value={track.percent} label={`${TRACK_LABEL[track.track]} readiness`} tone={track.track === 'boards' ? 'green' : 'blue'} />
            {track.components.map(part => (
              <View key={part.label} style={styles.part}>
                <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}>{part.label}</Text>
                <Text style={[theme.type.badge, { color: theme.colors.ink }]}><Pct value={part.value} /></Text>
                <Text style={[theme.type.badge, { color: theme.colors.muted, flexShrink: 1 }]}>{part.note}</Text>
              </View>
            ))}
          </NotebookCard>
        ))}
      </View>

      {reminders.length > 0 ? (
        <>
          <SectionHeading title="Reminders right now" note="Turn types on or off in Settings → Study rhythm." />
          <NotebookCard padding={14} style={{ gap: 10 }}>
            {reminders.map(item => (
              <View key={item.kind} style={styles.reminder}>
                <StatusBadge tone="info">{REMINDER_LABEL[item.kind]}</StatusBadge>
                <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}><Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>{item.title}.</Text> {item.body}</Text>
              </View>
            ))}
          </NotebookCard>
        </>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  part: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  reminder: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }
})
