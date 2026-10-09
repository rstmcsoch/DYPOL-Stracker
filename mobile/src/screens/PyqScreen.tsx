import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/AppearanceContext'
import { pyqCompletion, pyqYears, PYQ_EXAM_LABEL } from '../shared/lib/jee/progress'
import { pyqRecordId } from '../shared/lib/jee/ids'
import { PYQ_EXAMS, type Chapter, type PYQExam, type PyqRecord, type Subject } from '../shared/types'
import { Check, CheckCheck, Search, Settings2, X } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Screen } from '../components/ui/Screen'
import { TextField } from '../components/ui/Forms'
import { EmptyState, NotebookCard, PageHeader, SectionHeading, SubjectBadge } from '../components/ui/Surfaces'
import { ChipFilter, Meter, SubjectSelect } from '../components/jee/shared'

type ExamFilter = 'all' | PYQExam
type StatusFilter = 'all' | 'pending' | 'done'

/** Year-by-year PYQ tracker. Each year toggles on its own, and chapters can be bulk-edited together. */
export function PyqScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { data, upsert, upsertMany, refresh, syncState } = useData()
  const { notify } = useToast()
  const [exam, setExam] = useState<ExamFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [subject, setSubject] = useState<Subject | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const years = useMemo(() => pyqYears(data.settings), [data.settings])
  const exams = useMemo<PYQExam[]>(() => (exam === 'all' ? [...PYQ_EXAMS] : [exam]), [exam])
  const userId = data.settings.user_id ?? data.settings.id

  const overall = PYQ_EXAMS.map(item => pyqCompletion(data.pyqRecords, null, item, data.settings))
  const chapters = useMemo(() => data.chapters.filter(chapter => {
    if (subject !== 'all' && chapter.subject !== subject) return false
    if (search.trim() && !chapter.name.toLowerCase().includes(search.trim().toLowerCase())) return false
    const rows = exams.map(item => pyqCompletion(data.pyqRecords, chapter.id, item, data.settings))
    const pending = rows.some(row => row.pendingYears.length > 0)
    if (status === 'pending' && !pending) return false
    if (status === 'done' && pending) return false
    return true
  }), [data.chapters, data.pyqRecords, data.settings, subject, search, status, exams])

  const recordFor = (chapterId: string, examValue: PYQExam, year: number): PyqRecord | undefined =>
    data.pyqRecords.find(row => row.chapter_id === chapterId && row.exam === examValue && row.year === year)

  const writeYears = async (targets: { chapter: Chapter; exam: PYQExam; year: number; done: boolean }[]) => {
    const now = new Date().toISOString()
    const records: PyqRecord[] = targets.map(target => {
      const existing = recordFor(target.chapter.id, target.exam, target.year)
      return {
        id: existing?.id ?? pyqRecordId(userId, target.chapter.id, target.exam, target.year),
        chapter_id: target.chapter.id, exam: target.exam, year: target.year,
        status: target.done ? 'done' : 'pending',
        questions_total: existing?.questions_total ?? null, questions_done: existing?.questions_done ?? null,
        meta: existing?.meta ?? null,
        completed_at: target.done ? (existing?.completed_at ?? now) : null,
        created_at: existing?.created_at ?? now, updated_at: now
      }
    })
    if (records.length === 1 && records[0]) await upsert('pyq_records', records[0])
    else await upsertMany('pyq_records', records)
  }

  const toggleYear = async (chapter: Chapter, examValue: PYQExam, year: number) => {
    const current = recordFor(chapter.id, examValue, year)
    const done = current?.status !== 'done'
    try {
      await writeYears([{ chapter, exam: examValue, year, done }])
      if (done) notify(`${chapter.name} · ${PYQ_EXAM_LABEL[examValue]} ${year} marked done.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update this PYQ year.', 'error')
    }
  }

  const setAllForChapter = async (chapter: Chapter, examValue: PYQExam, done: boolean) => {
    try {
      await writeYears(years.map(year => ({ chapter, exam: examValue, year, done })))
      notify(done ? `All ${PYQ_EXAM_LABEL[examValue]} years marked done for ${chapter.name}.` : `${PYQ_EXAM_LABEL[examValue]} years reset for ${chapter.name}.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update PYQs.', 'error')
    }
  }

  const bulk = async (examValue: PYQExam, done: boolean) => {
    if (bulkBusy || selected.size === 0) return
    const targets = data.chapters.filter(chapter => selected.has(chapter.id))
    setBulkBusy(true)
    try {
      await writeYears(targets.flatMap(chapter => years.map(year => ({ chapter, exam: examValue, year, done }))))
      notify(`${targets.length} chapter${targets.length === 1 ? '' : 's'} updated for ${PYQ_EXAM_LABEL[examValue]}.`)
      setSelected(new Set())
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Bulk update failed. Nothing was half-applied; retry.', 'error')
    } finally {
      setBulkBusy(false)
    }
  }

  const toggleSelect = (chapterId: string) => setSelected(current => {
    const next = new Set(current)
    if (next.has(chapterId)) next.delete(chapterId)
    else next.add(chapterId)
    return next
  })

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader
        eyebrow="PREVIOUS YEAR QUESTIONS, YEAR BY YEAR"
        title="PYQ tracker"
        subtitle="Mark each chapter’s past papers as done. Completion feeds the chapter stages and Study now."
        action={<Button variant="secondary" size="sm" onPress={() => router.navigate('/settings' as never)} icon={<Settings2 size={15} color={theme.colors.ink} />}>Year range</Button>}
      />

      <View style={{ gap: 10 }}>
        {overall.map(item => (
          <NotebookCard key={item.exam} padding={14} style={{ gap: 6 }}>
            <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{PYQ_EXAM_LABEL[item.exam]} PYQs</Text>
            <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 28, lineHeight: 30 }]}>{item.done}/{item.total}<Text style={[theme.type.caption, { color: theme.colors.muted }]}> years</Text></Text>
            <Meter value={item.percent} label={`${PYQ_EXAM_LABEL[item.exam]} PYQ completion`} tone={item.exam === 'Main' ? 'blue' : 'orange'} />
            <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{item.percent === null ? 'Set a year range in Settings' : `${Math.round(item.percent)}% complete across all chapters`}</Text>
          </NotebookCard>
        ))}
      </View>

      <NotebookCard padding={14} style={{ gap: 12 }}>
        <TextField label="Find a chapter" value={search} onChangeText={setSearch} placeholder="Find a chapter" autoCorrect={false} leading={<Search size={16} color={theme.colors.muted} />} />
        <SubjectSelect value={subject} onChange={value => setSubject(value as Subject | 'all')} />
        <ChipFilter<ExamFilter> label="Exam" value={exam} onChange={setExam} options={[{ value: 'all', label: 'Both' }, { value: 'Main', label: 'JEE Main' }, { value: 'Advanced', label: 'JEE Advanced' }]} />
        <ChipFilter<StatusFilter> label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'pending', label: 'Has pending years' }, { value: 'done', label: 'Complete' }]} />
      </NotebookCard>

      {years.length === 0 ? (
        <NotebookCard>
          <EmptyState title="The year range is empty." description="Set the first and last PYQ year in Settings → Exam." action={<Button variant="secondary" size="sm" onPress={() => router.navigate('/settings' as never)}>Open Settings</Button>} />
        </NotebookCard>
      ) : null}

      {selected.size > 0 ? (
        <NotebookCard padding={12} accent="blue" style={{ gap: 10 }}>
          <View style={styles.rowBetween}>
            <Text style={[theme.type.label, { color: theme.colors.ink }]}>{selected.size} selected</Text>
            <Button size="sm" variant="quiet" onPress={() => setSelected(new Set())} icon={<X size={14} color={theme.colors.accent} />}>Clear</Button>
          </View>
          {exams.map(item => (
            <View key={item} style={styles.bulkRow}>
              <Button size="sm" variant="secondary" loading={bulkBusy} onPress={() => void bulk(item, true)} icon={<CheckCheck size={14} color={theme.colors.ink} />}>{PYQ_EXAM_LABEL[item]}: all done</Button>
              <Button size="sm" variant="quiet" disabled={bulkBusy} onPress={() => void bulk(item, false)}>Reset</Button>
            </View>
          ))}
        </NotebookCard>
      ) : null}

      <SectionHeading title="Chapters" note={`${chapters.length} shown · tap a year to toggle it · tick chapters to bulk-edit`} />
      {chapters.length === 0 ? (
        <NotebookCard><EmptyState icon={<Check size={22} color={theme.colors.muted} />} title="No chapters match." description="Clear the filters to see every chapter." /></NotebookCard>
      ) : (
        <View style={{ gap: 10 }}>
          {chapters.map(chapter => {
            const rows = exams.map(item => ({ exam: item, completion: pyqCompletion(data.pyqRecords, chapter.id, item, data.settings) }))
            const isSelected = selected.has(chapter.id)
            return (
              <NotebookCard key={chapter.id} padding={14} accent={isSelected ? 'blue' : 'plain'} style={{ gap: 10 }}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: isSelected }} accessibilityLabel={`Select ${chapter.name} for bulk actions`} onPress={() => toggleSelect(chapter.id)} style={styles.chapterHead}>
                  <View style={[styles.box, { borderColor: isSelected ? theme.colors.accent : theme.colors.lineStrong, backgroundColor: isSelected ? theme.colors.accentLight : 'transparent' }]}>
                    {isSelected ? <Check size={13} strokeWidth={3} color={theme.colors.accentDark} /> : null}
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[theme.type.label, { color: theme.colors.ink }]}>{chapter.name}</Text>
                    <SubjectBadge subject={chapter.subject} />
                  </View>
                </Pressable>
                {rows.map(({ exam: examValue, completion }) => (
                  <View key={examValue} style={{ gap: 8 }}>
                    <View style={styles.rowBetween}>
                      <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flexShrink: 1 }]}>
                        {PYQ_EXAM_LABEL[examValue]} PYQs: {completion.done}/{completion.total} complete{completion.percent !== null ? ` — ${Math.round(completion.percent)}%` : ''}
                      </Text>
                      <View style={styles.inline}>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Mark all ${PYQ_EXAM_LABEL[examValue]} years done for ${chapter.name}`} disabled={completion.pendingYears.length === 0} onPress={() => void setAllForChapter(chapter, examValue, true)} style={styles.tinyBtn}>
                          <Text style={[theme.type.badge, { color: completion.pendingYears.length === 0 ? theme.colors.muted : theme.colors.accent }]}>All</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Reset ${PYQ_EXAM_LABEL[examValue]} years for ${chapter.name}`} disabled={completion.doneYears.length === 0} onPress={() => void setAllForChapter(chapter, examValue, false)} style={styles.tinyBtn}>
                          <Text style={[theme.type.badge, { color: completion.doneYears.length === 0 ? theme.colors.muted : theme.colors.accent }]}>Reset</Text>
                        </Pressable>
                      </View>
                    </View>
                    <View style={styles.yearGrid}>
                      {years.map(year => {
                        const done = completion.doneYears.includes(year)
                        return (
                          <Pressable
                            key={year}
                            accessibilityRole="button"
                            accessibilityState={{ checked: done }}
                            accessibilityLabel={`${year} ${done ? 'done' : 'pending'}, tap to mark ${done ? 'pending' : 'done'}`}
                            onPress={() => void toggleYear(chapter, examValue, year)}
                            style={[styles.year, { borderColor: done ? theme.colors.green : theme.colors.line, backgroundColor: done ? theme.colors.greenBg : theme.colors.paperSoft }]}
                          >
                            {done ? <Check size={11} strokeWidth={3} color={theme.colors.green} /> : null}
                            <Text style={[theme.type.badge, { color: done ? theme.colors.green : theme.colors.inkSoft }]}>{year}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </View>
                ))}
              </NotebookCard>
            )
          })}
        </View>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chapterHead: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tinyBtn: { minHeight: 32, minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  yearGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  year: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, minWidth: 58, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, justifyContent: 'center' }
})
