import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { useData } from '../../contexts/DataContext'
import { useTheme } from '../../contexts/AppearanceContext'
import { indiaToday } from '../../shared/lib/date'
import { recommendStudyNow, type Recommendation, type StudyNowResult } from '../../shared/lib/jee/recommend'
import { ArrowRight, Compass, Flame } from '../icons'
import { Button } from '../ui/Button'
import { NotebookCard, StatusBadge } from '../ui/Surfaces'

export function useStudyNow(): StudyNowResult {
  const { data } = useData()
  const today = indiaToday()
  return useMemo(() => recommendStudyNow(data, today), [data, today])
}

/** The signature recommendation. Reasons are behind "Why this?", and the alternatives are listed below. */
export function StudyNowCard({ compact = false }: { compact?: boolean }) {
  const theme = useTheme()
  const router = useRouter()
  const result = useStudyNow()
  const [showWhy, setShowWhy] = useState(false)
  const primary = result.primary
  return (
    <NotebookCard accent="blue" style={{ gap: 10 }}>
      <View style={styles.top}>
        <View style={styles.inline}>
          <Compass size={15} color={theme.colors.accent} />
          <Text style={[theme.type.overline, { color: theme.colors.accent, fontSize: 11 }]}>PLANNING</Text>
        </View>
        {result.examMode ? <StatusBadge tone="bad"><Flame size={12} color={theme.colors.red} /> Exam Mode{result.examLabel ? ` · ${result.examLabel}` : ''}</StatusBadge> : null}
      </View>
      <Text accessibilityRole="header" style={[theme.type.h2, { color: theme.colors.ink }]}>What should I study now?</Text>
      {primary ? (
        <>
          <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>{primary.summary}</Text>
          <View style={styles.actions}>
            <Button onPress={() => router.navigate(primary.to as Href)} icon={<ArrowRight size={15} color={theme.colors.buttonPrimaryInk} />}>{primary.actionLabel}</Button>
            <Button variant="quiet" size="sm" onPress={() => setShowWhy(value => !value)}>
              {showWhy ? 'Hide reasons' : 'Why this?'}
            </Button>
          </View>
          {showWhy ? <WhyList primary={primary} alternatives={result.alternatives} onOpen={to => router.navigate(to as Href)} /> : null}
          {!compact && result.alternatives.length > 0 && !showWhy ? (
            <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Next up: {result.alternatives.slice(0, 2).map(item => item.title).join(' · ')}</Text>
          ) : null}
        </>
      ) : (
        <Text style={[theme.type.body, { color: theme.colors.muted }]}>{result.emptyReason}</Text>
      )}
    </NotebookCard>
  )
}

function WhyList({ primary, alternatives, onOpen }: { primary: Recommendation; alternatives: Recommendation[]; onOpen: (to: string) => void }) {
  const theme = useTheme()
  return (
    <View style={[styles.why, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
      <Text style={[theme.type.label, { color: theme.colors.ink }]}>Ranked highest because:</Text>
      {primary.reasons.map(reason => (
        <Text key={reason} style={[theme.type.caption, { color: theme.colors.inkSoft }]}>• {reason}</Text>
      ))}
      {alternatives.length > 0 ? (
        <>
          <Text style={[theme.type.label, { color: theme.colors.ink, marginTop: 6 }]}>Also in the running</Text>
          {alternatives.map(item => (
            <Pressable key={item.id} accessibilityRole="button" onPress={() => onOpen(item.to)} style={styles.alt}>
              <Text style={[theme.type.label, { color: theme.colors.ink }]}>{item.title}</Text>
              <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{item.reasons.join('; ') || item.summary}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>Ranking is deterministic: overdue revisions, due backlog, due flashcards, mistakes awaiting retry, weak practice or test chapters, pending PYQs, and mock losses, weighted by chapter importance.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  why: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  alt: { gap: 2, paddingVertical: 6 }
})
