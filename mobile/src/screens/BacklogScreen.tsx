import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useData, type DataContextValue } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/AppearanceContext'
import { createId } from '../shared/lib/id'
import { indiaToday, plusDays, prettyDate } from '../shared/lib/date'
import { isAwake } from '../shared/lib/jee/reminders'
import { validateBacklog, type BacklogFormInput, type BacklogValue } from '../shared/lib/jee/forms'
import { BACKLOG_TYPES, type AppData, type BacklogItem, type BacklogType, type Priority, type Subject } from '../shared/types'
import { AlarmClock, Check, ChevronDown, ChevronUp, Pencil, Plus, Trash2, Undo2 } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Overlays'
import { Screen } from '../components/ui/Screen'
import { DateField, SelectField, TextField } from '../components/ui/Forms'
import { OverflowMenu } from '../components/ui/OverflowMenu'
import { EmptyState, NotebookCard, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'
import { ChapterSelect, ChipFilter, SubjectSelect } from '../components/jee/shared'

type GroupBy = 'due' | 'subject' | 'type' | 'priority'
type TypeFilter = 'all' | BacklogType

const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 }

/** Unfinished work in one place: skipped lectures, unsolved DPPs, and topics to come back to. */
export function BacklogScreen() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ add?: string }>()
  const { data, upsert, remove, refresh, syncState } = useData()
  const { notify } = useToast()
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [subject, setSubject] = useState<Subject | 'all'>('all')
  const [priority, setPriority] = useState<'all' | Priority>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('due')
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<BacklogItem | null>(null)
  const [creating, setCreating] = useState(params.add === '1')
  const today = indiaToday()
  const chapterById = useMemo(() => new Map(data.chapters.map(chapter => [chapter.id, chapter])), [data.chapters])

  const matches = (item: BacklogItem) => {
    if (typeFilter !== 'all' && item.type !== typeFilter) return false
    if (priority !== 'all' && item.priority !== priority) return false
    if (subject !== 'all') {
      const itemSubject = item.subject ?? (item.chapter_id ? chapterById.get(item.chapter_id)?.subject : null)
      if (itemSubject !== subject) return false
    }
    return true
  }
  const open = data.backlogItems.filter(item => item.status !== 'done' && matches(item))
  const active = open.filter(item => isAwake(item, today))
  const snoozed = open.filter(item => item.status === 'snoozed' && !isAwake(item, today))
  const completed = data.backlogItems.filter(item => item.status === 'done' && matches(item)).sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  const dueNow = active.filter(item => item.due_on !== null && item.due_on <= today)
  const overdueCount = dueNow.filter(item => item.due_on !== null && item.due_on < today).length

  const save = async (item: BacklogItem, patch: Partial<BacklogItem>) => {
    try {
      await upsert('backlog_items', { ...item, ...patch, updated_at: new Date().toISOString() })
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update the backlog item.', 'error')
    }
  }
  const complete = async (item: BacklogItem) => {
    await save(item, { status: 'done', completed_at: new Date().toISOString(), snoozed_until: null })
    notify('Backlog item cleared. Nice.')
  }
  const reopen = (item: BacklogItem) => save(item, { status: 'active', completed_at: null })
  const snooze = async (item: BacklogItem, days: number) => {
    await save(item, { status: 'snoozed', snoozed_until: plusDays(today, days) })
    notify(`Snoozed until ${prettyDate(plusDays(today, days))}.`)
  }
  const removeItem = async (item: BacklogItem) => {
    try {
      await remove('backlog_items', item)
      notify('Removed. Undo is available briefly.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not remove the item.', 'error')
    }
  }

  const groups = groupItems(active, groupBy, chapterById, today)

  const renderRow = (item: BacklogItem) => {
    const chapter = item.chapter_id ? chapterById.get(item.chapter_id) : undefined
    const itemSubject = item.subject ?? chapter?.subject ?? null
    const overdue = item.due_on !== null && item.due_on < today
    return (
      <View key={item.id} style={[styles.row, { borderBottomColor: theme.colors.line }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Mark ${item.title} done`} onPress={() => void complete(item)} style={[styles.check, { borderColor: theme.colors.lineStrong }]}>
          <Check size={14} color={theme.colors.muted} />
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[theme.type.label, { color: theme.colors.ink }]}>{item.title}</Text>
          <View style={styles.inline}>
            <StatusBadge tone="muted">{item.type}</StatusBadge>
            {itemSubject ? <SubjectBadge subject={itemSubject} /> : null}
            {chapter ? <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{chapter.name}</Text> : null}
            <Text style={[theme.type.badge, { color: item.priority === 'High' ? theme.colors.red : item.priority === 'Low' ? theme.colors.green : theme.colors.orange }]}>{item.priority}</Text>
            {item.due_on ? <Text style={[theme.type.badge, { color: overdue ? theme.colors.red : theme.colors.muted }]}>{overdue ? 'Overdue · ' : 'Due '}{prettyDate(item.due_on)}</Text> : null}
            {item.status === 'snoozed' && item.snoozed_until ? <Text style={[theme.type.badge, { color: theme.colors.muted }]}>Back {prettyDate(item.snoozed_until)}</Text> : null}
          </View>
          {item.notes ? <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{item.notes}</Text> : null}
        </View>
        <OverflowMenu label={`Actions for ${item.title}`} title="Backlog item" items={[
          { id: 'done', label: 'Mark done', icon: <Check size={15} color={theme.colors.ink} />, onSelect: () => void complete(item) },
          { id: 'snooze1', label: 'Come back tomorrow', icon: <AlarmClock size={15} color={theme.colors.ink} />, onSelect: () => void snooze(item, 1) },
          { id: 'snooze3', label: 'Come back in 3 days', icon: <AlarmClock size={15} color={theme.colors.ink} />, onSelect: () => void snooze(item, 3) },
          { id: 'snooze7', label: 'Come back in a week', icon: <AlarmClock size={15} color={theme.colors.ink} />, onSelect: () => void snooze(item, 7) },
          { id: 'edit', label: 'Edit', icon: <Pencil size={15} color={theme.colors.ink} />, onSelect: () => setEditing(item) },
          { id: 'delete', label: 'Delete', icon: <Trash2 size={15} color={theme.colors.red} />, danger: true, onSelect: () => void removeItem(item) }
        ]} />
      </View>
    )
  }

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader
        eyebrow="UNFINISHED WORK, IN ONE PLACE"
        title="Backlog"
        subtitle="Skipped lectures, unsolved DPPs, and topics to come back to. Anything due here is considered by “What should I study now?”."
        action={<Button onPress={() => setCreating(true)} icon={<Plus size={16} color={theme.colors.buttonPrimaryInk} />}>Add item</Button>}
      />
      <View style={styles.statGrid}>
        <Stat label="Due now" value={dueNow.length} note={overdueCount ? `${overdueCount} overdue` : 'nothing overdue'} />
        <Stat label="Open" value={active.length} note="active items" />
        <Stat label="Snoozed" value={snoozed.length} note="waiting to come back" />
        <Stat label="Cleared" value={data.backlogItems.filter(item => item.status === 'done').length} note="completed" />
      </View>

      <NotebookCard padding={14} style={{ gap: 12 }}>
        <ChipFilter<TypeFilter>
          label="Type"
          value={typeFilter}
          onChange={setTypeFilter}
          options={[{ value: 'all', label: 'All' }, ...BACKLOG_TYPES.map(type => ({ value: type, label: type === 'DPP' ? 'Unsolved DPPs' : type === 'Lecture' ? 'Skipped lectures' : 'Come back to' }))]}
        />
        <SubjectSelect value={subject} onChange={value => setSubject(value as Subject | 'all')} />
        <SelectField<'all' | Priority>
          label="Priority"
          value={priority}
          options={[{ value: 'all', label: 'Any priority' }, { value: 'High', label: 'High' }, { value: 'Medium', label: 'Medium' }, { value: 'Low', label: 'Low' }]}
          onChange={setPriority}
        />
        <SelectField<GroupBy>
          label="Group by"
          value={groupBy}
          options={[{ value: 'due', label: 'Due date' }, { value: 'subject', label: 'Subject' }, { value: 'type', label: 'Type' }, { value: 'priority', label: 'Priority' }]}
          onChange={setGroupBy}
        />
      </NotebookCard>

      {data.backlogItems.length === 0 ? (
        <NotebookCard>
          <EmptyState icon={<Check size={24} color={theme.colors.muted} />} title="The backlog is empty." description="Add a skipped lecture, an unsolved DPP, or a topic you want to revisit. Nothing is ever lost here." action={<Button variant="secondary" size="sm" onPress={() => setCreating(true)} icon={<Plus size={15} color={theme.colors.ink} />}>Add the first item</Button>} />
        </NotebookCard>
      ) : (
        <>
          {groups.length === 0 ? (
            <NotebookCard><EmptyState icon={<Check size={22} color={theme.colors.muted} />} title="Nothing open in this view." description="Clear the filters, or check snoozed items below." /></NotebookCard>
          ) : groups.map(group => (
            <View key={group.key} style={{ gap: 8 }}>
              <SectionHeading title={group.title} note={`${group.items.length} item${group.items.length === 1 ? '' : 's'}`} />
              <NotebookCard padding={12}>{group.items.map(renderRow)}</NotebookCard>
            </View>
          ))}
          {snoozed.length > 0 ? (
            <View style={{ gap: 8 }}>
              <SectionHeading title="Snoozed" note="These return automatically on their date." />
              <NotebookCard padding={12}>{snoozed.map(renderRow)}</NotebookCard>
            </View>
          ) : null}
          <NotebookCard padding={14} style={styles.doneToggle}>
            <View>
              <Text style={[theme.type.label, { color: theme.colors.ink }]}>Completed</Text>
              <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{completed.length} cleared item{completed.length === 1 ? '' : 's'}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDone }} onPress={() => setShowDone(value => !value)} style={styles.inline}>
              {showDone ? <ChevronUp size={15} color={theme.colors.accent} /> : <ChevronDown size={15} color={theme.colors.accent} />}
              <Text style={[theme.type.label, { color: theme.colors.accent }]}>{showDone ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </NotebookCard>
          {showDone ? (
            <NotebookCard padding={12}>
              {completed.slice(0, 60).map(item => (
                <View key={item.id} style={[styles.row, { borderBottomColor: theme.colors.line }]}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Reopen ${item.title}`} onPress={() => void reopen(item)} style={[styles.check, { borderColor: theme.colors.green, backgroundColor: theme.colors.greenBg }]}>
                    <Undo2 size={13} color={theme.colors.green} />
                  </Pressable>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[theme.type.label, { color: theme.colors.muted, textDecorationLine: 'line-through' }]}>{item.title}</Text>
                    <View style={styles.inline}>
                      <StatusBadge tone="muted">{item.type}</StatusBadge>
                      {item.completed_at ? <Text style={[theme.type.badge, { color: theme.colors.muted }]}>Cleared {prettyDate(item.completed_at.slice(0, 10))}</Text> : null}
                    </View>
                  </View>
                </View>
              ))}
            </NotebookCard>
          ) : null}
        </>
      )}

      {creating ? (
        <BacklogDialog data={data} onClose={() => { setCreating(false); if (params.add) router.setParams({ add: undefined }) }} upsert={upsert} onNotify={notify} />
      ) : null}
      {editing ? (
        <BacklogDialog data={data} existing={editing} onClose={() => setEditing(null)} upsert={upsert} onNotify={notify} />
      ) : null}
    </Screen>
  )
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  const theme = useTheme()
  return (
    <NotebookCard padding={14} style={styles.stat}>
      <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{label}</Text>
      <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 26, lineHeight: 28 }]}>{value}</Text>
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{note}</Text>
    </NotebookCard>
  )
}

/** Group open items. The keys keep groups in a meaningful order: overdue first, then dates ascending. */
function groupItems(items: BacklogItem[], groupBy: GroupBy, chapterById: Map<string, { subject: Subject }>, today: string) {
  const buckets = new Map<string, { key: string; title: string; sort: string; items: BacklogItem[] }>()
  const put = (key: string, title: string, sort: string, item: BacklogItem) => {
    const bucket = buckets.get(key) ?? { key, title, sort, items: [] }
    bucket.items.push(item)
    buckets.set(key, bucket)
  }
  for (const item of items) {
    if (groupBy === 'due') {
      if (item.due_on === null) put('none', 'No due date', '9', item)
      else if (item.due_on < today) put('overdue', 'Overdue', '0', item)
      else if (item.due_on === today) put('today', 'Due today', '1', item)
      else put(`d-${item.due_on}`, `Due ${prettyDate(item.due_on)}`, `2${item.due_on}`, item)
    } else if (groupBy === 'subject') {
      const name = String(item.subject ?? (item.chapter_id ? chapterById.get(item.chapter_id)?.subject : undefined) ?? 'General')
      put(name, name, String(['Physics', 'Chemistry', 'Maths', 'General'].indexOf(name)), item)
    } else if (groupBy === 'type') {
      put(item.type, item.type === 'DPP' ? 'Unsolved DPPs' : item.type === 'Lecture' ? 'Skipped lectures' : 'Come back to', String(BACKLOG_TYPES.indexOf(item.type)), item)
    } else {
      put(item.priority, `${item.priority} priority`, String(PRIORITY_RANK[item.priority]), item)
    }
  }
  return [...buckets.values()].sort((a, b) => a.sort.localeCompare(b.sort)).map(bucket => ({
    ...bucket,
    items: [...bucket.items].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') || a.title.localeCompare(b.title))
  }))
}

function BacklogDialog({ data, existing, onClose, upsert, onNotify }: {
  data: AppData
  existing?: BacklogItem
  onClose: () => void
  upsert: DataContextValue['upsert']
  onNotify: (message: string, tone?: 'info' | 'success' | 'error') => void
}) {
  const theme = useTheme()
  const chapter = existing?.chapter_id ? data.chapters.find(item => item.id === existing.chapter_id) : undefined
  const [form, setForm] = useState<BacklogFormInput>({
    title: existing?.title ?? '', type: existing?.type ?? 'Lecture', subject: existing?.subject ?? chapter?.subject ?? '',
    chapterId: existing?.chapter_id ?? '', priority: existing?.priority ?? 'Medium', dueOn: existing?.due_on ?? '', notes: existing?.notes ?? ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof BacklogFormInput>(key: K, value: BacklogFormInput[K]) => {
    setForm(current => ({ ...current, [key]: value }))
    setErrors(current => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }
  const submit = async () => {
    if (saving) return
    const result = validateBacklog(form)
    if (!result.ok) {
      setErrors(result.errors)
      onNotify('Check the highlighted fields.', 'error')
      return
    }
    setSaving(true)
    try {
      const now = new Date().toISOString()
      if (existing) {
        await upsert('backlog_items', { ...existing, ...(result.value as BacklogValue), updated_at: now })
        onNotify('Backlog item updated.')
      } else {
        await upsert('backlog_items', { id: createId(), ...(result.value as BacklogValue), status: 'active', snoozed_until: null, completed_at: null, created_at: now, updated_at: now })
        onNotify('Added to your backlog.')
      }
      onClose()
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Could not save the item.', 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog visible onClose={onClose} title={existing ? 'Edit backlog item' : 'Add to backlog'} subtitle="A skipped lecture, an unsolved DPP, or something to come back to.">
      <View style={{ gap: 14 }}>
        <TextField label="What is it?" required value={form.title} error={errors.title} maxLength={200} placeholder="e.g. Lecture 8 — EMI" onChangeText={value => set('title', value)} />
        <SelectField<BacklogType> label="Type" value={form.type} error={errors.type} options={BACKLOG_TYPES.map(type => ({ value: type, label: type }))} onChange={value => set('type', value)} />
        <SelectField<Priority> label="Priority" value={form.priority} options={[{ value: 'High', label: 'High' }, { value: 'Medium', label: 'Medium' }, { value: 'Low', label: 'Low' }]} onChange={value => set('priority', value)} />
        <SelectField<Subject | ''>
          label="Subject"
          value={form.subject}
          options={[{ value: '', label: 'General' }, { value: 'Physics', label: 'Physics' }, { value: 'Chemistry', label: 'Chemistry' }, { value: 'Maths', label: 'Maths' }]}
          onChange={value => { set('subject', value); set('chapterId', '') }}
        />
        <DateField label="Due date (optional)" value={form.dueOn} error={errors.dueOn} allowClear onChange={value => set('dueOn', value)} />
        <ChapterSelect chapters={data.chapters} value={form.chapterId} onChange={value => set('chapterId', value)} subject={form.subject || 'all'} label="Linked chapter (optional)" allowNone noneLabel="No chapter" />
        <TextField label="Notes (optional)" multiline value={form.notes} error={errors.notes} maxLength={5000} onChangeText={value => set('notes', value)} />
        <View style={styles.dialogActions}>
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button loading={saving} onPress={() => void submit()} icon={<Check size={16} color={theme.colors.buttonPrimaryInk} />}>{existing ? 'Save changes' : 'Add to backlog'}</Button>
        </View>
      </View>
    </Dialog>
  )
}

const styles = StyleSheet.create({
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexBasis: '47%', flexGrow: 1, gap: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  check: { width: 30, height: 30, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  doneToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }
})
