import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { useFocus, type FocusMode } from '../contexts/FocusContext'
import { useData } from '../contexts/DataContext'
import { useTheme } from '../contexts/AppearanceContext'
import { indiaToday } from '../shared/lib/date'
import { STUDY_ACTIVITIES, SUBJECTS, type StudyActivity, type Subject } from '../shared/types'
import { ArrowLeft, BookOpen, CalendarCheck, Check, ChevronRight, Coffee, Focus, Link2, Moon, Pause, Play, RotateCcw, Search, Sparkles, Timer, X } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Sheet } from '../components/ui/Overlays'
import { Screen } from '../components/ui/Screen'
import { ProgressRing } from '../components/ui/Progress'
import { SelectField, inputStyle } from '../components/ui/Forms'
import { NotebookCard, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'

const MODES: { name: FocusMode; label: string; icon: (color: string) => React.ReactNode }[] = [
  { name: 'Pomodoro', label: 'Focus', icon: color => <Focus size={15} color={color} /> },
  { name: 'Short Break', label: 'Short break', icon: color => <Coffee size={15} color={color} /> },
  { name: 'Long Break', label: 'Long break', icon: color => <Moon size={15} color={color} /> },
  { name: 'Custom', label: 'Custom', icon: color => <Timer size={15} color={color} /> }
]

/** Focus mode: one block at a time, with the subject, chapter, and task that it belongs to. */
export function FocusScreen() {
  const theme = useTheme()
  const router = useRouter()
  const timer = useFocus()
  const { data } = useData()
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false)
  const [taskPickerOpen, setTaskPickerOpen] = useState(false)
  const [customDraft, setCustomDraft] = useState(String(timer.durations.Custom))
  const selectedTask = data.tasks.find(task => task.id === timer.taskId)
  const selectedChapter = data.chapters.find(chapter => chapter.id === timer.chapterId)
  const availableChapters = data.chapters.filter(chapter => !timer.subject || chapter.subject === timer.subject).sort((a, b) => a.position - b.position)
  const clock = `${String(Math.floor(timer.remainingSeconds / 60)).padStart(2, '0')}:${String(timer.remainingSeconds % 60).padStart(2, '0')}`
  const focusing = timer.mode === 'Pomodoro' || timer.mode === 'Custom'

  // Keep the screen on while a block runs, as the website's focus page does with its open tab.
  useEffect(() => {
    if (timer.running) void activateKeepAwakeAsync('stracker-focus').catch(() => undefined)
    else void deactivateKeepAwake('stracker-focus').catch(() => undefined)
    return () => { void deactivateKeepAwake('stracker-focus').catch(() => undefined) }
  }, [timer.running])

  // Keep the custom-minutes field in step with the saved value when it changes elsewhere.
  const [customSeen, setCustomSeen] = useState(timer.durations.Custom)
  if (customSeen !== timer.durations.Custom) {
    setCustomSeen(timer.durations.Custom)
    setCustomDraft(String(timer.durations.Custom))
  }

  const chooseSubject = (value: string) => {
    const nextSubject = value ? (value as Subject) : null
    timer.setSubject(nextSubject)
    const chapter = data.chapters.find(item => item.id === timer.chapterId)
    if (chapter && chapter.subject !== nextSubject) timer.setChapter(null)
  }

  const applyCustom = (value: string) => {
    setCustomDraft(value.replace(/[^0-9]/g, ''))
    const minutes = Number(value)
    if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 180) timer.setCustomMinutes(Math.round(minutes))
  }

  return (
    <Screen chrome={false}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Exit focus" onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} style={styles.exit}>
          <ArrowLeft size={17} color={theme.colors.inkSoft} />
          <Text style={[theme.type.label, { color: theme.colors.inkSoft }]}>Exit focus</Text>
        </Pressable>
        <View style={styles.wordmark}>
          <Text style={[theme.type.brand, { color: theme.colors.ink, fontSize: 16, lineHeight: 18 }]}>Stracker <Text style={{ color: theme.colors.accent, fontSize: 13 }}>focus mode</Text></Text>
        </View>
      </View>

      <View style={styles.intro}>
        <Text style={[theme.type.overline, { color: theme.colors.accent }]}>✳ MAKE THIS MOMENT COUNT ✦</Text>
        <Text accessibilityRole="header" style={[theme.type.display, { color: theme.colors.ink, fontSize: 32, lineHeight: 34 }]}>{focusing ? 'One thing at a time.' : 'Take the pause.'}</Text>
        <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>{focusing ? 'One clear block. Leave the rest for later.' : 'A pause is part of good preparation.'}</Text>
      </View>

      <View accessibilityRole="radiogroup" accessibilityLabel="Timer mode" style={styles.modes}>
        {MODES.map(mode => {
          const selected = timer.mode === mode.name
          const tint = selected ? theme.colors.accentDark : theme.colors.inkSoft
          return (
            <Pressable
              key={mode.name}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: timer.running }}
              disabled={timer.running}
              onPress={() => timer.switchMode(mode.name)}
              style={[styles.mode, { borderColor: selected ? theme.colors.accent : theme.colors.line, backgroundColor: selected ? theme.colors.accentLight : theme.colors.paper, opacity: timer.running && !selected ? 0.5 : 1 }]}
            >
              {mode.icon(tint)}
              <Text style={[theme.type.badge, { color: tint }]}>{mode.label}</Text>
            </Pressable>
          )
        })}
      </View>

      {timer.mode === 'Custom' ? (
        <View style={styles.customRow}>
          <Text style={[theme.type.label, { color: theme.colors.ink }]}>Custom focus minutes</Text>
          <TextInput
            accessibilityLabel="Custom focus minutes"
            value={customDraft}
            editable={!timer.running}
            keyboardType="number-pad"
            maxLength={3}
            onChangeText={applyCustom}
            style={[inputStyle(theme), styles.customInput]}
          />
        </View>
      ) : null}

      <View style={[styles.clockWrap, timer.finished ? { opacity: 1 } : null]}>
        <ProgressRing value={timer.progress} size={260} color={theme.colors.accent} label={clock} sublabel={timer.finished ? 'BLOCK COMPLETE' : timer.running ? 'STAY WITH THIS PAGE' : 'READY WHEN YOU ARE'} />
      </View>

      <View style={styles.actions}>
        {timer.running ? (
          <Button size="lg" variant="marker" onPress={timer.pause} icon={<Pause size={18} color={theme.colors.buttonPrimaryInk} />}>Pause</Button>
        ) : (
          <Button size="lg" variant="marker" onPress={timer.start} icon={<Play size={18} color={theme.colors.buttonPrimaryInk} />}>{timer.remainingSeconds > 0 && timer.remainingSeconds < timer.durations[timer.mode] * 60 ? 'Resume' : 'Start'}</Button>
        )}
        <Button variant="secondary" onPress={timer.reset} icon={<RotateCcw size={16} color={theme.colors.ink} />}>Reset</Button>
      </View>

      <NotebookCard padding={16} style={{ gap: 12 }}>
        <View style={styles.contextHead}>
          <BookOpen size={15} color={theme.colors.accent} />
          <Text style={[theme.type.overline, { color: theme.colors.muted, flex: 1 }]}>KEEP THIS BLOCK GROUNDED</Text>
          <StatusBadge tone="muted">Optional</StatusBadge>
        </View>
        <SelectField<StudyActivity>
          label="Activity"
          value={timer.activity}
          options={STUDY_ACTIVITIES.map(item => ({ value: item, label: item }))}
          onChange={value => timer.setActivity(value)}
        />
        <SelectField<string>
          label="Subject"
          value={timer.subject ?? ''}
          options={[{ value: '', label: 'Choose a subject' }, ...SUBJECTS.map(item => ({ value: item, label: item }))]}
          onChange={chooseSubject}
        />
        <Text style={[theme.type.label, { color: theme.colors.ink }]}>Chapter</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose a chapter" disabled={timer.running} onPress={() => setChapterPickerOpen(true)} style={[styles.picker, { borderColor: theme.colors.lineStrong, backgroundColor: theme.colors.paperSoft }]}>
          {selectedChapter ? (
            <>
              <Text numberOfLines={1} style={[theme.type.label, { color: theme.colors.ink, flex: 1 }]}>{selectedChapter.name}</Text>
              <SubjectBadge subject={selectedChapter.subject} />
            </>
          ) : (
            <Text style={[theme.type.caption, { color: theme.colors.muted, flex: 1 }]}>Search chapters…</Text>
          )}
          <Search size={14} color={theme.colors.muted} />
        </Pressable>
        <Text style={[theme.type.label, { color: theme.colors.ink }]}>Today’s task</Text>
        {selectedTask ? (
          <View style={styles.linkRow}>
            <Pressable accessibilityRole="button" disabled={timer.running} onPress={() => setTaskPickerOpen(true)} style={[styles.picker, styles.pickerGrow, { borderColor: theme.colors.green, backgroundColor: theme.colors.greenBg }]}>
              <Check size={14} color={theme.colors.green} />
              <Text numberOfLines={1} style={[theme.type.label, { color: theme.colors.ink, flex: 1 }]}>{selectedTask.title}</Text>
              <ChevronRight size={14} color={theme.colors.muted} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Unlink the current task" disabled={timer.running} onPress={() => timer.setTask(null)} style={styles.unlink}>
              <X size={16} color={theme.colors.muted} />
            </Pressable>
          </View>
        ) : (
          <Pressable accessibilityRole="button" disabled={timer.running} onPress={() => setTaskPickerOpen(true)} style={[styles.picker, { borderColor: theme.colors.lineStrong, borderStyle: 'dashed', backgroundColor: theme.colors.paperSoft }]}>
            <Link2 size={14} color={theme.colors.accent} />
            <Text style={[theme.type.label, { color: theme.colors.accent }]}>Link a task</Text>
          </Pressable>
        )}
        {selectedTask ? (
          <View style={[styles.currentTask, { borderColor: theme.colors.line }]}>
            <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 10.5 }]}>CURRENT TASK</Text>
            <Text style={[theme.type.label, { color: theme.colors.ink }]}>{selectedTask.title}</Text>
            {selectedChapter ? <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{selectedChapter.subject} · {selectedChapter.name}</Text> : null}
          </View>
        ) : null}
      </NotebookCard>

      <View style={styles.footerNote}>
        <Sparkles size={14} color={theme.colors.muted} />
        <Text style={[theme.type.caption, { color: theme.colors.muted, flex: 1 }]}>Your timer continues if you leave focus mode. Study time is logged when the focus block finishes.</Text>
      </View>

      <ChapterPicker
        visible={chapterPickerOpen}
        chapters={availableChapters}
        selectedId={timer.chapterId}
        onClose={() => setChapterPickerOpen(false)}
        onChoose={chapterId => { timer.setChapter(chapterId); setChapterPickerOpen(false) }}
      />
      <TaskPicker
        visible={taskPickerOpen}
        tasks={data.tasks.filter(task => task.task_date === indiaToday())}
        linkedId={timer.taskId}
        onClose={() => setTaskPickerOpen(false)}
        onChoose={taskId => { timer.setTask(taskId); setTaskPickerOpen(false) }}
      />
    </Screen>
  )
}

function ChapterPicker({ visible, chapters, selectedId, onClose, onChoose }: {
  visible: boolean
  chapters: { id: string; name: string; subject: Subject }[]
  selectedId: string | null
  onClose: () => void
  onChoose: (chapterId: string | null) => void
}) {
  const theme = useTheme()
  const [query, setQuery] = useState('')
  const trimmed = query.trim().toLowerCase()
  const results = useMemo(() => (trimmed ? chapters.filter(chapter => `${chapter.name} ${chapter.subject}`.toLowerCase().includes(trimmed)) : chapters), [chapters, trimmed])
  return (
    <Sheet visible={visible} onClose={onClose} title="Choose a chapter" subtitle="Type to search — results filter as you write.">
      <View style={[styles.search, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
        <Search size={17} color={theme.colors.muted} />
        <TextInput value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" placeholder="e.g. Current Electricity, Thermodynamics…" placeholderTextColor={theme.colors.muted} accessibilityLabel="Search chapters" style={[styles.searchInput, { color: theme.colors.ink, fontFamily: theme.fonts.body }]} />
      </View>
      {selectedId ? (
        <Pressable accessibilityRole="button" onPress={() => onChoose(null)} style={styles.clearRow}>
          <X size={14} color={theme.colors.accent} />
          <Text style={[theme.type.label, { color: theme.colors.accent }]}>Clear chapter choice</Text>
        </Pressable>
      ) : null}
      <View style={{ gap: 6 }}>
        {results.length === 0 ? (
          <Text style={[theme.type.caption, { color: theme.colors.muted, paddingVertical: 12 }]}>No chapter matches “{query.trim()}”. Try a shorter word, or a subject name like Chemistry.</Text>
        ) : results.map(chapter => (
          <Pressable key={chapter.id} accessibilityRole="button" accessibilityState={{ selected: chapter.id === selectedId }} onPress={() => onChoose(chapter.id)} style={[styles.option, { borderColor: theme.colors.line, backgroundColor: chapter.id === selectedId ? theme.colors.accentLight : theme.colors.paper }]}>
            <SubjectBadge subject={chapter.subject} />
            <Text style={[theme.type.label, { color: theme.colors.ink, flex: 1 }]}>{chapter.name}</Text>
            {chapter.id === selectedId ? <Check size={15} color={theme.colors.accent} /> : null}
          </Pressable>
        ))}
      </View>
      <Text style={[theme.type.caption, { color: theme.colors.muted, marginTop: 8 }]}>{results.length} chapter{results.length === 1 ? '' : 's'} available for this subject choice.</Text>
    </Sheet>
  )
}

function TaskPicker({ visible, tasks, linkedId, onClose, onChoose }: {
  visible: boolean
  tasks: { id: string; title: string; subject: Subject | null; is_completed: boolean }[]
  linkedId: string | null
  onClose: () => void
  onChoose: (taskId: string | null) => void
}) {
  const theme = useTheme()
  const open = tasks.filter(task => !task.is_completed)
  return (
    <Sheet visible={visible} onClose={onClose} title="Link a task" subtitle="Anchor this block to one of today’s planned tasks.">
      {open.length === 0 ? (
        <View style={styles.emptyTask}>
          <CalendarCheck size={17} color={theme.colors.muted} />
          <Text style={[theme.type.caption, { color: theme.colors.muted, flex: 1 }]}>No open tasks for today. Plan one in the Planner, then link it here.</Text>
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          {open.map(task => (
            <Pressable key={task.id} accessibilityRole="button" accessibilityState={{ selected: task.id === linkedId }} onPress={() => onChoose(task.id)} style={[styles.option, { borderColor: theme.colors.line, backgroundColor: task.id === linkedId ? theme.colors.accentLight : theme.colors.paper }]}>
              {task.subject ? <SubjectBadge subject={task.subject} /> : null}
              <Text style={[theme.type.label, { color: theme.colors.ink, flex: 1 }]}>{task.title}</Text>
              {task.id === linkedId ? <Check size={15} color={theme.colors.accent} /> : null}
            </Pressable>
          ))}
        </View>
      )}
      {linkedId ? (
        <Pressable accessibilityRole="button" onPress={() => onChoose(null)} style={[styles.clearRow, { marginTop: 10 }]}>
          <X size={14} color={theme.colors.accent} />
          <Text style={[theme.type.label, { color: theme.colors.accent }]}>Unlink the current task</Text>
        </Pressable>
      ) : null}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44 },
  exit: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 42 },
  wordmark: { flex: 1, alignItems: 'flex-end' },
  intro: { gap: 8, marginTop: 6, marginBottom: 6 },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  mode: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  customRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 },
  customInput: { width: 96, textAlign: 'center' },
  clockWrap: { alignItems: 'center', marginVertical: 16 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 },
  contextHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  picker: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  pickerGrow: { flex: 1 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unlink: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  currentTask: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 3 },
  footerNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 46 },
  searchInput: { flex: 1, fontSize: 16, minHeight: 44 },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, marginTop: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 50 },
  emptyTask: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }
})
