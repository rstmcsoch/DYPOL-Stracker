import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { CalendarDays, Lightbulb } from '../icons'
import { useTheme } from '../../contexts/AppearanceContext'
import { useData } from '../../contexts/DataContext'
import { indiaToday, prettyDate } from '../../shared/lib/date'
import { buildWeeklyReport } from '../../shared/lib/jee/weekly-report'
import { NotebookCard, SectionHeading, SubjectBadge } from '../ui/Surfaces'
import { minutesLabel } from './shared'

/** "Your week" summary. Comparisons appear only when both weeks have real data for the same subject. */
export function WeeklyReportCard() {
  const theme = useTheme()
  const { data } = useData()
  const today = indiaToday()
  const report = useMemo(() => buildWeeklyReport(data, today), [data, today])

  const tiles: { label: string; value: string }[] = [
    { label: 'Studied', value: minutesLabel(report.studiedMinutes) },
    { label: 'Lecture', value: minutesLabel(report.activity.Lecture) },
    { label: 'Practice', value: minutesLabel(report.activity.Practice) },
    { label: 'Revision', value: minutesLabel(report.activity.Revision) },
    { label: 'Tests', value: String(report.testsLogged) },
    { label: 'Questions', value: report.questionsAttempted.toLocaleString('en-IN') },
    { label: 'Practice accuracy', value: report.practiceAccuracy === null ? '—' : `${report.practiceAccuracy.toFixed(0)}%` },
    { label: 'Active days', value: `${report.activeDays}/7` }
  ]

  return (
    <View accessibilityLabel="Your week" style={styles.section}>
      <SectionHeading title="Your week" note={`${prettyDate(report.range.start)} – ${prettyDate(report.range.end)}`} />
      <NotebookCard>
        <View style={styles.grid}>
          {tiles.map(tile => (
            <View key={tile.label} style={[styles.tile, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]} accessibilityLabel={`${tile.label}: ${tile.value}`}>
              <Text style={[theme.type.badge, styles.tileLabel, { color: theme.colors.muted }]}>{tile.label}</Text>
              <Text style={[theme.type.h3, { color: theme.colors.ink }]}>{tile.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.facts}>
          <View style={styles.factRow}>
            <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Strongest subject</Text>
            {report.strongestSubject ? (
              <View style={styles.inline}>
                <SubjectBadge subject={report.strongestSubject.subject} />
                <Text style={[theme.type.label, { color: theme.colors.ink }]}>{Math.round(report.strongestSubject.value)}%</Text>
              </View>
            ) : (
              <Text style={[theme.type.caption, { color: theme.colors.muted, fontStyle: 'italic' }]}>not enough data yet</Text>
            )}
          </View>
          <View style={styles.factRow}>
            <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Weakest area</Text>
            {report.weakestArea ? (
              <View style={styles.weakest}>
                <Text style={[theme.type.label, { color: theme.colors.ink }]}>{report.weakestArea.name}</Text>
                <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>
                  {report.weakestArea.basis}, {Math.round(report.weakestArea.value)}%
                </Text>
              </View>
            ) : (
              <Text style={[theme.type.caption, { color: theme.colors.muted, fontStyle: 'italic' }]}>not enough data yet</Text>
            )}
          </View>
        </View>

        {report.comparisons.length > 0 ? (
          <View style={styles.compareList}>
            {report.comparisons.map(line => (
              <Text key={line} style={[theme.type.caption, { color: theme.colors.inkSoft }]}>• {line}</Text>
            ))}
          </View>
        ) : (
          <View style={styles.historyRow}>
            <CalendarDays size={13} color={theme.colors.muted} />
            <Text style={[theme.type.caption, { color: theme.colors.muted, flex: 1, fontSize: 12.5 }]}>{report.historyNote}</Text>
          </View>
        )}

        <View style={[styles.action, { borderColor: theme.colors.line, backgroundColor: theme.colors.surfaceTip }]}>
          <Lightbulb size={16} color={theme.colors.surfaceTipInk} />
          <Text style={[theme.type.caption, { color: theme.colors.surfaceTipInk, flex: 1 }]}>
            <Text style={{ fontFamily: theme.fonts.bodyBold }}>Next change: </Text>
            {report.actionable}
          </Text>
        </View>
      </NotebookCard>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '48.5%', borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, gap: 2 },
  tileLabel: { textTransform: 'uppercase', letterSpacing: 0.8 },
  facts: { marginTop: 14, gap: 10 },
  factRow: { gap: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  weakest: { gap: 2 },
  compareList: { marginTop: 12, gap: 4 },
  historyRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  action: { marginTop: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 12, padding: 11 }
})
