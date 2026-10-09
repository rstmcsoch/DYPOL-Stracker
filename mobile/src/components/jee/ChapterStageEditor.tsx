import { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { useData } from '../../contexts/DataContext'
import { useToast } from '../../contexts/ToastContext'
import { useTheme } from '../../contexts/AppearanceContext'
import { chapterStages } from '../../shared/lib/jee/progress'
import { chapterStageId } from '../../shared/lib/jee/ids'
import type { Chapter, ChapterStageKey } from '../../shared/types'
import { ArrowUpRight, Check } from '../icons'
import { StagePipeline } from './shared'

const TOGGLEABLE: { key: Exclude<ChapterStageKey, 'pyqs'>; label: string; hint: string }[] = [
  { key: 'theory', label: 'Theory read', hint: 'You have been through the theory once.' },
  { key: 'notes', label: 'Notes made', hint: 'Your own notes exist for this chapter.' },
  { key: 'revised', label: 'Revised', hint: 'Also set automatically when a revision is completed.' },
  { key: 'tested', label: 'Tested', hint: 'Also set automatically when a test result is logged.' }
]

/** Chapter pipeline: Theory → Notes → PYQs → Revised → Tested. Each stage is independent of the others. */
export function ChapterStageEditor({ chapter }: { chapter: Chapter }) {
  const theme = useTheme()
  const router = useRouter()
  const { data, upsert } = useData()
  const { notify } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const stages = useMemo(() => chapterStages(data, chapter), [data, chapter])
  const userId = data.settings.user_id ?? data.settings.id
  const pyq = stages.find(stage => stage.key === 'pyqs')

  const toggle = async (key: Exclude<ChapterStageKey, 'pyqs'>, current: boolean) => {
    if (busy) return
    setBusy(key)
    const now = new Date().toISOString()
    const existing = data.chapterStages.find(row => row.chapter_id === chapter.id && row.stage === key)
    try {
      await upsert('chapter_stages', {
        id: chapterStageId(userId, chapter.id, key), chapter_id: chapter.id, stage: key, done: !current,
        completed_at: !current ? now : null, created_at: existing?.created_at ?? now, updated_at: now
      })
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update this stage.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <View accessibilityLabel="Learning stages" style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>LEARNING STAGES</Text>
        <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>Independent — order is up to you</Text>
      </View>
      <StagePipeline stages={stages} />
      <View style={{ gap: 8 }}>
        {TOGGLEABLE.map(item => {
          const state = stages.find(stage => stage.key === item.key)
          const done = state?.done ?? false
          return (
            <Pressable
              key={item.key}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done, disabled: busy !== null }}
              accessibilityHint={item.hint}
              disabled={busy !== null}
              onPress={() => void toggle(item.key, done)}
              style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, borderWidth: 1, borderRadius: 12, padding: 10 }, { borderColor: done ? theme.colors.green : theme.colors.line, backgroundColor: done ? theme.colors.greenBg : theme.colors.paperSoft }]}
            >
              <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: done ? theme.colors.green : theme.colors.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? theme.colors.green : 'transparent' }}>
                {done ? <Check size={13} strokeWidth={3} color={theme.colors.paper} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[theme.type.label, { color: theme.colors.ink }]}>{item.label}</Text>
                <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{state?.source === 'evidence' ? 'from your records' : item.hint}</Text>
              </View>
            </Pressable>
          )
        })}
      </View>
      {pyq ? (
        <Pressable accessibilityRole="link" onPress={() => router.navigate('/pyqs' as Href)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 }}>
          <Text style={[theme.type.label, { color: theme.colors.accent }]}>PYQs: {Math.round(pyq.progress * 100)}% done — open the PYQ tracker</Text>
          <ArrowUpRight size={13} color={theme.colors.accent} />
        </Pressable>
      ) : null}
    </View>
  )
}
