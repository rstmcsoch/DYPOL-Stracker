import { useMemo, useRef, useState } from 'react'
import { Image as RNImage, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { z } from 'zod'
import { useData } from '../contexts/DataContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/AppearanceContext'
import { indiaDate, prettyDate } from '../shared/lib/date'
import { createId } from '../shared/lib/id'
import type { Mistake, MistakeType, Subject } from '../shared/types'
import { CirclePlus, ImagePlus, NotebookPen, Plus, Search, Trash2, X } from '../components/icons'
import { Button, IconButton } from '../components/ui/Button'
import { ConfirmDialog, Dialog } from '../components/ui/Overlays'
import { Screen } from '../components/ui/Screen'
import { SelectField, SwitchRow, TextField } from '../components/ui/Forms'
import { EmptyState, NotebookCard, PageHeader, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'
import { ChipFilter } from '../components/jee/shared'
import { pickMistakePhoto } from '../lib/images'

const MISTAKE_TYPES: MistakeType[] = ['Concept', 'Silly', 'Calculation', 'Time', 'Guess']
const mistakeSchema = z.object({
  chapter_id: z.string().uuid(),
  mistake_type: z.enum(['Concept', 'Silly', 'Calculation', 'Time', 'Guess']),
  question_note: z.string().trim().min(1).max(10000),
  solution_note: z.string().max(10000)
})

/** Mistake notebook: each wrong answer kept with its reason, the lesson, an optional photo, and its retry state. */
export function MistakesScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { data, upsert, remove, refresh, syncState } = useData()
  const { notify } = useToast()
  const [search, setSearch] = useState('')
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [type, setType] = useState<'all' | MistakeType>('all')
  const [retryFilter, setRetryFilter] = useState<'all' | 'retry' | 'resolved'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Mistake | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Mistake | null>(null)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const term = search.trim().toLowerCase()
  const filtered = useMemo(() => data.mistakes.filter(mistake => {
    const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
    const text = `${mistake.question_note} ${mistake.solution_note} ${mistake.mistake_type} ${chapter?.name ?? ''}`.toLowerCase()
    if (term && !text.includes(term)) return false
    if (subject !== 'all' && chapter?.subject !== subject) return false
    if (type !== 'all' && mistake.mistake_type !== type) return false
    if (retryFilter === 'retry' && (!mistake.retry_later || mistake.retry_status !== 'pending')) return false
    if (retryFilter === 'resolved' && mistake.retry_status !== 'retried') return false
    return true
  }).sort((a, b) => b.created_at.localeCompare(a.created_at)), [data.mistakes, data.chapters, term, subject, type, retryFilter])
  const waiting = data.mistakes.filter(item => item.retry_later && item.retry_status === 'pending').length
  const retried = data.mistakes.filter(item => item.retry_status === 'retried').length

  const saveMistake = async (record: Mistake): Promise<Record<string, string> | null> => {
    const checked = mistakeSchema.safeParse(record)
    if (!checked.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of checked.error.issues) fieldErrors[String(issue.path[0] ?? 'form')] ??= issue.message
      return fieldErrors
    }
    try {
      await upsert('mistakes', { ...record, updated_at: new Date().toISOString() })
      notify(editing ? 'Mistake note updated.' : 'Saved to your mistake notebook.')
      setDialogOpen(false)
      setEditing(null)
      return null
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save mistake. Retry.', 'error')
      return null
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    try {
      await remove('mistakes', deleteTarget)
      notify('Mistake entry deleted. Use Undo if needed.')
      setDeleteTarget(null)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not delete this entry.', 'error')
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  const setRetry = async (mistake: Mistake, next: Partial<Mistake>, message: string) => {
    try {
      await upsert('mistakes', { ...mistake, ...next, updated_at: new Date().toISOString() })
      notify(message)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update retry status.', 'error')
    }
  }

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader
        eyebrow="THE BEST LEARNING HIDES HERE"
        title="Mistake notebook"
        subtitle="Keep the question, the reason, and what you’ll remember next time."
        action={<Button onPress={() => { setEditing(null); setDialogOpen(true) }} icon={<CirclePlus size={17} color={theme.colors.buttonPrimaryInk} />}>Add a mistake</Button>}
      />
      <View style={styles.overview}>
        <NotebookCard padding={14} style={styles.stat}>
          <NotebookPen size={18} color={theme.colors.accent} />
          <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 26, lineHeight: 28 }]}>{data.mistakes.length}</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>notes in your notebook</Text>
        </NotebookCard>
        <NotebookCard padding={14} style={styles.stat}>
          <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 26, lineHeight: 28 }]}>{waiting}</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>waiting for a retry</Text>
        </NotebookCard>
        <NotebookCard padding={14} style={styles.stat}>
          <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 26, lineHeight: 28 }]}>{retried}</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>retried</Text>
        </NotebookCard>
      </View>

      <NotebookCard padding={14} style={{ gap: 12 }}>
        <TextField label="Search mistake notes" value={search} onChangeText={setSearch} placeholder="Search question notes…" autoCorrect={false} leading={<Search size={17} color={theme.colors.muted} />} trailing={search ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')} style={styles.clear}><X size={14} color={theme.colors.muted} /></Pressable>
        ) : undefined} />
        <SelectField<'all' | Subject>
          label="Subject"
          value={subject}
          options={[{ value: 'all', label: 'All subjects' }, { value: 'Physics', label: 'Physics' }, { value: 'Chemistry', label: 'Chemistry' }, { value: 'Maths', label: 'Maths' }]}
          onChange={setSubject}
        />
        <SelectField<'all' | MistakeType>
          label="Mistake type"
          value={type}
          options={[{ value: 'all', label: 'All types' }, ...MISTAKE_TYPES.map(item => ({ value: item, label: item }))]}
          onChange={setType}
        />
        <ChipFilter<'all' | 'retry' | 'resolved'> label="Retry" value={retryFilter} onChange={setRetryFilter} options={[{ value: 'all', label: 'All' }, { value: 'retry', label: 'Retry later' }, { value: 'resolved', label: 'Retried' }]} />
      </NotebookCard>

      {filtered.length === 0 ? (
        <NotebookCard>
          <EmptyState
            icon={<NotebookPen size={25} color={theme.colors.muted} />}
            title={data.mistakes.length ? 'No notes match.' : 'Nothing here yet.'}
            description={data.mistakes.length ? 'Adjust a filter to find that note.' : 'Your mistake notebook will become one of your most useful study tools.'}
            action={!data.mistakes.length ? <Button variant="secondary" size="sm" onPress={() => { setEditing(null); setDialogOpen(true) }} icon={<Plus size={15} color={theme.colors.ink} />}>Save a learning moment</Button> : undefined}
          />
        </NotebookCard>
      ) : (
        <View style={{ gap: 10 }}>
          {filtered.map(mistake => {
            const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
            const linkedTest = data.tests.find(item => item.id === mistake.test_id)
            const image = mistake.image_data ?? mistake.image_preview
            return (
              <NotebookCard key={mistake.id} padding={14} style={{ gap: 10 }}>
                <View style={styles.topRow}>
                  <StatusBadge tone="warn">{mistake.mistake_type}</StatusBadge>
                  <Text style={[theme.type.caption, { color: theme.colors.muted, flex: 1 }]}>{prettyDate(indiaDate(mistake.created_at), { day: 'numeric', month: 'short' })}</Text>
                  <IconButton label="Delete mistake note" onPress={() => setDeleteTarget(mistake)}><Trash2 size={16} color={theme.colors.red} /></IconButton>
                </View>
                <View style={styles.tags}>
                  {chapter ? <><SubjectBadge subject={chapter.subject} /><Text style={[theme.type.caption, { color: theme.colors.inkSoft, flexShrink: 1 }]}>{chapter.name}</Text></> : <StatusBadge tone="bad">Chapter removed</StatusBadge>}
                  {linkedTest ? <Text style={[theme.type.badge, { color: theme.colors.muted }]}>From {linkedTest.title}</Text> : null}
                </View>
                <Text accessibilityRole="header" style={[theme.type.label, { color: theme.colors.ink }]}>{mistake.question_note}</Text>
                {mistake.solution_note ? (
                  <View style={[styles.solution, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
                    <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 10.5 }]}>WHAT I’LL REMEMBER</Text>
                    <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{mistake.solution_note}</Text>
                  </View>
                ) : null}
                {image ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Open attached image" onPress={() => setLightbox(image)} style={[styles.thumb, { borderColor: theme.colors.line }]}>
                    <RNImage source={{ uri: image }} style={styles.thumbImage} resizeMode="cover" accessibilityLabel="Attached question or working" />
                    <View style={styles.thumbLabel}><ImagePlus size={14} color={theme.colors.ink} /><Text style={[theme.type.badge, { color: theme.colors.ink }]}>View image</Text></View>
                  </Pressable>
                ) : null}
                <View style={styles.bottom}>
                  {mistake.retry_status === 'retried' ? <StatusBadge tone="good">Retried</StatusBadge> : mistake.retry_later ? <StatusBadge tone="warn">Retry later</StatusBadge> : <StatusBadge tone="muted">Notebook</StatusBadge>}
                  <View style={styles.actions}>
                    {mistake.retry_status === 'pending' ? (
                      <Pressable accessibilityRole="button" onPress={() => void setRetry(mistake, { retry_later: !mistake.retry_later }, mistake.retry_later ? 'Removed from the retry list.' : 'Added to your retry list.')} style={styles.textButton}>
                        <Text style={[theme.type.label, { color: theme.colors.accent }]}>{mistake.retry_later ? 'Keep in notes' : 'Retry later'}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable accessibilityRole="button" onPress={() => { setEditing(mistake); setDialogOpen(true) }} style={styles.textButton}>
                      <Text style={[theme.type.label, { color: theme.colors.ink }]}>Edit</Text>
                    </Pressable>
                  </View>
                </View>
              </NotebookCard>
            )
          })}
        </View>
      )}
      <Pressable accessibilityRole="link" onPress={() => router.navigate('/retry' as Href)} style={styles.linkRow}>
        <Text style={[theme.type.label, { color: theme.colors.accent }]}>{filtered.length} note{filtered.length === 1 ? '' : 's'} shown · Go to retry list</Text>
      </Pressable>

      {dialogOpen ? (
        <MistakeDialog key={editing?.id ?? 'new-mistake'} initial={editing} onClose={() => { setDialogOpen(false); setEditing(null) }} onSave={saveMistake} />
      ) : null}
      <ConfirmDialog
        visible={Boolean(deleteTarget)}
        title={`Delete “${(deleteTarget?.question_note ?? '').slice(0, 48)}${(deleteTarget?.question_note.length ?? 0) > 48 ? '…' : ''}”?`}
        message="The note and its attached image will be removed. You can undo the note deletion for a few seconds."
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        loading={deleting}
      />
      <Dialog visible={Boolean(lightbox)} onClose={() => setLightbox(null)} title="Question image">
        {lightbox ? <RNImage source={{ uri: lightbox }} style={styles.lightbox} resizeMode="contain" accessibilityLabel="Full size question or working" /> : null}
        <View style={{ alignItems: 'flex-end', marginTop: 12 }}>
          <Button variant="secondary" onPress={() => setLightbox(null)}>Close image</Button>
        </View>
      </Dialog>
    </Screen>
  )
}

function MistakeDialog({ initial, onClose, onSave }: { initial: Mistake | null; onClose: () => void; onSave: (mistake: Mistake) => Promise<Record<string, string> | null> }) {
  const theme = useTheme()
  const { data } = useData()
  const { notify } = useToast()
  const { user } = useAuth()
  const now = new Date().toISOString()
  const initialImageData = typeof initial?.image_data === 'string' && initial.image_data.startsWith('data:image/') ? initial.image_data : null
  const [entryId] = useState(() => initial?.id ?? createId())
  const [chapterId, setChapterId] = useState(initial?.chapter_id ?? '')
  const [testId, setTestId] = useState(initial?.test_id ?? '')
  const [mistakeType, setMistakeType] = useState<MistakeType>(initial?.mistake_type ?? 'Concept')
  const [question, setQuestion] = useState(initial?.question_note ?? '')
  const [solution, setSolution] = useState(initial?.solution_note ?? '')
  const [retryLater, setRetryLater] = useState(initial?.retry_later ?? false)
  const [imagePath, setImagePath] = useState<string | null>(initial?.image_path ?? null)
  const [imageData, setImageData] = useState<string | null>(initialImageData)
  const [imagePreview, setImagePreview] = useState<string | null>(initial?.image_preview ?? initialImageData)
  const [imagePending, setImagePending] = useState(initial?.image_pending ?? Boolean(initialImageData && !initial?.image_path && !user?.isLocal))
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [imageBusy, setImageBusy] = useState(false)
  const chapters = [...data.chapters].sort((a, b) => a.subject.localeCompare(b.subject) || a.position - b.position)
  const clearError = (key: string) => setErrors(current => {
    const next = { ...current }
    delete next[key]
    return next
  })

  const chooseImage = async () => {
    setImageBusy(true)
    try {
      const dataUrl = await pickMistakePhoto()
      if (!dataUrl) return
      // The photo travels with the note: the sync engine uploads it to the private bucket on save, or when a
      // queued change is flushed after reconnecting.
      setImagePath(null)
      setImageData(dataUrl)
      setImagePreview(dataUrl)
      setImagePending(!user?.isLocal)
      notify(user?.isLocal ? 'Compressed image ready to save on this device.' : 'Compressed image will upload when you save the note.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Image upload failed. Try again.', 'error')
    } finally {
      setImageBusy(false)
    }
  }

  const clearImage = () => {
    setImagePath(null)
    setImageData(null)
    setImagePreview(null)
    setImagePending(false)
  }

  const submit = async () => {
    if (imageBusy || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const next = {
      id: entryId, chapter_id: chapterId, test_id: testId || null, mistake_type: mistakeType,
      question_note: question.trim(), solution_note: solution.trim(), image_path: imagePath,
      image_data: imageData, image_preview: imagePreview, image_pending: imagePending,
      retry_later: retryLater, retry_status: initial?.retry_status ?? 'pending',
      created_at: initial?.created_at ?? now, updated_at: now,
      image_previous_path: initial?.image_path && initial.image_path !== imagePath ? initial.image_path : null
    } as Mistake
    try {
      const fieldErrors = await onSave(next)
      setErrors(fieldErrors ?? {})
      if (fieldErrors) notify('Please correct the highlighted mistake fields.', 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog visible onClose={onClose} title={initial ? 'Edit mistake note' : 'Save a learning moment'} subtitle="Small, specific notes are easier to revisit.">
      <View style={{ gap: 14 }}>
        <SelectField<string>
          label="Chapter"
          required
          value={chapterId}
          error={errors.chapter_id}
          options={[{ value: '', label: 'Choose a chapter' }, ...chapters.map(chapter => ({ value: chapter.id, label: chapter.name, description: chapter.subject }))]}
          onChange={value => { setChapterId(value); clearError('chapter_id') }}
        />
        <SelectField<MistakeType>
          label="Mistake type"
          value={mistakeType}
          options={MISTAKE_TYPES.map(item => ({ value: item, label: item }))}
          onChange={setMistakeType}
        />
        <TextField label="What was the question or mistake?" required multiline maxLength={10000} value={question} error={errors.question_note} placeholder="Write enough to recognize the question next time…" onChangeText={value => { setQuestion(value); clearError('question_note') }} />
        <TextField label="Solution / what I’ll remember" multiline maxLength={10000} value={solution} error={errors.solution_note} placeholder="The key idea, missed condition, or check to use next time…" onChangeText={value => { setSolution(value); clearError('solution_note') }} />
        <SelectField<string>
          label="Related test"
          value={testId}
          options={[{ value: '', label: 'No linked test' }, ...data.tests.map(test => ({ value: test.id, label: test.title, description: prettyDate(test.test_date) }))]}
          onChange={setTestId}
        />
        <SwitchRow label="Put this on the retry list" description="It will appear in the Retry list until you mark it retried." value={retryLater} onValueChange={setRetryLater} />
        <View style={{ gap: 6 }}>
          <Text style={[theme.type.label, { color: theme.colors.ink }]}>Question image <Text style={[theme.type.caption, { color: theme.colors.muted }]}>(optional · compressed before saving)</Text></Text>
          {imagePreview ? (
            <View style={[styles.preview, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
              <RNImage source={{ uri: imagePreview }} style={styles.previewImage} resizeMode="cover" accessibilityLabel="Selected question image preview" />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{imagePending ? 'Saved on this device, uploads on save' : 'Image attached'}</Text>
                <Pressable accessibilityRole="button" onPress={clearImage} style={styles.inline}>
                  <Trash2 size={14} color={theme.colors.red} />
                  <Text style={[theme.type.label, { color: theme.colors.red }]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => void chooseImage()} disabled={imageBusy} style={[styles.dropzone, { borderColor: theme.colors.lineStrong, backgroundColor: theme.colors.paperSoft }]}>
              <ImagePlus size={20} color={theme.colors.accent} />
              <Text style={[theme.type.label, { color: theme.colors.ink }]}>{imageBusy ? 'Preparing image…' : 'Add a photo'}</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.dialogActions}>
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button loading={busy} disabled={imageBusy} onPress={() => void submit()}>{initial ? 'Save note' : 'Add to notebook'}</Button>
        </View>
      </View>
    </Dialog>
  )
}

const styles = StyleSheet.create({
  overview: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, gap: 4 },
  clear: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  solution: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  thumb: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  thumbImage: { width: '100%', height: 180 },
  thumbLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  textButton: { minHeight: 40, justifyContent: 'center' },
  linkRow: { minHeight: 40, justifyContent: 'center', alignItems: 'center' },
  lightbox: { width: '100%', height: 360, borderRadius: 12 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 10 },
  previewImage: { width: 88, height: 88, borderRadius: 10 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dropzone: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, paddingVertical: 22, alignItems: 'center', gap: 8 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }
})
