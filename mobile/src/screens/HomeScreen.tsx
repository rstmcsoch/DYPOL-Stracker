import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/AppearanceContext'
import { indiaToday, prettyDate } from '../shared/lib/date'
import { getSmartTip, getTodayStudyMinutes } from '../shared/lib/analytics'
import { computeStreaks } from '../shared/lib/jee/study-time'
import { currentExamMode } from '../shared/lib/jee/exam'
import { fmtDuration } from '../shared/lib/format'
import { completeRevision } from '../shared/lib/revision-actions'
import type { AppData, DailyTask, Revision, Subject } from '../shared/types'
import { ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, ChevronRight, Clock, Flame, NotebookPen, Plus, Rocket, Sparkles, Timer, AlarmClock } from '../components/icons'
import { Button } from '../components/ui/Button'
import { ProgressBar, ProgressRing } from '../components/ui/Progress'
import { EmptyState, NotebookCard, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'
import { Screen } from '../components/ui/Screen'
import { StudyNowCard } from '../components/jee/StudyNowCard'
import { HomeSnapshot } from '../components/jee/HomeSnapshot'

export function HomeScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { data, upsert, upsertMany, refresh, syncState } = useData()
  const { notify } = useToast()
  const [reordering, setReordering] = useState(false)
  const today = indiaToday()
  const todayTasks = useMemo(() => data.tasks.filter(task => task.task_date === today).sort((a, b) => a.position - b.position), [data.tasks, today])
  const doneTasks = todayTasks.filter(task => task.is_completed).length
  const dayRevisions = data.revisions.filter(revision => !revision.completed_at && revision.due_on <= today).sort((a, b) => a.due_on.localeCompare(b.due_on))
  const todayMinutes = getTodayStudyMinutes(data)
  const streak = computeStreaks(data, today)
  const examMode = currentExamMode(data, today)
  const goal = data.settings.daily_study_goal_minutes
  const progress = goal > 0 ? Math.min(100, (todayMinutes / goal) * 100) : 0
  const tip = getSmartTip(data)
  const completedChapters = data.chapters.filter(chapter => chapter.status === 'Done' || chapter.status === 'Revised').length
  const totalChapters = data.chapters.length
  const examDays = daysUntil(data.settings.advanced_exam_date)
  const mainDays = daysUntil(data.settings.main_exam_date)
  // The prominent countdown prefers JEE Advanced; when Advanced is unset and a Main date exists, Main becomes the big day.
  const primaryExam = examDays !== null
    ? { label: 'JEE Advanced', days: examDays, date: data.settings.advanced_exam_date, dot: theme.colors.orange }
    : mainDays !== null
      ? { label: 'JEE Main', days: mainDays, date: data.settings.main_exam_date, dot: theme.colors.subjectPhysics }
      : null
  const secondaryExam = primaryExam?.label === 'JEE Main'
    ? { label: 'JEE Advanced', days: examDays, dot: theme.colors.orange }
    : { label: 'JEE Main', days: mainDays, dot: theme.colors.subjectPhysics }
  const greetingName = data.settings.owner_name || data.profile?.display_name || 'future engineer'
  const eyebrow = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date()).toUpperCase()

  const go = (to: string) => router.navigate(to as Href)

  const toggleTask = async (task: DailyTask) => {
    try {
      await upsert('daily_tasks', { ...task, is_completed: !task.is_completed, updated_at: new Date().toISOString() })
      if (!task.is_completed) notify('Nice work — one less thing on the list.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update task. Retry.', 'error')
    }
  }

  const moveTask = async (index: number, direction: -1 | 1) => {
    if (reordering) return
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= todayTasks.length) return
    const first = todayTasks[index]
    const second = todayTasks[nextIndex]
    if (!first || !second) return
    setReordering(true)
    const now = new Date().toISOString()
    try {
      await upsertMany('daily_tasks', [
        { ...first, position: second.position, updated_at: now },
        { ...second, position: first.position, updated_at: now }
      ])
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not reorder tasks.', 'error')
    } finally {
      setReordering(false)
    }
  }

  const finishRevision = async (revision: Revision) => {
    const chapter = data.chapters.find(item => item.id === revision.chapter_id)
    try {
      const completed = await completeRevision(
        revision, chapter,
        records => upsertMany('chapter_revisions', records),
        record => upsert('chapters', record),
        { revisions: data.revisions, gaps: data.settings.revision_gaps, today }
      )
      if (completed) notify('Revision marked complete. Well remembered.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not mark revision complete.', 'error')
    }
  }

  const subjectTotals = (['Physics', 'Chemistry', 'Maths'] as Subject[]).map(subject => {
    const total = data.chapters.filter(item => item.subject === subject).length
    const done = data.chapters.filter(item => item.subject === subject && (item.status === 'Done' || item.status === 'Revised')).length
    return { subject, total, done }
  })

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader eyebrow={eyebrow} title={`Good ${getGreeting()}, ${greetingName}.`} subtitle="Let’s make today count — one honest study block at a time." />

      <View style={{ gap: 12 }}>
        <NotebookCard accent="orange" style={{ gap: 12 }}>
          <View style={styles.rowBetween}>
            <Text style={[theme.type.overline, { color: theme.colors.muted }]}>THE BIG DAY</Text>
            <View style={styles.inline}><Rocket size={14} color={theme.colors.accent} /><Text style={[theme.type.badge, { color: theme.colors.accent }]}>JEE 2027</Text></View>
          </View>
          {primaryExam === null ? (
            <View style={{ gap: 8 }}>
              <Text style={[theme.type.caption, { color: theme.colors.muted }]}>JEE Main & Advanced</Text>
              <Text accessibilityRole="header" style={[theme.type.h1, { color: theme.colors.ink }]}>Set your date <Text style={{ color: theme.colors.accent }}>when you’re ready.</Text></Text>
              <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>We’ll keep the countdown honest.</Text>
              <Button variant="marker" size="sm" onPress={() => go('/settings')} icon={<ArrowRight size={15} color={theme.colors.buttonPrimaryInk} />}>Add exam date</Button>
            </View>
          ) : (
            <View style={styles.countdown}>
              <Text style={[theme.type.display, { color: theme.colors.ink, fontSize: 60, lineHeight: 62 }]}>{Math.max(0, primaryExam.days)}<Text style={[theme.type.caption, { color: theme.colors.muted }]}> days</Text></Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[theme.type.caption, { color: theme.colors.muted }]}>until</Text>
                <Text style={[theme.type.h3, { color: theme.colors.ink }]}>{primaryExam.label}</Text>
                <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{prettyDate(primaryExam.date)}</Text>
              </View>
            </View>
          )}
          <View style={[styles.miniRow, { borderTopColor: theme.colors.line }]}>
            <MiniExam dot={secondaryExam.dot} label={secondaryExam.label} value={secondaryExam.days === null ? null : `${Math.max(0, secondaryExam.days)} days`} onAdd={() => go('/settings')} />
            <MiniExam dot={theme.colors.orange} label="Chapters covered" value={`${completedChapters}/${totalChapters}`} />
          </View>
        </NotebookCard>

        <NotebookCard accent="orange" style={{ gap: 8 }}>
          <View style={styles.inline}>
            <View style={[styles.iconTile, { backgroundColor: theme.colors.surfaceWarm, borderColor: theme.colors.surfaceWarmBorder }]}><Flame size={17} color={theme.colors.surfaceWarmInk} /></View>
            <Text style={[theme.type.overline, { color: theme.colors.muted }]}>YOUR RHYTHM</Text>
          </View>
          <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 44, lineHeight: 46 }]}>{streak.current}<Text style={[theme.type.caption, { color: theme.colors.muted }]}> day{streak.current === 1 ? '' : 's'}</Text></Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted }]}>current study streak</Text>
          <Text style={[theme.type.label, { color: theme.colors.inkSoft }]}><Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>{streak.longest}</Text> longest · <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>{streak.weeklyConsistency}/7</Text> active this week</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{streak.qualifyingToday ? 'Today counts.' : 'A day counts after 15+ min of study, a practice log, a completed revision, or a test.'}</Text>
        </NotebookCard>
      </View>

      {examMode.active ? (
        <View accessibilityRole="alert" style={[styles.examBanner, { borderColor: theme.colors.orange, backgroundColor: theme.colors.surfaceWarm }]}>
          <Text style={[theme.type.metric, { color: theme.colors.surfaceWarmInk, fontSize: 30, lineHeight: 32 }]}>{examMode.daysLeft}</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[theme.type.label, { color: theme.colors.surfaceWarmInk }]}>Exam Mode · {examMode.label}</Text>
            <Text style={[theme.type.caption, { color: theme.colors.surfaceWarmInk }]}>{examMode.reason} Revision, PYQs, mocks and weak-area fixes come first.</Text>
          </View>
        </View>
      ) : null}

      <StudyNowCard />
      <HomeSnapshot />

      <View style={{ gap: 12 }}>
        <SectionHeading title="Today's plan" note={`${doneTasks} of ${todayTasks.length} done`} action={<Button variant="secondary" size="sm" onPress={() => go('/planner?add=1')} icon={<Plus size={16} color={theme.colors.ink} />}>Add task</Button>} />
        <NotebookCard padding={16} style={{ gap: 10 }}>
          <View style={styles.rowBetween}>
            <Text style={[theme.type.caption, { color: theme.colors.accent, fontFamily: theme.fonts.identity, fontSize: 18 }]}>A little list for today</Text>
            <View style={styles.inline}><CalendarDays size={14} color={theme.colors.muted} /><Text style={[theme.type.badge, { color: theme.colors.muted }]}>{prettyDate(today, { weekday: 'short', day: 'numeric', month: 'short' })}</Text></View>
          </View>
          {todayTasks.length === 0 ? (
            <EmptyState icon={<BookOpen size={26} color={theme.colors.muted} />} title="Your page is still blank." description="Add one clear task and give today a gentle starting point." action={<Button variant="secondary" size="sm" onPress={() => go('/planner?add=1')} icon={<Plus size={15} color={theme.colors.ink} />}>Plan a task</Button>} />
          ) : (
            <View style={{ gap: 4 }}>
              {todayTasks.slice(0, 6).map((task, index) => {
                const chapter = data.chapters.find(item => item.id === task.chapter_id)
                return (
                  <View key={task.id} style={[styles.taskRow, { borderBottomColor: theme.colors.line }]}>
                    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: task.is_completed }} accessibilityLabel={task.is_completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`} onPress={() => void toggleTask(task)} style={[styles.check, { borderColor: task.is_completed ? theme.colors.green : theme.colors.lineStrong, backgroundColor: task.is_completed ? theme.colors.greenBg : 'transparent' }]}>
                      {task.is_completed ? <Check size={14} strokeWidth={3} color={theme.colors.green} /> : null}
                    </Pressable>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={[theme.type.label, { color: task.is_completed ? theme.colors.muted : theme.colors.ink, textDecorationLine: task.is_completed ? 'line-through' : 'none' }]}>{task.title}</Text>
                      <View style={styles.inline}>
                        {task.subject ? <SubjectBadge subject={task.subject} /> : null}
                        {chapter ? <Text style={[theme.type.badge, { color: theme.colors.muted, flexShrink: 1 }]} numberOfLines={1}>{chapter.name}</Text> : null}
                        <Clock size={12} color={theme.colors.muted} />
                        <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{fmtDuration(task.estimated_minutes)}</Text>
                      </View>
                    </View>
                    <View style={[styles.priority, { backgroundColor: priorityColor(theme, task.priority) }]} accessibilityLabel={`${task.priority} priority`} />
                    <View style={styles.orderCol}>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Move ${task.title} up`} disabled={index === 0 || reordering} onPress={() => void moveTask(index, -1)} style={styles.orderBtn}>
                        <Text style={{ color: index === 0 ? theme.colors.lineStrong : theme.colors.inkSoft, fontSize: 14 }}>↑</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Move ${task.title} down`} disabled={index === todayTasks.length - 1 || reordering} onPress={() => void moveTask(index, 1)} style={styles.orderBtn}>
                        <Text style={{ color: index === todayTasks.length - 1 ? theme.colors.lineStrong : theme.colors.inkSoft, fontSize: 14 }}>↓</Text>
                      </Pressable>
                    </View>
                  </View>
                )
              })}
              {todayTasks.length > 6 ? (
                <Pressable accessibilityRole="link" onPress={() => go('/planner')} style={styles.linkRow}>
                  <Text style={[theme.type.label, { color: theme.colors.accent }]}>View all {todayTasks.length} tasks</Text>
                  <ArrowRight size={15} color={theme.colors.accent} />
                </Pressable>
              ) : null}
            </View>
          )}
          {todayTasks.length > 0 ? (
            <Pressable accessibilityRole="link" onPress={() => go('/planner')} style={styles.linkRow}>
              <Text style={[theme.type.label, { color: theme.colors.accent }]}>Open planner</Text>
              <ArrowUpRight size={14} color={theme.colors.accent} />
            </Pressable>
          ) : null}
        </NotebookCard>
      </View>

      <NotebookCard accent="blue" padding={16} style={{ gap: 10 }}>
        <View style={styles.rowBetween}>
          <View style={styles.inline}>
            <View style={[styles.iconTile, { backgroundColor: theme.colors.blueBg, borderColor: theme.colors.line }]}><Timer size={16} color={theme.colors.accent} /></View>
            <Text style={[theme.type.overline, { color: theme.colors.muted }]}>DAILY STUDY TIME</Text>
          </View>
        </View>
        <View style={styles.inline}>
          <ProgressRing value={progress} size={88} label={`${Math.round(progress)}%`} color={theme.colors.subjectPhysics} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 28, lineHeight: 30 }]}>{fmtDuration(todayMinutes)}<Text style={[theme.type.caption, { color: theme.colors.muted }]}> / {fmtDuration(goal)}</Text></Text>
            <Text style={[theme.type.caption, { color: theme.colors.muted }]}>towards your daily goal</Text>
            <Pressable accessibilityRole="link" onPress={() => go('/focus')} style={styles.linkRow}>
              <Timer size={14} color={theme.colors.accent} />
              <Text style={[theme.type.label, { color: theme.colors.accent }]}>Start a focus session</Text>
            </Pressable>
          </View>
        </View>
        <ProgressBar value={progress} color={theme.colors.subjectPhysics} />
      </NotebookCard>

      <NotebookCard accent="green" padding={16} style={{ gap: 10 }}>
        <View style={styles.rowBetween}>
          <View style={styles.inline}>
            <View style={[styles.iconTile, { backgroundColor: theme.colors.greenBg, borderColor: theme.colors.line }]}><AlarmClock size={16} color={theme.colors.green} /></View>
            <Text style={[theme.type.overline, { color: theme.colors.muted }]}>REVISION DESK</Text>
          </View>
          <Pressable accessibilityRole="link" onPress={() => go('/revision')} style={styles.inline}>
            <Text style={[theme.type.label, { color: theme.colors.accent }]}>Open</Text>
            <ArrowUpRight size={14} color={theme.colors.accent} />
          </Pressable>
        </View>
        <View style={styles.inline}>
          <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 40, lineHeight: 42 }]}>{dayRevisions.length}</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted }]}>due now</Text>
        </View>
        {dayRevisions.length === 0 ? (
          <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>Nothing due today. Keep that momentum going.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {dayRevisions.slice(0, 3).map(revision => (
              <RevisionPeek key={revision.id} revision={revision} data={data} onDone={() => void finishRevision(revision)} />
            ))}
          </View>
        )}
      </NotebookCard>

      <NotebookCard padding={16} style={{ gap: 8 }}>
        <View style={styles.inline}>
          <View style={[styles.iconTile, { backgroundColor: theme.colors.surfaceTip, borderColor: theme.colors.surfaceTipBorder }]}><Sparkles size={16} color={theme.colors.surfaceTipInk} /></View>
          <Text style={[theme.type.overline, { color: theme.colors.muted }]}>ONE THING TO NOTICE</Text>
        </View>
        <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>{tip}</Text>
        <Pressable accessibilityRole="link" onPress={() => go('/analytics')} style={styles.linkRow}>
          <Text style={[theme.type.label, { color: theme.colors.accent }]}>See what the data says</Text>
          <ArrowRight size={14} color={theme.colors.accent} />
        </Pressable>
      </NotebookCard>

      <NotebookCard accent="blue" padding={16} style={{ gap: 12 }}>
        <View style={styles.inline}>
          <View style={[styles.iconTile, { backgroundColor: theme.colors.paperSoft, borderColor: theme.colors.line }]}><NotebookPen size={22} color={theme.colors.accent} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[theme.type.overline, { color: theme.colors.accent }]}>A FRESH CHECKPOINT</Text>
            <Text accessibilityRole="header" style={[theme.type.h3, { color: theme.colors.ink }]}>How did the practice go?</Text>
          </View>
        </View>
        <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>Log a chapter test, a PYQ session, or your latest mock.</Text>
        <Button onPress={() => go('/tests?add=1')} icon={<Plus size={17} color={theme.colors.buttonPrimaryInk} />}>Add test</Button>
      </NotebookCard>

      <NotebookCard padding={16} style={{ gap: 10 }}>
        <View style={styles.rowBetween}>
          <View style={{ gap: 2 }}>
            <Text style={[theme.type.overline, { color: theme.colors.accent }]}>THE LONG GAME</Text>
            <Text accessibilityRole="header" style={[theme.type.h3, { color: theme.colors.ink }]}>Syllabus progress</Text>
          </View>
          <ProgressRing value={totalChapters ? (completedChapters / totalChapters) * 100 : 0} size={62} label={`${Math.round(totalChapters ? (completedChapters / totalChapters) * 100 : 0)}%`} />
        </View>
        {subjectTotals.map(item => (
          <View key={item.subject} style={styles.subjectRow}>
            <SubjectBadge subject={item.subject} />
            <View style={{ flex: 1 }}><ProgressBar value={item.total ? (item.done / item.total) * 100 : 0} color={subjectTone(theme, item.subject)} /></View>
            <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{item.done}/{item.total}</Text>
          </View>
        ))}
        <Pressable accessibilityRole="link" onPress={() => go('/syllabus')} style={styles.linkRow}>
          <Text style={[theme.type.label, { color: theme.colors.accent }]}>See all chapters</Text>
          <ChevronRight size={15} color={theme.colors.accent} />
        </Pressable>
      </NotebookCard>
    </Screen>
  )
}

function MiniExam({ dot, label, value, onAdd }: { dot: string; label: string; value: string | null; onAdd?: () => void }) {
  const theme = useTheme()
  return (
    <View style={styles.miniExam}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={[theme.type.caption, { color: theme.colors.muted, flexShrink: 1 }]} numberOfLines={1}>{label}</Text>
      {value === null && onAdd ? (
        <Pressable accessibilityRole="button" onPress={onAdd}><Text style={[theme.type.label, { color: theme.colors.accent }]}>Add date</Text></Pressable>
      ) : (
        <Text style={[theme.type.label, { color: theme.colors.ink }]}>{value}</Text>
      )}
    </View>
  )
}

function RevisionPeek({ revision, data, onDone }: { revision: Revision; data: AppData; onDone: () => void }) {
  const theme = useTheme()
  const chapter = data.chapters.find(item => item.id === revision.chapter_id)
  if (!chapter) return null
  const late = revision.due_on < indiaToday()
  const daysLate = late ? differenceInCalendarDays(parseISO(`${indiaToday()}T12:00:00`), parseISO(`${revision.due_on}T12:00:00`)) : 0
  return (
    <View style={[styles.peek, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
      <Text style={[theme.type.badge, { color: theme.colors.accent, fontSize: 13 }]}>R{revision.revision_number}</Text>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[theme.type.label, { color: theme.colors.ink }]} numberOfLines={2}>{chapter.name}</Text>
        <View style={styles.inline}>
          <SubjectBadge subject={chapter.subject} />
          {late ? <StatusBadge tone="bad">{daysLate}d late</StatusBadge> : null}
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Mark ${chapter.name} revision complete`} onPress={onDone} style={[styles.check, { borderColor: theme.colors.green, backgroundColor: theme.colors.greenBg }]}>
        <Check size={15} color={theme.colors.green} />
      </Pressable>
    </View>
  )
}

function priorityColor(theme: ReturnType<typeof useTheme>, priority: string): string {
  if (priority === 'High') return theme.colors.red
  if (priority === 'Low') return theme.colors.green
  return theme.colors.orange
}

function subjectTone(theme: ReturnType<typeof useTheme>, subject: Subject): string {
  if (subject === 'Physics') return theme.colors.subjectPhysics
  if (subject === 'Chemistry') return theme.colors.subjectChemistry
  return theme.colors.subjectMaths
}

function getGreeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date()))
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function daysUntil(date: string): number | null {
  if (!date) return null
  const today = indiaToday()
  return differenceInCalendarDays(parseISO(`${date}T12:00:00`), parseISO(`${today}T12:00:00`))
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  countdown: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  miniRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  miniExam: { flexDirection: 'row', alignItems: 'center', gap: 6, flexGrow: 1, flexBasis: '45%' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  iconTile: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  examBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  check: { width: 30, height: 30, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  priority: { width: 8, height: 26, borderRadius: 4 },
  orderCol: { gap: 2 },
  orderBtn: { width: 30, height: 22, alignItems: 'center', justifyContent: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  peek: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 10 }
})
