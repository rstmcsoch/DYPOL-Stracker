import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useData, type DataContextValue } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/AppearanceContext'
import { getChapterPerformance } from '../shared/lib/analytics'
import { createId } from '../shared/lib/id'
import { indiaToday, plusDays } from '../shared/lib/date'
import { SUBJECTS, type Chapter, type ChapterImportance, type ChapterStatus, type Priority, type Subject } from '../shared/types'
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Search, Trash2, X } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Dialog, ConfirmDialog } from '../components/ui/Overlays'
import { Screen } from '../components/ui/Screen'
import { SelectField, TextField } from '../components/ui/Forms'
import { ProgressBar } from '../components/ui/Progress'
import { OverflowMenu } from '../components/ui/OverflowMenu'
import { EmptyState, NotebookCard, PageHeader, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'
import { ChipFilter } from '../components/jee/shared'
import { ChapterStageEditor } from '../components/jee/ChapterStageEditor'

const STATUSES: ChapterStatus[] = ['Not Started', 'Studying', 'Done', 'Revised']
const PRIORITIES: Priority[] = ['High', 'Medium', 'Low']
type StrengthFilter = 'all' | 'Weak' | 'Okay' | 'Strong'
type TestedFilter = 'all' | 'tested' | 'untested'

/**
 * The syllabus map. Chapters can be filtered, their status changed in one tap, reordered within a
 * subject (Move up / Move down), and edited with notes, formulas, and the learning-stage pipeline.
 */
export function SyllabusScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { data, upsert, upsertMany, remove, refresh, syncState } = useData()
  const { notify } = useToast()
  const performance = useMemo(() => getChapterPerformance(data), [data])
  const [search, setSearch] = useState('')
  const [subjectFilter, setSubjectFilter] = useState<'all' | Subject>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ChapterStatus>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all')
  const [strengthFilter, setStrengthFilter] = useState<StrengthFilter>('all')
  const [testedFilter, setTestedFilter] = useState<TestedFilter>('all')
  const [editing, setEditing] = useState<Chapter | null>(null)
  const [createSubject, setCreateSubject] = useState<Subject | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null)
  const [deletingChapter, setDeletingChapter] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return performance.filter(item => {
      const chapter = item.chapter
      if (subjectFilter !== 'all' && chapter.subject !== subjectFilter) return false
      if (statusFilter !== 'all' && chapter.status !== statusFilter) return false
      if (priorityFilter !== 'all' && chapter.priority !== priorityFilter) return false
      if (strengthFilter !== 'all' && item.classification !== strengthFilter) return false
      if (testedFilter === 'tested' && item.classification === 'Untested') return false
      if (testedFilter === 'untested' && item.classification !== 'Untested') return false
      if (term && !`${chapter.name} ${chapter.subject} ${chapter.notes} ${chapter.formula_notes}`.toLowerCase().includes(term)) return false
      return true
    })
  }, [performance, search, subjectFilter, statusFilter, priorityFilter, strengthFilter, testedFilter])
  const filtersActive = Boolean(search) || subjectFilter !== 'all' || statusFilter !== 'all' || priorityFilter !== 'all' || strengthFilter !== 'all' || testedFilter !== 'all'
  const clearFilters = () => {
    setSearch('')
    setSubjectFilter('all')
    setStatusFilter('all')
    setPriorityFilter('all')
    setStrengthFilter('all')
    setTestedFilter('all')
  }

  const persistChapter = async (next: Chapter, previous: Chapter | undefined, upsertFn: DataContextValue['upsert'], upsertManyFn: DataContextValue['upsertMany'], removeFn: DataContextValue['remove']) => {
    await upsertFn('chapters', next)
    const wasComplete = previous?.status === 'Done' || previous?.status === 'Revised'
    const isComplete = next.status === 'Done' || next.status === 'Revised'
    const chapterRevisions = data.revisions.filter(revision => revision.chapter_id === next.id)
    if (isComplete && (!wasComplete || chapterRevisions.length === 0)) {
      const firstNumber = chapterRevisions.reduce((max, revision) => Math.max(max, revision.revision_number), 0) + 1
      const now = new Date().toISOString()
      await upsertManyFn('chapter_revisions', data.settings.revision_gaps.map((gap, index) => ({
        id: createId(), chapter_id: next.id, revision_number: firstNumber + index,
        due_on: plusDays(next.completed_on ?? indiaToday(), Math.max(1, gap)), completed_at: null, created_at: now, updated_at: now
      })))
    } else if (wasComplete && !isComplete) {
      const pending = data.revisions.filter(revision => revision.chapter_id === next.id && !revision.completed_at)
      for (const revision of pending) await removeFn('chapter_revisions', revision, { undo: false })
    }
  }

  const changeStatus = async (chapter: Chapter, status: ChapterStatus) => {
    if (status === chapter.status || busy) return
    setBusy(chapter.id)
    try {
      const next: Chapter = { ...chapter, status, completed_on: status === 'Done' || status === 'Revised' ? chapter.completed_on ?? indiaToday() : null, updated_at: new Date().toISOString() }
      await persistChapter(next, chapter, upsert, upsertMany, remove)
      if (status === 'Done' || status === 'Revised') notify(`${chapter.name} marked complete. Your revision dates are in the diary.`)
      else if (chapter.status === 'Done' || chapter.status === 'Revised') notify(`${chapter.name} is back in progress.`)
      else notify(`Status updated for ${chapter.name}.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update chapter. Retry.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const moveChapter = async (chapter: Chapter, direction: -1 | 1) => {
    const group = data.chapters.filter(item => item.subject === chapter.subject).sort((a, b) => a.position - b.position)
    const index = group.findIndex(item => item.id === chapter.id)
    const destination = index + direction
    if (destination < 0 || destination >= group.length) return
    const sibling = group[destination]
    if (!sibling) return
    const now = new Date().toISOString()
    try {
      await upsertMany('chapters', [
        { ...chapter, position: sibling.position, updated_at: now },
        { ...sibling, position: chapter.position, updated_at: now }
      ])
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not reorder chapter.', 'error')
    }
  }

  const saveChapter = async (chapter: Chapter) => {
    if (!chapter.name.trim()) {
      notify('Chapter name is required.', 'error')
      return false
    }
    const sameName = data.chapters.some(item => item.id !== chapter.id && item.subject === chapter.subject && item.name.trim().toLowerCase() === chapter.name.trim().toLowerCase())
    if (sameName) {
      notify('That chapter already exists in this subject.', 'error')
      return false
    }
    const previous = data.chapters.find(item => item.id === chapter.id)
    const position = previous ? previous.position : data.chapters.filter(item => item.subject === chapter.subject).length
    const next: Chapter = {
      ...chapter, name: chapter.name.trim(), position,
      completed_on: chapter.status === 'Done' || chapter.status === 'Revised' ? chapter.completed_on ?? indiaToday() : null,
      updated_at: new Date().toISOString()
    }
    try {
      await persistChapter(next, previous, upsert, upsertMany, remove)
      notify('Chapter saved to your syllabus.')
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save chapter. Retry.', 'error')
      return false
    }
  }

  const deleteChapter = async () => {
    if (!deleteTarget || deletingChapter) return
    setDeletingChapter(true)
    try {
      await remove('chapters', deleteTarget)
      notify('Chapter removed. Use Undo if that was a slip.')
      setDeleteTarget(null)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not delete chapter.', 'error')
    } finally {
      setDeletingChapter(false)
    }
  }

  const subjectCounts = SUBJECTS.map(subject => {
    const rows = data.chapters.filter(item => item.subject === subject)
    const complete = rows.filter(item => item.status === 'Done' || item.status === 'Revised').length
    return { subject, total: rows.length, complete }
  })

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader
        eyebrow="THE MAP, NOT THE DESTINATION"
        title="Syllabus"
        subtitle="Make the big list feel smaller. Keep track of what’s next."
        action={<Button onPress={() => setCreateSubject('Physics')} icon={<Plus size={17} color={theme.colors.buttonPrimaryInk} />}>Add chapter</Button>}
      />

      <View style={{ gap: 10 }}>
        {subjectCounts.map(item => (
          <NotebookCard key={item.subject} padding={14} style={{ gap: 8 }}>
            <View style={styles.row}>
              <SubjectBadge subject={item.subject} />
              <Text style={[theme.type.label, { color: theme.colors.ink, flex: 1, textAlign: 'right' }]}>{item.complete} / {item.total} done</Text>
            </View>
            <ProgressBar value={item.total ? (item.complete / item.total) * 100 : 0} color={item.subject === 'Physics' ? theme.colors.subjectPhysics : item.subject === 'Chemistry' ? theme.colors.subjectChemistry : theme.colors.subjectMaths} />
          </NotebookCard>
        ))}
      </View>

      <NotebookCard padding={14} style={{ gap: 12 }}>
        <View style={styles.searchRow}>
          <Search size={17} color={theme.colors.muted} />
          <TextField label="Find a chapter or note" value={search} onChangeText={setSearch} placeholder="Find a chapter or note…" autoCorrect={false} containerStyle={{ flex: 1 }} />
        </View>
        <ChipFilter<'all' | Subject> label="Subject" value={subjectFilter} onChange={setSubjectFilter} options={[{ value: 'all', label: 'All' }, ...SUBJECTS.map(item => ({ value: item, label: item }))]} />
        <SelectField<'all' | ChapterStatus>
          label="Status"
          value={statusFilter}
          options={[{ value: 'all', label: 'All statuses' }, ...STATUSES.map(item => ({ value: item, label: item }))]}
          onChange={setStatusFilter}
        />
        <SelectField<'all' | Priority>
          label="Priority"
          value={priorityFilter}
          options={[{ value: 'all', label: 'Any priority' }, ...PRIORITIES.map(item => ({ value: item, label: item }))]}
          onChange={setPriorityFilter}
        />
        <ChipFilter<StrengthFilter> label="Strength" value={strengthFilter} onChange={setStrengthFilter} options={[{ value: 'all', label: 'Any' }, { value: 'Weak', label: 'Weak' }, { value: 'Okay', label: 'Okay' }, { value: 'Strong', label: 'Strong' }]} />
        <ChipFilter<TestedFilter> label="Tests" value={testedFilter} onChange={setTestedFilter} options={[{ value: 'all', label: 'All' }, { value: 'tested', label: 'Tested' }, { value: 'untested', label: 'Untested' }]} />
        {filtersActive ? (
          <Pressable accessibilityRole="button" onPress={clearFilters} style={styles.clear}>
            <X size={14} color={theme.colors.accent} />
            <Text style={[theme.type.label, { color: theme.colors.accent }]}>Clear filters</Text>
          </Pressable>
        ) : null}
      </NotebookCard>

      <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{filtered.length} showing · move chapters within a subject from each row’s menu</Text>
      {filtered.length === 0 ? (
        <NotebookCard>
          <EmptyState icon={<Search size={24} color={theme.colors.muted} />} title="No chapters found." description="Try a different search or loosen one of the filters." action={<Button variant="secondary" size="sm" onPress={clearFilters}>Clear filters</Button>} />
        </NotebookCard>
      ) : (
        <View style={{ gap: 10 }}>
          {filtered.map(item => {
            const subjectGroup = data.chapters.filter(chapter => chapter.subject === item.chapter.subject).sort((a, b) => a.position - b.position)
            const index = subjectGroup.findIndex(chapter => chapter.id === item.chapter.id)
            const canMoveUp = index > 0
            const canMoveDown = index >= 0 && index < subjectGroup.length - 1
            const chapter = item.chapter
            return (
              <NotebookCard key={chapter.id} padding={14} accent={item.dropping ? 'orange' : 'plain'} style={{ gap: 10 }}>
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text accessibilityRole="header" style={[theme.type.label, { color: theme.colors.ink }]}>{chapter.name}</Text>
                    <View style={styles.inline}>
                      <SubjectBadge subject={chapter.subject} />
                      <Text style={[theme.type.badge, { color: chapter.priority === 'High' ? theme.colors.red : chapter.priority === 'Low' ? theme.colors.green : theme.colors.orange }]}>{chapter.priority} priority</Text>
                      {chapter.weightage ? <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{chapter.weightage}</Text> : null}
                    </View>
                  </View>
                  <OverflowMenu
                    label={`Actions for ${chapter.name}`}
                    title={chapter.name}
                    items={[
                      { id: 'edit', label: 'Edit notes & stages', icon: <Pencil size={15} color={theme.colors.ink} />, onSelect: () => setEditing(chapter) },
                      { id: 'up', label: 'Move up', icon: <ArrowUp size={15} color={theme.colors.ink} />, disabled: !canMoveUp, onSelect: () => void moveChapter(chapter, -1) },
                      { id: 'down', label: 'Move down', icon: <ArrowDown size={15} color={theme.colors.ink} />, disabled: !canMoveDown, onSelect: () => void moveChapter(chapter, 1) },
                      { id: 'delete', label: 'Delete chapter', icon: <Trash2 size={15} color={theme.colors.red} />, danger: true, onSelect: () => setDeleteTarget(chapter) }
                    ]}
                  />
                </View>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <SelectField<ChapterStatus>
                      label="Status"
                      value={chapter.status}
                      options={STATUSES.map(status => ({ value: status, label: status }))}
                      onChange={status => void changeStatus(chapter, status)}
                    />
                  </View>
                </View>
                <View style={styles.row}>
                  {item.classification === 'Untested' ? <StatusBadge tone="muted">Untested</StatusBadge> : <StatusBadge tone={item.classification === 'Weak' ? 'bad' : item.classification === 'Okay' ? 'warn' : 'good'}>{item.classification} · {Math.round(item.average ?? 0)}%</StatusBadge>}
                  {item.dropping ? <StatusBadge tone="bad">Dropping</StatusBadge> : null}
                  <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{item.results.length ? `${item.results.length} test${item.results.length === 1 ? '' : 's'}` : 'No usable score'}</Text>
                  {busy === chapter.id ? <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Saving…</Text> : null}
                </View>
              </NotebookCard>
            )
          })}
        </View>
      )}

      {editing ? (
        <ChapterDialog chapter={editing} onClose={() => setEditing(null)} onSave={saveChapter} />
      ) : null}
      {createSubject ? (
        <ChapterDialog
          isNew
          chapter={{
            id: createId(), user_id: data.profile?.user_id, subject: createSubject, name: '',
            position: data.chapters.filter(item => item.subject === createSubject).length, status: 'Not Started', priority: 'Medium',
            importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString()
          } as Chapter}
          onClose={() => setCreateSubject(null)}
          onSave={async chapter => {
            const saved = await saveChapter(chapter)
            return saved
          }}
        />
      ) : null}
      <ConfirmDialog
        visible={Boolean(deleteTarget)}
        title={`Remove “${deleteTarget?.name ?? ''}”?`}
        message="Its revision schedule will also be removed; linked notes may be affected. You can undo the removal briefly."
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void deleteChapter()}
        loading={deletingChapter}
      />
      <Pressable accessibilityRole="link" onPress={() => router.navigate('/weak-areas' as never)} style={styles.clear}>
        <Text style={[theme.type.label, { color: theme.colors.accent }]}>See weak areas</Text>
      </Pressable>
    </Screen>
  )
}

function ChapterDialog({ chapter: initial, onClose, onSave, isNew = false }: {
  chapter: Chapter
  onClose: () => void
  onSave: (chapter: Chapter) => Promise<boolean>
  isNew?: boolean
}) {
  const theme = useTheme()
  const [chapter, setChapter] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Chapter>(key: K, value: Chapter[K]) => setChapter(current => ({ ...current, [key]: value }))
  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const saved = await onSave(chapter)
      if (saved) onClose()
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog visible onClose={onClose} title={isNew ? 'Add a chapter' : 'Chapter notes'} subtitle="A good study map leaves space for your own thinking.">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
        <TextField label="Chapter name" required value={chapter.name} maxLength={140} placeholder="e.g. Centre of Mass" onChangeText={value => set('name', value)} />
        <SelectField<Subject>
          label="Subject"
          value={chapter.subject}
          options={SUBJECTS.map(subject => ({ value: subject, label: subject }))}
          onChange={value => set('subject', value)}
        />
        <SelectField<ChapterStatus>
          label="Status"
          value={chapter.status}
          options={STATUSES.map(status => ({ value: status, label: status }))}
          onChange={value => set('status', value)}
        />
        <SelectField<Priority>
          label="Priority"
          value={chapter.priority}
          options={PRIORITIES.map(priority => ({ value: priority, label: priority }))}
          onChange={value => set('priority', value)}
        />
        <SelectField<ChapterImportance>
          label="Importance (drives weighted progress)"
          hint="Set in Settings → Exam → Weighted progress. Medium is the default for every chapter."
          value={chapter.importance ?? 'medium'}
          options={[{ value: 'high', label: 'High importance' }, { value: 'medium', label: 'Medium importance' }, { value: 'low', label: 'Low importance' }]}
          onChange={value => set('importance', value)}
        />
        <TextField label="Study notes" multiline maxLength={20000} value={chapter.notes} placeholder="What do you want to remember about this chapter?" onChangeText={value => set('notes', value)} />
        <TextField label="Formulas & shortcuts" multiline maxLength={20000} value={chapter.formula_notes} placeholder="Useful formulas, conditions, shortcuts…" onChangeText={value => set('formula_notes', value)} />
        {!isNew ? <ChapterStageEditor chapter={chapter} /> : null}
        <View style={styles.dialogActions}>
          <Button variant="secondary" onPress={onClose} disabled={saving}>Cancel</Button>
          <Button loading={saving} onPress={() => void save()} icon={<Check size={16} color={theme.colors.buttonPrimaryInk} />}>{isNew ? 'Add chapter' : 'Save notes'}</Button>
        </View>
      </ScrollView>
    </Dialog>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  searchRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }
})
