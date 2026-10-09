import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../contexts/AppearanceContext'
import { useData } from '../../contexts/DataContext'
import { stageCounts, syllabusProgress } from '../../shared/lib/jee/progress'
import { CHAPTER_STAGE_KEYS, type ChapterStageKey } from '../../shared/types'
import { NotebookCard, SectionHeading } from '../ui/Surfaces'
import { Meter, Pct } from './shared'

const LABEL: Record<ChapterStageKey, string> = { theory: 'Theory', notes: 'Notes', pyqs: 'PYQs', revised: 'Revised', tested: 'Tested' }

/** How many chapters are at each learning stage, plus raw vs weighted syllabus completion. */
export function LearningPipelineCard() {
  const theme = useTheme()
  const { data } = useData()
  const counts = useMemo(() => stageCounts(data), [data])
  const progress = useMemo(() => syllabusProgress(data.chapters, data.settings), [data.chapters, data.settings])
  const total = data.chapters.length

  return (
    <View accessibilityLabel="Learning pipeline" style={styles.section}>
      <SectionHeading title="Learning pipeline" note="Chapters at each stage. Stages are independent, so counts need not add up to the same chapters." />
      <NotebookCard>
        <View style={styles.counts}>
          {CHAPTER_STAGE_KEYS.map(key => (
            <View key={key} style={[styles.count, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
              <Text style={[theme.type.badge, { color: theme.colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 }]}>{LABEL[key]}</Text>
              <Text style={[theme.type.h3, { color: theme.colors.ink }]}>
                {counts[key]}
                <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{` / ${total}`}</Text>
              </Text>
              <Meter value={total ? (counts[key] / total) * 100 : 0} label={`${LABEL[key]} chapters`} tone={key === 'tested' ? 'green' : 'blue'} />
            </View>
          ))}
        </View>
        <View style={[styles.compare, { borderColor: theme.colors.line }]}>
          <View style={styles.compareItem}>
            <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Raw completion</Text>
            <Text style={[theme.type.h3, { color: theme.colors.ink }]}><Pct value={progress.raw} /></Text>
          </View>
          <View style={styles.compareItem}>
            <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Weighted completion</Text>
            <Text style={[theme.type.h3, { color: theme.colors.ink }]}><Pct value={progress.weighted} /></Text>
          </View>
        </View>
      </NotebookCard>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  count: { width: '48.5%', borderWidth: 1, borderRadius: 12, padding: 10, gap: 6 },
  compare: { marginTop: 14, flexDirection: 'row', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  compareItem: { flex: 1, gap: 2 }
})
