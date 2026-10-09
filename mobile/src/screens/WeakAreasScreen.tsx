import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { useData } from '../contexts/DataContext'
import { useTheme } from '../contexts/AppearanceContext'
import { getChapterPerformance } from '../shared/lib/analytics'
import { practiceByChapter, PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL, type PracticeAggregate } from '../shared/lib/jee/progress'
import { SUBJECTS, type Chapter, type Subject } from '../shared/types'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, Minus, Plus, Target, TrendingDown, TrendingUp, TriangleAlert } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Screen } from '../components/ui/Screen'
import { SelectField } from '../components/ui/Forms'
import { EmptyState, NotebookCard, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'
import { Meter, Pct } from '../components/jee/shared'

const MOBILE_VISIBLE_LIMIT = 8

/** Chapter bands: weak, okay, and strong, from the active thresholds. Untested stays unclassified. */
export function WeakAreasScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { data, refresh, syncState } = useData()
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [showAllTested, setShowAllTested] = useState(false)
  const [showUntested, setShowUntested] = useState(false)
  const performance = useMemo(() => getChapterPerformance(data), [data])
  const chapters = performance.filter(item => subject === 'all' || item.chapter.subject === subject)
  const untested = chapters.filter(item => item.classification === 'Untested').sort((a, b) => a.chapter.subject.localeCompare(b.chapter.subject) || a.chapter.position - b.chapter.position)
  const tested = chapters.filter(item => item.classification !== 'Untested').sort((a, b) => Number(b.dropping) - Number(a.dropping) || (a.average ?? 100) - (b.average ?? 100))
  const weak = tested.filter(item => item.classification === 'Weak')
  const strong = tested.filter(item => item.classification === 'Strong')
  const dropCount = tested.filter(item => item.dropping).length
  const practice = useMemo(() => practiceByChapter(data), [data])
  // Practice is a second, independent signal: low accuracy on a meaningful number of questions, or many misses.
  const practiceWeak = data.chapters
    .filter(chapter => subject === 'all' || chapter.subject === subject)
    .map(chapter => ({ chapter, agg: practice.get(chapter.id) }))
    .filter((item): item is { chapter: Chapter; agg: PracticeAggregate } => Boolean(item.agg))
    .filter(item => item.agg.attempted >= PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL && item.agg.accuracy !== null && (item.agg.accuracy < data.settings.weak_threshold || item.agg.incorrect >= 40))
    .sort((a, b) => (a.agg.accuracy ?? 0) - (b.agg.accuracy ?? 0))
  const visibleTested = showAllTested ? tested : tested.slice(0, MOBILE_VISIBLE_LIMIT)
  const go = (to: string) => router.navigate(to as Href)

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader eyebrow="SCORE THE CHAPTER, NOT THE FEELING" title="Weak areas" subtitle="Chapter averages use the last three usable results. Untested stays unclassified." />
      <SelectField<'all' | Subject>
        label="Subject"
        value={subject}
        options={[{ value: 'all', label: 'All subjects' }, ...SUBJECTS.map(item => ({ value: item, label: item }))]}
        onChange={value => { setSubject(value); setShowAllTested(false); setShowUntested(false) }}
      />
      <View style={[styles.band, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
        <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>
          Current bands: <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>Weak &lt; {data.settings.weak_threshold}%</Text> · <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>Okay {data.settings.weak_threshold}–{data.settings.strong_threshold}%</Text> · <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>Strong &gt; {data.settings.strong_threshold}%</Text>
        </Text>
      </View>

      <View style={styles.grid}>
        <OverviewTile icon={<TriangleAlert size={17} color={theme.colors.red} />} kicker="NEEDS ANOTHER LOOK" value={weak.length} note={`chapter${weak.length === 1 ? '' : 's'} below the weak-area threshold`} />
        <OverviewTile icon={<TrendingDown size={17} color={theme.colors.orange} />} kicker="DROPPING" value={dropCount} note={`latest result fell by ${data.settings.dropping_threshold} points or more`} />
        <OverviewTile icon={<Target size={17} color={theme.colors.muted} />} kicker="NO BASELINE YET" value={untested.length} note="untested · not classified as weak" />
        <OverviewTile icon={<TrendingUp size={17} color={theme.colors.green} />} kicker="FEELING STEADY" value={strong.length} note={`chapter${strong.length === 1 ? '' : 's'} at or above the strong threshold`} />
      </View>

      {practiceWeak.length > 0 ? (
        <>
          <SectionHeading title="Practice is flagging these" note="From your DPP and module log. Needs 20+ questions per chapter." />
          <NotebookCard padding={14} style={{ gap: 12 }}>
            {practiceWeak.map(({ chapter, agg }) => (
              <View key={chapter.id} style={{ gap: 6 }}>
                <Text style={[theme.type.label, { color: theme.colors.ink }]}>{chapter.name}</Text>
                <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{agg.attempted} questions · {agg.incorrect} incorrect · recent <Pct value={agg.recentAccuracy} /></Text>
                <View style={styles.inline}>
                  <View style={{ flex: 1 }}><Meter value={agg.accuracy} label={`${chapter.name} practice accuracy`} tone="orange" /></View>
                  <Text style={[theme.type.label, { color: theme.colors.ink }]}><Pct value={agg.accuracy} /></Text>
                </View>
                <Pressable accessibilityRole="link" onPress={() => go(`/practice?chapter=${chapter.id}&add=1`)} style={styles.link}>
                  <Text style={[theme.type.label, { color: theme.colors.accent }]}>Log practice</Text>
                  <ArrowUpRight size={13} color={theme.colors.accent} />
                </Pressable>
              </View>
            ))}
          </NotebookCard>
        </>
      ) : null}

      {dropCount > 0 ? (
        <NotebookCard padding={14} accent="orange" style={{ gap: 6 }}>
          <View style={styles.inline}>
            <ArrowDownRight size={18} color={theme.colors.orange} />
            <Text style={[theme.type.label, { color: theme.colors.ink }]}>A dip worth checking</Text>
          </View>
          <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>
            {tested.filter(item => item.dropping).map(item => `${item.chapter.name} (${Math.round(item.results[1]?.percentage ?? 0)}% → ${Math.round(item.latest ?? 0)}%)`).join(' · ')}
          </Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Compare the paper, not just the score.</Text>
        </NotebookCard>
      ) : null}

      <SectionHeading title="Tested chapters" note={`${tested.length} chapter${tested.length === 1 ? '' : 's'} with usable scores`} />
      {tested.length === 0 ? (
        <NotebookCard>
          <EmptyState icon={<Target size={24} color={theme.colors.muted} />} title="No usable chapter results yet." description="Log a test with a chapter, marks and total. Untested topics will stay in their own list until then." action={<Button variant="secondary" size="sm" onPress={() => go('/tests?add=1')} icon={<Plus size={15} color={theme.colors.ink} />}>Add a chapter test</Button>} />
        </NotebookCard>
      ) : (
        <View style={{ gap: 10 }}>
          {visibleTested.map(item => {
            const TrendIcon = item.trend === 'up' ? TrendingUp : item.trend === 'down' ? TrendingDown : item.trend === 'steady' ? Minus : Target
            return (
              <NotebookCard key={item.chapter.id} padding={14} accent={item.dropping ? 'orange' : 'plain'} style={{ gap: 8 }}>
                <Pressable accessibilityRole="link" onPress={() => go('/syllabus')} style={{ gap: 3 }}>
                  <Text style={[theme.type.label, { color: theme.colors.ink }]}>{item.chapter.name}</Text>
                  <View style={styles.inline}>
                    <SubjectBadge subject={item.chapter.subject} />
                    <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{item.results.length} test{item.results.length === 1 ? '' : 's'} used</Text>
                  </View>
                </Pressable>
                <View style={styles.inline}>
                  {[...item.results].reverse().map(result => (
                    <View key={result.test.id} accessibilityLabel={`${result.test.title}: ${Math.round(result.percentage)}%`} style={[styles.score, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
                      <Text style={[theme.type.badge, { color: theme.colors.inkSoft }]}>{Math.round(result.percentage)}%</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.statRow}>
                  <Stat label="Average" value={`${Math.round(item.average ?? 0)}%`} />
                  <Stat label="Latest" value={`${Math.round(item.latest ?? 0)}%`} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>Trend</Text>
                    <View style={styles.inline}>
                      <TrendIcon size={14} color={theme.colors.inkSoft} />
                      <Text style={[theme.type.badge, { color: theme.colors.inkSoft }]}>{item.trend === 'none' ? '—' : item.trend}</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.inline}>
                  {item.dropping ? <StatusBadge tone="bad">Dropping</StatusBadge> : null}
                  <StatusBadge tone={item.classification === 'Weak' ? 'bad' : item.classification === 'Okay' ? 'warn' : item.classification === 'Strong' ? 'good' : 'muted'}>{item.classification}</StatusBadge>
                </View>
              </NotebookCard>
            )
          })}
          {tested.length > MOBILE_VISIBLE_LIMIT ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAllTested }} onPress={() => setShowAllTested(value => !value)} style={styles.toggle}>
              {showAllTested ? <ChevronUp size={15} color={theme.colors.accent} /> : <ChevronDown size={15} color={theme.colors.accent} />}
              <Text style={[theme.type.label, { color: theme.colors.accent }]}>{showAllTested ? 'Show fewer tested chapters' : `Show all ${tested.length} tested chapters`}</Text>
            </Pressable>
          ) : null}
          <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Chapter score = mean of the latest three usable chapter results. Percentages normalize different test totals.</Text>
        </View>
      )}

      <SectionHeading title="Untested chapters" note="A baseline is missing — not a reason to assume weakness." action={<StatusBadge tone="muted">{untested.length} untested</StatusBadge>} />
      {untested.length === 0 ? (
        <NotebookCard><EmptyState icon={<Target size={23} color={theme.colors.muted} />} title="Every chapter has a recorded result." description="Keep adding real chapter-level scores as you practice." /></NotebookCard>
      ) : (
        <NotebookCard padding={14} style={{ gap: 10 }}>
          <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>These chapters have no usable score yet. They are not classified as weak — give one a first test to start its baseline.</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showUntested }} onPress={() => setShowUntested(value => !value)} style={styles.toggle}>
            {showUntested ? <ChevronUp size={15} color={theme.colors.accent} /> : <ChevronDown size={15} color={theme.colors.accent} />}
            <Text style={[theme.type.label, { color: theme.colors.accent }]}>{showUntested ? 'Hide untested' : `Show untested (${untested.length})`}</Text>
          </Pressable>
          {showUntested ? (
            <View style={{ gap: 12 }}>
              {SUBJECTS.map(item => {
                const group = untested.filter(entry => entry.chapter.subject === item)
                if (!group.length) return null
                return (
                  <View key={item} style={{ gap: 8 }}>
                    <View style={styles.inline}>
                      <SubjectBadge subject={item} />
                      <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{group.length} chapter{group.length === 1 ? '' : 's'} without a score</Text>
                    </View>
                    <View style={styles.chips}>
                      {group.map(entry => (
                        <Pressable key={entry.chapter.id} accessibilityRole="button" accessibilityLabel={`Log a test for ${entry.chapter.name} (${item})`} onPress={() => go(`/tests?add=1&chapter=${entry.chapter.id}`)} style={[styles.chip, { borderColor: theme.colors.line, backgroundColor: theme.colors.paper }]}>
                          <Text style={[theme.type.badge, { color: theme.colors.inkSoft, flexShrink: 1 }]}>{entry.chapter.name}</Text>
                          <Plus size={13} color={theme.colors.accent} />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )
              })}
              <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>Tap a chapter to log its first test — the test form opens with that chapter already selected.</Text>
            </View>
          ) : null}
        </NotebookCard>
      )}

      <Pressable accessibilityRole="link" onPress={() => go('/analytics')} style={styles.toggle}>
        <Text style={[theme.type.label, { color: theme.colors.accent }]}>See full analytics</Text>
        <ArrowUpRight size={15} color={theme.colors.accent} />
      </Pressable>
      <Text style={[theme.type.caption, { color: theme.colors.muted, textAlign: 'center' }]}>Weak = below the adjustable threshold. Okay = between thresholds. Strong = above. No usable score means Untested.</Text>
    </Screen>
  )
}

function OverviewTile({ icon, kicker, value, note }: { icon: React.ReactNode; kicker: string; value: number; note: string }) {
  const theme = useTheme()
  return (
    <NotebookCard padding={14} style={styles.tile}>
      <View style={styles.inline}>
        {icon}
        <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 10.5 }]}>{kicker}</Text>
      </View>
      <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 30, lineHeight: 32 }]}>{value}</Text>
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{note}</Text>
    </NotebookCard>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{label}</Text>
      <Text style={[theme.type.label, { color: theme.colors.ink }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  band: { borderWidth: 1, borderRadius: 12, padding: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, gap: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 38 },
  score: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  statRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7, maxWidth: '100%' }
})
