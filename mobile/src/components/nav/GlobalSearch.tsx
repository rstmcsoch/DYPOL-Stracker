import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { useData } from '../../contexts/DataContext'
import { useTheme } from '../../contexts/AppearanceContext'
import { BookOpen, Check, ListChecks, NotebookPen, Search, Sparkles } from '../icons'
import { Sheet } from '../ui/Overlays'
import { inputStyle } from '../ui/Forms'
import { useShell } from './ShellContext'

interface SearchResult { key: string; label: string; type: 'Chapter' | 'Test' | 'Mistake' | 'Task'; to: string; context: string }

/** Searches chapters, tests, mistakes, and tasks in the local cache, the same four collections the website searches. */
export function GlobalSearch() {
  const theme = useTheme()
  const router = useRouter()
  const shell = useShell()
  const { data } = useData()
  const [query, setQuery] = useState('')
  const trimmed = query.trim().toLowerCase()
  const results = useMemo<SearchResult[]>(() => {
    if (!trimmed) return []
    const found: SearchResult[] = []
    data.chapters
      .filter(chapter => `${chapter.name} ${chapter.subject} ${chapter.notes} ${chapter.formula_notes}`.toLowerCase().includes(trimmed))
      .slice(0, 6)
      .forEach(chapter => found.push({ key: `c-${chapter.id}`, label: chapter.name, type: 'Chapter', to: '/syllabus', context: `${chapter.subject} · ${chapter.status}` }))
    data.tests
      .filter(test => `${test.title} ${test.test_type} ${test.notes}`.toLowerCase().includes(trimmed))
      .slice(0, 5)
      .forEach(test => found.push({ key: `t-${test.id}`, label: test.title, type: 'Test', to: '/tests', context: `${test.test_date} · ${test.test_type}` }))
    data.mistakes
      .filter(mistake => `${mistake.question_note} ${mistake.solution_note} ${mistake.mistake_type}`.toLowerCase().includes(trimmed))
      .slice(0, 5)
      .forEach(mistake => found.push({ key: `m-${mistake.id}`, label: mistake.question_note, type: 'Mistake', to: '/mistakes', context: mistake.mistake_type }))
    data.tasks
      .filter(task => task.title.toLowerCase().includes(trimmed))
      .slice(0, 5)
      .forEach(task => found.push({ key: `k-${task.id}`, label: task.title, type: 'Task', to: '/planner', context: task.task_date }))
    return found.slice(0, 12)
  }, [data, trimmed])

  const close = () => {
    setQuery('')
    shell.closeSearch()
  }
  const open = (to: string) => {
    close()
    router.navigate(to as Href)
  }

  return (
    <Sheet visible={shell.searchOpen} onClose={close} title="Search your notebook" subtitle="Find chapters, tests, mistakes and tasks.">
      <View style={[styles.field, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
        <Search size={18} color={theme.colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Try ‘Current Electricity’…"
          placeholderTextColor={theme.colors.muted}
          accessibilityLabel="Search notebook"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={[inputStyle(theme), styles.input, { borderWidth: 0, backgroundColor: 'transparent' }]}
        />
      </View>
      <View style={styles.results}>
        {!trimmed ? (
          <View style={styles.hint}>
            <Sparkles size={17} color={theme.colors.muted} />
            <Text style={[theme.type.caption, { color: theme.colors.muted, flex: 1 }]}>Your notes stay private to your account.</Text>
          </View>
        ) : results.length ? results.map(result => (
          <Pressable
            key={result.key}
            accessibilityRole="button"
            accessibilityLabel={`${result.type}: ${result.label}`}
            onPress={() => open(result.to)}
            style={({ pressed }) => [styles.result, { borderColor: theme.colors.line, backgroundColor: pressed ? theme.colors.paperSoft : theme.colors.paper }]}
          >
            <View style={[styles.icon, { backgroundColor: theme.colors.paperSoft }]}>
              {result.type === 'Chapter' ? <BookOpen size={16} color={theme.colors.inkSoft} />
                : result.type === 'Test' ? <ListChecks size={16} color={theme.colors.inkSoft} />
                  : result.type === 'Mistake' ? <NotebookPen size={16} color={theme.colors.inkSoft} />
                    : <Check size={16} color={theme.colors.inkSoft} />}
            </View>
            <View style={styles.copy}>
              <Text numberOfLines={2} style={[theme.type.label, { color: theme.colors.ink }]}>{result.label}</Text>
              <Text numberOfLines={1} style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{result.context}</Text>
            </View>
            <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{result.type}</Text>
          </Pressable>
        )) : <Text style={[theme.type.caption, styles.empty, { color: theme.colors.muted }]}>No matches yet. Try another word.</Text>}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingLeft: 14, paddingRight: 6 },
  input: { flex: 1, minHeight: 46 },
  results: { marginTop: 12, gap: 8 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 56 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  empty: { paddingVertical: 14, textAlign: 'center' }
})
