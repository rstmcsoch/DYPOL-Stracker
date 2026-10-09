import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Polyline, Rect } from 'react-native-svg'
import { useRouter, type Href } from 'expo-router'
import { ChartLegend, ColumnChart, HeatGrid, HeatLegend, HorizontalBars, RadarChart, TrendChart, type TrendPoint, type TrendSeries } from '../components/charts/Charts'
import { Activity, ArrowUpRight, BarChart3, BookOpen, Check, CircleHelp, Clock3, Pin, PinOff, Plus, Sparkles, Target } from '../components/icons'
import { Button, IconButton } from '../components/ui/Button'
import { Segmented } from '../components/ui/Forms'
import { ProgressBar, ProgressRing } from '../components/ui/Progress'
import { Screen } from '../components/ui/Screen'
import { NotebookCard, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'
import { LearningPipelineCard } from '../components/jee/LearningPipelineCard'
import { WeeklyReportCard } from '../components/jee/WeeklyReportCard'
import { fmtNumber, fmtDuration } from '../shared/lib/format'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/AppearanceContext'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import {
  getAccuracy, getAttemptRate, getChapterPerformance, getMarksTrend, getMistakeCounts,
  getNegativeMarkImpact, getOverallTestAverage, getOverallTestScore, getSubjectPerformance
} from '../shared/lib/analytics'
import { makeStudyBars, makeStudyHeatmap, type StudyTimeView } from '../shared/lib/study-aggregation'
import { SUBJECTS, type Subject } from '../shared/types'
import { shareFile, toCsv } from '../lib/share'
import { loadPinnedCharts, PIN_LIMIT, savePinnedCharts, type ChartId } from '../lib/pinned-charts'
import type { AppTheme } from '../theme/theme'

type AppData = ReturnType<typeof useData>['data']
type TargetComparison = { score: number; gap: number; state: 'below' | 'near' | 'above' }

const CHART_TITLES: Record<ChartId, string> = {
  performance: 'Marks & subjects',
  mistakes: 'Mistake breakdown',
  'study-hours': 'Study hours',
  heatmap: 'Study-day rhythm',
  syllabus: 'Syllabus progress',
  target: 'Mock target'
}

const RANGE_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '6 months' },
  { value: 'all', label: 'All' }
] as const
type RangeValue = (typeof RANGE_OPTIONS)[number]['value']

const HOURS_OPTIONS: { value: StudyTimeView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' }
]

function subjectColor(theme: AppTheme, subject: Subject): string {
  if (subject === 'Physics') return theme.colors.subjectPhysics
  if (subject === 'Chemistry') return theme.colors.subjectChemistry
  return theme.colors.subjectMaths
}

/** Target comparison uses the most recent full mock that has all three subject scores. */
function getTargetComparison(data: AppData): TargetComparison | null {
  const mocks = data.tests.filter(test => test.test_type === 'Full Mock').sort((a, b) => b.test_date.localeCompare(a.test_date))
  for (const test of mocks) {
    const aggregate = getOverallTestScore(test, data.testSubjectScores)
    if (!aggregate) continue
    const gap = data.settings.target_score - aggregate.marks
    const tolerance = Math.max(1, data.settings.target_score * 0.05)
    return { score: aggregate.marks, gap, state: gap <= 0 ? 'above' : gap <= tolerance ? 'near' : 'below' }
  }
  return null
}

/** Latest non-empty value of a trend series, used for the legend. */
function latestValue(rows: { overall: number | null; Physics: number | null; Chemistry: number | null; Maths: number | null }[], key: 'overall' | 'Physics' | 'Chemistry' | 'Maths'): string | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = rows[index]?.[key]
    if (value !== null && value !== undefined) return `${Math.round(value)}%`
  }
  return undefined
}

export function AnalyticsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { data, refresh, syncState } = useData()
  const { user } = useAuth()
  const { notify } = useToast()
  const userKey = user?.id ?? 'session'
  const [pinned, setPinned] = useState<ChartId[]>([])
  const [pinsLoaded, setPinsLoaded] = useState(false)

  useEffect(() => {
    let active = true
    void loadPinnedCharts(userKey).then(saved => {
      if (!active) return
      setPinned(saved)
      setPinsLoaded(true)
    })
    return () => {
      active = false
    }
  }, [userKey])

  const go = (to: string) => router.navigate(to as Href)

  const togglePin = (id: ChartId) => {
    if (!pinsLoaded) return
    if (pinned.includes(id)) {
      const next = pinned.filter(item => item !== id)
      setPinned(next)
      void savePinnedCharts(userKey, next)
      return
    }
    if (pinned.length >= PIN_LIMIT) {
      notify(`You can pin up to ${PIN_LIMIT} charts. Unpin one first — try the pin button on “${CHART_TITLES[pinned[0] ?? id]}”.`, 'error')
      return
    }
    const next = [...pinned, id]
    setPinned(next)
    void savePinnedCharts(userKey, next)
    notify(`${CHART_TITLES[id]} pinned to your favourites.`)
  }

  const trends = useMemo(() => getMarksTrend(data, 5000), [data])
  const subjects = useMemo(() => getSubjectPerformance(data), [data])
  const chapterRows = useMemo(() => getChapterPerformance(data), [data])
  const accuracy = getAccuracy(data)
  const attempt = getAttemptRate(data)
  const negativeMetrics = getNegativeMarkImpact(data)
  const negativeImpact = negativeMetrics.percentage
  const mistakeCounts = getMistakeCounts(data)
  const heatmap = useMemo(() => makeStudyHeatmap(data.sessions, data.settings.daily_study_goal_minutes), [data.sessions, data.settings.daily_study_goal_minutes])
  const totalChapters = data.chapters.length
  const doneChapters = data.chapters.filter(chapter => chapter.status === 'Done' || chapter.status === 'Revised').length
  const overallAverage = getOverallTestAverage(data)
  const targetComparison = useMemo(() => getTargetComparison(data), [data])
  const hasTestScore = trends.some(row => row.overall !== null || row.Physics !== null || row.Chemistry !== null || row.Maths !== null)
  const hasSubjectScores = subjects.some(item => item.average !== null)
  const hasMistakes = mistakeCounts.some(item => item.count > 0)
  const hasSessions = data.sessions.some(session => session.duration_minutes > 0)
  const hasAttemptData = accuracy.rate !== null || attempt.rate !== null || negativeMetrics.totalNegativeMarks > 0 || data.sessions.length > 0
  const totalStudyMinutes = data.sessions.reduce((sum, session) => sum + session.duration_minutes, 0)

  const exportTrendCsv = async () => {
    const rows: (string | number | null)[][] = [
      ['Date', 'Overall %', 'Physics %', 'Chemistry %', 'Maths %'],
      ...trends.map(item => [item.date, item.overall ?? '', item.Physics ?? '', item.Chemistry ?? '', item.Maths ?? ''])
    ]
    try {
      await shareFile({ name: 'stracker-performance.csv', content: toCsv(rows), mimeType: 'text/csv', dialogTitle: 'Share performance trend' })
      notify('Performance trend CSV is ready to share.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The trend could not be exported.', 'error')
    }
  }

  const chartProps: ChartCardProps = {
    data, trends, subjects, mistakeCounts, heatmap, totalChapters, doneChapters, targetComparison,
    hasTestScore, hasSubjectScores, hasMistakes, hasSessions, pinned, onPin: togglePin, go
  }

  const renderCard = (id: ChartId, key?: string): ReactNode => {
    const common = { key: key ?? id, ...chartProps }
    switch (id) {
      case 'performance': return <PerformanceCard {...common} />
      case 'mistakes': return <MistakeCard {...common} />
      case 'study-hours': return <StudyHoursCard {...common} />
      case 'heatmap': return <HeatmapCard {...common} />
      case 'syllabus': return <SyllabusCard {...common} />
      case 'target': return <TargetCard {...common} />
    }
  }

  const metricTiles = [
    {
      key: 'accuracy', icon: <Check size={16} color={theme.colors.green} />, tint: theme.colors.greenBg, label: 'ACCURACY',
      value: accuracy.rate === null ? '—' : `${Math.round(accuracy.rate)}%`,
      note: `${accuracy.correct} correct / ${accuracy.attempted || '—'} attempted`,
      bar: accuracy.rate === null ? null : { value: accuracy.rate, color: theme.colors.green }
    },
    {
      key: 'attempt', icon: <Activity size={16} color={theme.colors.accent} />, tint: theme.colors.blueBg, label: 'ATTEMPT RATE',
      value: attempt.rate === null ? '—' : `${Math.round(attempt.rate)}%`,
      note: `${attempt.attempted} attempted / ${attempt.total || '—'} total questions`,
      bar: attempt.rate === null ? null : { value: attempt.rate, color: theme.colors.accent }
    },
    {
      key: 'negative', icon: <CircleHelp size={16} color={theme.colors.orange} />, tint: theme.colors.orangeBg, label: 'NEGATIVE MARKS',
      value: negativeMetrics.totalNegativeMarks > 0 || data.tests.some(test => test.negative_marks === 0) ? fmtNumber(negativeMetrics.totalNegativeMarks, 1) : '—',
      note: negativeImpact === null
        ? 'No test has both recorded negative marks and a usable total'
        : `${negativeImpact.toFixed(1)}% of totals from ${negativeMetrics.testsIncluded} comparable test${negativeMetrics.testsIncluded === 1 ? '' : 's'}`,
      bar: negativeImpact === null ? null : { value: negativeImpact, color: theme.colors.orange }
    },
    {
      key: 'time', icon: <Clock3 size={16} color={theme.colors.accentDark} />, tint: theme.colors.surfaceCoolAccentBg, label: 'STUDY TIME',
      value: fmtDuration(totalStudyMinutes),
      note: `${data.sessions.filter(item => item.completion_state === 'completed').length} completed focus sessions`,
      bar: null
    }
  ]

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader
        eyebrow="NOT A SCOREBOARD. A COMPASS."
        title="Analytics"
        subtitle="Real patterns from your real work. Nothing here is filled in for you."
        action={
          <Button variant="secondary" size="sm" icon={<BarChart3 size={16} color={theme.colors.ink} />} onPress={() => void exportTrendCsv()}>
            Export trend CSV
          </Button>
        }
      />

      <WeeklyReportCard />
      <LearningPipelineCard />

      <View style={styles.kpiGrid}>
        <KpiTile icon={<Activity size={15} color={theme.colors.muted} />} label="TESTS LOGGED" value={String(data.tests.length)} note={`${overallAverage.count} with usable test results`} />
        <KpiTile
          icon={<BookOpen size={15} color={theme.colors.muted} />}
          label="SYLLABUS"
          value={totalChapters ? `${doneChapters}/${totalChapters}` : '—'}
          note={totalChapters ? `${Math.round((doneChapters / totalChapters) * 100)}% chapters completed` : 'No chapters saved'}
        />
        <KpiTile
          icon={<Clock3 size={15} color={theme.colors.muted} />}
          label="STUDY HOURS"
          value={fmtNumber(totalStudyMinutes / 60, 1)}
          note={`${data.sessions.length} logged focus session${data.sessions.length === 1 ? '' : 's'}`}
        />
        <KpiTile
          icon={<Target size={15} color={theme.colors.muted} />}
          label="TEST AVERAGE"
          value={overallAverage.average === null ? '—' : `${Math.round(overallAverage.average)}%`}
          note={overallAverage.count ? `Mean of ${overallAverage.count} usable test result${overallAverage.count === 1 ? '' : 's'}; one test counts once` : 'Add a scored test to begin'}
        />
      </View>

      {data.tests.length === 0 ? <SamplePreviewCard onAddTest={() => go('/tests?add=1')} /> : null}

      {pinned.length > 0 ? (
        <View style={styles.favourites} accessibilityLabel="Favourite charts">
          <SectionHeading
            title="Favourites"
            note={`Your pinned charts stay at the top. Pin or unpin from any chart’s header — up to ${PIN_LIMIT}.`}
            action={<StatusBadge tone="muted">{`${pinned.length}/${PIN_LIMIT} pinned`}</StatusBadge>}
          />
          {pinned.map(id => renderCard(id, `fav-${id}`))}
        </View>
      ) : null}

      {renderCard('performance')}

      <SectionHeading title="How the attempts are landing" note="Every calculation is based only on the fields you’ve filled in." />
      {hasAttemptData ? (
        <View style={styles.metricGrid}>
          {metricTiles.map(tile => (
            <NotebookCard key={tile.key} style={styles.metricCard}>
              <View style={styles.metricHead}>
                <View style={[styles.metricIcon, { backgroundColor: tile.tint }]}>{tile.icon}</View>
                <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>{tile.label}</Text>
              </View>
              <Text style={[theme.type.metric, { color: theme.colors.ink }]}>{tile.value}</Text>
              <Text style={[theme.type.caption, { color: theme.colors.inkSoft, fontSize: 13 }]}>{tile.note}</Text>
              {tile.bar ? <ProgressBar value={tile.bar.value} color={tile.bar.color} /> : null}
              {tile.key === 'time' ? (
                <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>No sessions? Start the timer in Focus mode.</Text>
              ) : null}
            </NotebookCard>
          ))}
        </View>
      ) : (
        <NotebookCard style={styles.chart}>
          <NoDataLine label="Attempt metrics" hint="Log correct/wrong counts with a test, or run a focus session." />
        </NotebookCard>
      )}

      {renderCard('mistakes')}
      {renderCard('study-hours')}
      {renderCard('heatmap')}
      {renderCard('syllabus')}
      {renderCard('target')}

      <NotebookCard style={styles.insight}>
        <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>CHAPTER SIGNALS</Text>
        <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>
          <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>{chapterRows.filter(item => item.classification === 'Untested').length}</Text> untested ·{' '}
          <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>{chapterRows.filter(item => item.classification === 'Weak').length}</Text> weak ·{' '}
          <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>{chapterRows.filter(item => item.dropping).length}</Text> dropping
        </Text>
        <Button variant="quiet" size="sm" icon={<ArrowUpRight size={15} color={theme.colors.ink} />} onPress={() => go('/weak-areas')}>
          See weak areas
        </Button>
      </NotebookCard>
    </Screen>
  )
}

interface ChartCardProps {
  data: AppData
  trends: ReturnType<typeof getMarksTrend>
  subjects: ReturnType<typeof getSubjectPerformance>
  mistakeCounts: ReturnType<typeof getMistakeCounts>
  heatmap: ReturnType<typeof makeStudyHeatmap>
  totalChapters: number
  doneChapters: number
  targetComparison: TargetComparison | null
  hasTestScore: boolean
  hasSubjectScores: boolean
  hasMistakes: boolean
  hasSessions: boolean
  pinned: ChartId[]
  onPin: (id: ChartId) => void
  go: (to: string) => void
}

/** Shared frame for every chart: eyebrow, title, description, optional controls, and the pin toggle. */
function ChartShell({ eyebrow, title, description, controls, pin, flat = false, children }: {
  eyebrow: string
  title: string
  description: string
  controls?: ReactNode
  pin?: { id: ChartId; pinned: boolean; onPin: (id: ChartId) => void }
  flat?: boolean
  children: ReactNode
}) {
  const theme = useTheme()
  return (
    <NotebookCard style={[styles.chart, flat ? { borderStyle: 'dashed' } : null]}>
      <View style={styles.chartHead}>
        <View style={styles.chartHeadText}>
          {eyebrow ? <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>{eyebrow}</Text> : null}
          {title ? <Text accessibilityRole="header" style={[theme.type.h3, { color: theme.colors.ink }]}>{title}</Text> : null}
          {description ? <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{description}</Text> : null}
        </View>
        {controls || pin ? (
          <View style={styles.chartActions}>
            {controls}
            {pin ? <PinButton id={pin.id} pinned={pin.pinned} onPin={pin.onPin} /> : null}
          </View>
        ) : null}
      </View>
      {children}
    </NotebookCard>
  )
}

function PinButton({ id, pinned, onPin }: { id: ChartId; pinned: boolean; onPin: (id: ChartId) => void }) {
  const theme = useTheme()
  const title = CHART_TITLES[id]
  return (
    <IconButton
      label={pinned ? `Unpin ${title} from favourites` : `Pin ${title} to favourites (up to ${PIN_LIMIT})`}
      onPress={() => onPin(id)}
      active={pinned}
    >
      {pinned ? <PinOff size={16} color={theme.colors.accent} /> : <Pin size={16} color={theme.colors.muted} />}
    </IconButton>
  )
}

/** A compact, honest empty state: says what is missing and how to add it. */
function NoDataLine({ label, hint, action }: { label: string; hint?: string; action?: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={styles.emptyLine} accessibilityLabel={`${label}: no data yet`}>
      <Text style={[theme.type.label, { color: theme.colors.inkSoft }]}>{label} — No data yet</Text>
      {hint ? <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>{hint}</Text> : null}
      {action}
    </View>
  )
}

function KpiTile({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
  const theme = useTheme()
  return (
    <NotebookCard style={styles.kpi} padding={14}>
      <View style={styles.kpiHead}>
        {icon}
        <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 10.5 }]}>{label}</Text>
      </View>
      <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 28, lineHeight: 30 }]}>{value}</Text>
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{note}</Text>
    </NotebookCard>
  )
}

/** Teaches what the page will show. It is labelled as an example and is decorative only; it carries no values. */
function SamplePreviewCard({ onAddTest }: { onAddTest: () => void }) {
  const theme = useTheme()
  return (
    <NotebookCard style={styles.preview}>
      <View style={styles.previewChip}>
        <Sparkles size={13} color={theme.colors.surfaceTipInk} />
        <Text style={[theme.type.badge, { color: theme.colors.surfaceTipInk }]}>EXAMPLE · NOT YOUR DATA</Text>
      </View>
      <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>WHAT 3 TESTS UNLOCK</Text>
      <View style={styles.previewBody}>
        <View style={{ flex: 1, gap: 10 }}>
          <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>
            After <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>3 tests</Text>, you’ll see your marks trend, subject balance, weak areas, and performance patterns here — built only from what you actually log.
          </Text>
          <Button variant="secondary" size="sm" icon={<Plus size={15} color={theme.colors.ink} />} onPress={onAddTest}>
            Log your first test
          </Button>
        </View>
        <Svg width={110} height={92} viewBox="0 0 240 104" accessible={false}>
          <Polyline points="6,86 52,70 98,76 144,52 190,44 234,18" fill="none" stroke={theme.colors.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          {[[52, 70], [98, 76], [144, 52], [190, 44]].map(([cx, cy]) => <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3.5} fill={theme.colors.accent} />)}
          <Rect x={10} y={58} width={16} height={40} rx={4} fill={theme.colors.subjectPhysics} opacity={0.55} />
          <Rect x={34} y={44} width={16} height={54} rx={4} fill={theme.colors.subjectChemistry} opacity={0.55} />
          <Rect x={58} y={66} width={16} height={32} rx={4} fill={theme.colors.subjectMaths} opacity={0.55} />
        </Svg>
      </View>
    </NotebookCard>
  )
}

function PerformanceCard({ data, subjects, hasTestScore, hasSubjectScores, pinned, onPin }: ChartCardProps) {
  const theme = useTheme()
  const [range, setRange] = useState<RangeValue>('90')
  const rangedTrends = useMemo(() => getMarksTrend(data, range === 'all' ? 5000 : Number(range)), [data, range])
  const nothingAtAll = !hasTestScore && !hasSubjectScores
  const points: TrendPoint[] = useMemo(
    () => rangedTrends.map(row => ({ date: row.date, values: { overall: row.overall, Physics: row.Physics, Chemistry: row.Chemistry, Maths: row.Maths } })),
    [rangedTrends]
  )
  const series: TrendSeries[] = [
    { key: 'overall', color: theme.colors.accent, dashed: true, strokeWidth: 2.5 },
    { key: 'Physics', color: theme.colors.subjectPhysics },
    { key: 'Chemistry', color: theme.colors.subjectChemistry },
    { key: 'Maths', color: theme.colors.subjectMaths }
  ]
  const rangedHasScore = rangedTrends.some(row => row.overall !== null || row.Physics !== null || row.Chemistry !== null || row.Maths !== null)

  return (
    <ChartShell
      eyebrow="PERCENTAGE, NOT RAW MARKS"
      title={CHART_TITLES.performance}
      description="The trend of your comparable results, with the subject balance beside it."
      pin={{ id: 'performance', pinned: pinned.includes('performance'), onPin }}
      flat={nothingAtAll}
    >
      {nothingAtAll ? (
        <NoDataLine label="Marks & subjects" hint="Log a test with marks and a total to start the trend." />
      ) : (
        <>
          {hasTestScore ? (
            <View style={styles.chartBody}>
              <Segmented<RangeValue> label="Marks trend range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
              {rangedHasScore ? (
                <>
                  <TrendChart points={points} series={series} height={260} />
                  <ChartLegend
                    items={[
                      { label: 'Overall', color: theme.colors.accent, dashed: true, value: latestValue(rangedTrends, 'overall') },
                      ...SUBJECTS.map(subject => ({
                        label: subject,
                        color: subjectColor(theme, subject),
                        value: latestValue(rangedTrends, subject)
                      }))
                    ]}
                  />
                </>
              ) : (
                <NoDataLine label="Marks trend" hint="No comparable test result in this range yet." />
              )}
            </View>
          ) : (
            <NoDataLine label="Marks trend" hint="No comparable test result in this range yet." />
          )}

          <View style={styles.subjectBlock}>
            {hasSubjectScores ? (
              <>
                <RadarChart axes={subjects.map(item => ({ label: item.subject, value: item.average }))} height={220} color={theme.colors.accent} />
                <View style={styles.subjectList}>
                  {subjects.map(item => (
                    <View key={item.subject} style={styles.subjectRow}>
                      <SubjectBadge subject={item.subject} />
                      <Text style={[theme.type.h3, { color: theme.colors.ink, fontSize: 18 }]}>{item.average === null ? '—' : `${Math.round(item.average)}%`}</Text>
                      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{`${item.count} result${item.count === 1 ? '' : 's'}`}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <NoDataLine label="Subject balance" hint="Add scores to any subject test or mock to compare subjects." />
            )}
          </View>
        </>
      )}
    </ChartShell>
  )
}

function MistakeCard({ mistakeCounts, hasMistakes, pinned, onPin, go }: ChartCardProps) {
  const theme = useTheme()
  return (
    <ChartShell
      eyebrow="NOTICE THE REPEATS"
      title={CHART_TITLES.mistakes}
      description="Only entries saved in your notebook appear here."
      controls={<Button variant="quiet" size="sm" onPress={() => go('/mistakes')}>Open notebook</Button>}
      pin={{ id: 'mistakes', pinned: pinned.includes('mistakes'), onPin }}
      flat={!hasMistakes}
    >
      {hasMistakes ? (
        <HorizontalBars items={mistakeCounts.map(item => ({ key: item.type, label: item.type, value: item.count, color: theme.colors.accent }))} />
      ) : (
        <NoDataLine label="Mistake breakdown" hint="A few honest notes in the mistake notebook make this useful." />
      )}
    </ChartShell>
  )
}

function StudyHoursCard({ data, hasSessions, pinned, onPin }: ChartCardProps) {
  const theme = useTheme()
  const [view, setView] = useState<StudyTimeView>('day')
  const bars = useMemo(() => makeStudyBars(data.sessions, view), [data.sessions, view])
  return (
    <ChartShell
      eyebrow="SHOWING UP COUNTS"
      title={CHART_TITLES['study-hours']}
      description="Logged focus sessions only."
      controls={<Segmented<StudyTimeView> label="Study hours grouping" options={HOURS_OPTIONS} value={view} onChange={setView} />}
      pin={{ id: 'study-hours', pinned: pinned.includes('study-hours'), onPin }}
      flat={!hasSessions}
    >
      {hasSessions ? (
        <ColumnChart
          items={bars.map(bar => ({ key: bar.date, label: bar.label, value: bar.hours, color: theme.colors.accent, valueText: fmtNumber(bar.hours, 1) }))}
          height={240}
        />
      ) : (
        <NoDataLine label="Study hours" hint="Complete a focus block to see your study hours here." />
      )}
    </ChartShell>
  )
}

function HeatmapCard({ heatmap, hasSessions, pinned, onPin }: ChartCardProps) {
  const theme = useTheme()
  return (
    <ChartShell
      eyebrow="A CALENDAR OF SHOWING UP"
      title={CHART_TITLES.heatmap}
      description="Day intensity is compared with your current daily study goal."
      controls={<HeatLegend />}
      pin={{ id: 'heatmap', pinned: pinned.includes('heatmap'), onPin }}
      flat={!hasSessions}
    >
      {hasSessions ? (
        <>
          <HeatGrid cells={heatmap.cells} months={heatmap.months} />
          <View style={styles.heatFoot}>
            <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>
              {`${heatmap.daysLogged} study day${heatmap.daysLogged === 1 ? '' : 's'} shown`}
            </Text>
            <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>Consistency over intensity.</Text>
          </View>
        </>
      ) : (
        <NoDataLine label="Study-day rhythm" hint="Complete a focus block to light up your first day." />
      )}
    </ChartShell>
  )
}

function SyllabusCard({ data, totalChapters, doneChapters, pinned, onPin }: ChartCardProps) {
  const theme = useTheme()
  const percent = totalChapters ? Math.round((doneChapters / totalChapters) * 100) : 0
  return (
    <ChartShell
      eyebrow="CHAPTERS MOVING FORWARD"
      title={CHART_TITLES.syllabus}
      description={`${doneChapters} done or revised of ${totalChapters} recorded chapters.`}
      controls={<ProgressRing value={totalChapters ? (doneChapters / totalChapters) * 100 : 0} size={72} label={`${percent}%`} sublabel="done" />}
      pin={{ id: 'syllabus', pinned: pinned.includes('syllabus'), onPin }}
      flat={!totalChapters}
    >
      {totalChapters ? (
        <View style={styles.syllabusList}>
          {SUBJECTS.map(subject => {
            const chapters = data.chapters.filter(item => item.subject === subject)
            const done = chapters.filter(item => item.status === 'Done' || item.status === 'Revised').length
            return (
              <View key={subject} style={styles.syllabusRow}>
                <View style={styles.syllabusHead}>
                  <SubjectBadge subject={subject} />
                  <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{`${done} / ${chapters.length} chapters`}</Text>
                </View>
                <ProgressBar value={chapters.length ? (done / chapters.length) * 100 : 0} color={subjectColor(theme, subject)} />
              </View>
            )
          })}
        </View>
      ) : (
        <NoDataLine label="Syllabus progress" hint="Chapters appear here as soon as your syllabus has rows." />
      )}
    </ChartShell>
  )
}

function TargetCard({ data, targetComparison, pinned, onPin }: ChartCardProps) {
  const theme = useTheme()
  const stateTone = targetComparison?.state === 'above' ? 'good' : targetComparison?.state === 'near' ? 'warn' : 'bad'
  const glyph = targetComparison?.state === 'above' ? '↑' : targetComparison?.state === 'near' ? '≈' : '↓'
  const stateLabel = targetComparison?.state === 'above' ? 'Above target' : targetComparison?.state === 'near' ? 'Near target' : 'Below target'
  const gapLabel = targetComparison
    ? targetComparison.gap > 0 ? `${fmtNumber(targetComparison.gap, 1)} to go` : `${fmtNumber(Math.abs(targetComparison.gap), 1)} ahead`
    : ''
  return (
    <ChartShell
      eyebrow="A TARGET, NOT A VERDICT"
      title={CHART_TITLES.target}
      description="New mocks need all three subject scores; valid saved legacy totals remain comparable."
      controls={<Target size={20} color={theme.colors.muted} />}
      pin={{ id: 'target', pinned: pinned.includes('target'), onPin }}
      flat={!targetComparison}
    >
      {targetComparison ? (
        <View style={styles.targetRow}>
          <View style={styles.targetFigure}>
            <Text style={[theme.type.metric, { color: theme.colors.ink }]}>{fmtNumber(targetComparison.score, 1)}</Text>
            <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>latest mock marks</Text>
          </View>
          <Text style={[theme.type.h2, { color: theme.colors.accent }]}>{glyph}</Text>
          <View style={styles.targetFigure}>
            <Text style={[theme.type.metric, { color: theme.colors.ink }]}>{fmtNumber(data.settings.target_score)}</Text>
            <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>target score</Text>
          </View>
          <StatusBadge tone={stateTone}>{`${stateLabel} · ${gapLabel}`}</StatusBadge>
        </View>
      ) : (
        <NoDataLine label="Mock target" hint="Add all three subject scores on a full mock to compare it with your target." />
      )}
    </ChartShell>
  )
}

const styles = StyleSheet.create({
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: { width: '48.5%', gap: 4 },
  kpiHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  preview: { gap: 10 },
  previewChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4 },
  previewBody: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  favourites: { gap: 12 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { width: '48.5%', gap: 6 },
  metricHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricIcon: { width: 28, height: 28, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  insight: { gap: 8 },
  chart: { gap: 12 },
  chartHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  chartHeadText: { flex: 1, gap: 3 },
  chartActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  chartBody: { gap: 12 },
  subjectBlock: { gap: 12 },
  subjectList: { gap: 10 },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyLine: { gap: 4, paddingVertical: 6 },
  heatFoot: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 },
  syllabusList: { gap: 12 },
  syllabusRow: { gap: 6 },
  syllabusHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  targetRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14 },
  targetFigure: { gap: 2 }
})

