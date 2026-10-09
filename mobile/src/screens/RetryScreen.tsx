import { useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/AppearanceContext'
import { indiaDate, prettyDate } from '../shared/lib/date'
import type { MistakeType, Subject } from '../shared/types'
import { SUBJECTS } from '../shared/types'
import { ArrowLeft, Check, CircleCheck, Clock, RotateCcw, Search, Trash2, X } from '../components/icons'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/Overlays'
import { Screen } from '../components/ui/Screen'
import { SelectField, TextField } from '../components/ui/Forms'
import { EmptyState, NotebookCard, PageHeader, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'

const TYPES: MistakeType[] = ['Concept', 'Silly', 'Calculation', 'Time', 'Guess']

/** Questions waiting for a second attempt. Each one can be marked retried, kept for later, or deleted. */
export function RetryScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { data, upsert, remove, refresh, syncState } = useData()
  const { notify } = useToast()
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [chapterId, setChapterId] = useState('all')
  const [type, setType] = useState<'all' | MistakeType>('all')
  const [search, setSearch] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const ready = data.mistakes.filter(item => item.retry_later && item.retry_status === 'pending')
  const deleteTarget = data.mistakes.find(item => item.id === deleteId) ?? null
  const filtered = useMemo(() => ready.filter(mistake => {
    const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
    if (subject !== 'all' && chapter?.subject !== subject) return false
    if (chapterId !== 'all' && mistake.chapter_id !== chapterId) return false
    if (type !== 'all' && mistake.mistake_type !== type) return false
    if (search && !`${mistake.question_note} ${chapter?.name ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())) return false
    return true
  }).sort((a, b) => a.created_at.localeCompare(b.created_at)), [ready, data.chapters, subject, chapterId, type, search])
  const chapters = data.chapters.filter(item => subject === 'all' || item.subject === subject).sort((a, b) => a.name.localeCompare(b.name))

  const markRetried = async (mistakeId: string) => {
    const mistake = data.mistakes.find(item => item.id === mistakeId)
    if (!mistake) return
    try {
      await upsert('mistakes', { ...mistake, retry_later: false, retry_status: 'retried', updated_at: new Date().toISOString() })
      notify('Marked retried — that’s how a slip turns into recall.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update retry status.', 'error')
    }
  }
  const keepForLater = async (mistakeId: string) => {
    const mistake = data.mistakes.find(item => item.id === mistakeId)
    if (!mistake) return
    try {
      await upsert('mistakes', { ...mistake, retry_later: false, retry_status: 'pending', updated_at: new Date().toISOString() })
      notify('Moved back to the notebook. You can add it to retry again later.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update retry list.', 'error')
    }
  }
  const deleteMistake = async () => {
    if (!deleteId || deletingRef.current) return
    const mistake = data.mistakes.find(item => item.id === deleteId)
    if (!mistake) return
    deletingRef.current = true
    setDeleting(true)
    try {
      await remove('mistakes', mistake)
      notify('Mistake deleted. Use Undo if needed.')
      setDeleteId(null)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not delete mistake.', 'error')
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader
        eyebrow="RETURN, RETRIEVE, REMEMBER"
        title="Retry list"
        subtitle="Give the questions that caught you another honest attempt."
        action={<Button variant="secondary" size="sm" onPress={() => router.navigate('/mistakes')} icon={<ArrowLeft size={16} color={theme.colors.ink} />}>Mistakes</Button>}
      />
      <NotebookCard padding={16} style={{ gap: 8 }}>
        <View style={styles.row}>
          <View style={[styles.circle, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}><RotateCcw size={20} color={theme.colors.accent} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[theme.type.overline, { color: theme.colors.accent }]}>A SECOND LOOK</Text>
            <Text accessibilityRole="header" style={[theme.type.h3, { color: theme.colors.ink }]}>{ready.length} question{ready.length === 1 ? '' : 's'} waiting for you</Text>
          </View>
        </View>
        <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>Try again before reading the solution. Retrieval beats recognition.</Text>
      </NotebookCard>

      <NotebookCard padding={14} style={{ gap: 12 }}>
        <TextField
          label="Search retry notes"
          value={search}
          onChangeText={setSearch}
          placeholder="Search retry notes…"
          autoCorrect={false}
          leading={<Search size={16} color={theme.colors.muted} />}
          trailing={search ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')} style={styles.clear}>
              <X size={14} color={theme.colors.muted} />
            </Pressable>
          ) : undefined}
        />
        <SelectField<'all' | Subject>
          label="Subject"
          value={subject}
          options={[{ value: 'all', label: 'All subjects' }, ...SUBJECTS.map(item => ({ value: item, label: item }))]}
          onChange={value => { setSubject(value); setChapterId('all') }}
        />
        <SelectField<string>
          label="Chapter"
          value={chapterId}
          options={[{ value: 'all', label: 'All chapters' }, ...chapters.map(item => ({ value: item.id, label: item.name, description: item.subject }))]}
          onChange={setChapterId}
        />
        <SelectField<'all' | MistakeType>
          label="Mistake type"
          value={type}
          options={[{ value: 'all', label: 'All types' }, ...TYPES.map(item => ({ value: item, label: item }))]}
          onChange={setType}
        />
      </NotebookCard>

      {filtered.length === 0 ? (
        <NotebookCard>
          <EmptyState
            icon={<CircleCheck size={25} color={theme.colors.muted} />}
            title={ready.length ? 'Nothing in this view.' : 'Nothing waiting to retry.'}
            description={ready.length ? 'Try clearing a filter, or pick a different subject.' : 'When a question needs another pass, mark it “Retry later” in your mistake notebook.'}
            action={!ready.length ? <Button variant="secondary" size="sm" onPress={() => router.navigate('/mistakes')}>Open the mistake notebook</Button> : undefined}
          />
        </NotebookCard>
      ) : (
        <View style={{ gap: 10 }}>
          {filtered.map(mistake => {
            const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
            const test = data.tests.find(item => item.id === mistake.test_id)
            return (
              <NotebookCard key={mistake.id} padding={14} style={{ gap: 10 }}>
                <View style={styles.row}>
                  {chapter ? <SubjectBadge subject={chapter.subject} /> : <StatusBadge tone="bad">Chapter removed</StatusBadge>}
                  {chapter ? <Text style={[theme.type.label, { color: theme.colors.ink, flexShrink: 1 }]} numberOfLines={1}>{chapter.name}</Text> : null}
                  <StatusBadge tone="warn">{mistake.mistake_type}</StatusBadge>
                </View>
                <Text accessibilityRole="header" style={[theme.type.label, { color: theme.colors.ink }]}>{mistake.question_note}</Text>
                <View style={styles.row}>
                  <Clock size={13} color={theme.colors.muted} />
                  <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Added {prettyDate(indiaDate(mistake.created_at))}</Text>
                  {test ? <Text style={[theme.type.caption, { color: theme.colors.muted, flexShrink: 1 }]} numberOfLines={1}>· Original test: {test.title}</Text> : null}
                </View>
                {mistake.solution_note ? <RevealNote note={mistake.solution_note} /> : null}
                <View style={styles.actions}>
                  <Button size="sm" onPress={() => void markRetried(mistake.id)} icon={<Check size={15} color={theme.colors.buttonPrimaryInk} />}>Mark retried</Button>
                  <Pressable accessibilityRole="button" onPress={() => void keepForLater(mistake.id)} style={styles.textButton}>
                    <Text style={[theme.type.label, { color: theme.colors.accent }]}>Keep for later</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Delete question" onPress={() => setDeleteId(mistake.id)} style={styles.iconButton}>
                    <Trash2 size={15} color={theme.colors.red} />
                  </Pressable>
                </View>
              </NotebookCard>
            )
          })}
        </View>
      )}
      <Text style={[theme.type.caption, { color: theme.colors.muted, textAlign: 'center' }]}>A question marked “Retried” stays in your mistake notebook for future review.</Text>

      <ConfirmDialog
        visible={Boolean(deleteTarget)}
        title={`Delete “${(deleteTarget?.question_note ?? '').slice(0, 48)}${(deleteTarget?.question_note.length ?? 0) > 48 ? '…' : ''}”?`}
        message="This mistake note will be removed. You can undo for a few seconds."
        onCancel={() => setDeleteId(null)}
        onConfirm={() => void deleteMistake()}
        loading={deleting}
      />
    </Screen>
  )
}

function RevealNote({ note }: { note: string }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <View style={[styles.reveal, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={styles.revealHead}>
        <Text style={[theme.type.label, { color: theme.colors.accent }]}>{open ? 'Hide my note' : 'Reveal my note'}</Text>
      </Pressable>
      {open ? <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{note}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  circle: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  clear: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  textButton: { minHeight: 42, justifyContent: 'center' },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' },
  reveal: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 6 },
  revealHead: { minHeight: 36, justifyContent: 'center' }
})
