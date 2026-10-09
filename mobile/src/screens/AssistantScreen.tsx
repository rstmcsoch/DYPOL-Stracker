import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter, usePathname, type Href } from 'expo-router'
import { format } from 'date-fns'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowUpRight, Check, CircleAlert, Clock3, History, KeyRound, LoaderCircle, MessageSquarePlus, RotateCcw, Send, ShieldCheck,
  Sparkles, Square, Trash2, X
} from '../components/icons'
import { AIProviderMark } from '../components/ai/AIProviderMark'
import { Button } from '../components/ui/Button'
import { ConfirmDialog, Sheet } from '../components/ui/Overlays'
import { Screen, TAB_BAR_HEIGHT } from '../components/ui/Screen'
import { NotebookCard, StatusBadge } from '../components/ui/Surfaces'
import { useTheme } from '../contexts/AppearanceContext'
import { useAI, type AIActionConfirmation, type AIMessage } from '../contexts/AIContext'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { providerLabel } from '../shared/lib/ai/catalog'

const SUGGESTIONS = [
  'How am I doing in each subject?',
  'Which chapters should I revise next?',
  'Summarize my recent test performance.',
  'Add a study task for today.'
]

function activeProviderLabel(providerId: string | undefined | null, providers: { provider_id: string; display_name: string }[]): string {
  if (!providerId) return 'AI Assistant'
  const configured = providers.find(item => item.provider_id === providerId)
  return configured?.display_name || providerLabel(providerId)
}

function clock(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : format(date, 'h:mm a')
}

/** Assistant replies may contain fenced code. Prose and code are rendered as separate blocks. */
function MessageBody({ content, tone }: { content: string; tone: 'user' | 'assistant' }) {
  const theme = useTheme()
  const safe = content.trim()
  if (!safe) return null
  const blocks = safe.split('```')
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          return (
            <View key={index} style={[styles.code, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperMuted }]}>
              <Text selectable style={[styles.codeText, { color: theme.colors.ink }]}>{block.replace(/^\w+\n/, '').trimEnd()}</Text>
            </View>
          )
        }
        if (!block.trim()) return null
        return (
          <Text key={index} selectable style={[theme.type.body, { color: tone === 'user' ? theme.colors.buttonPrimaryInk : theme.colors.ink }]}>
            {block}
          </Text>
        )
      })}
    </View>
  )
}

function ActionConfirmationCard({ action, messageId, now }: { action: AIActionConfirmation; messageId: string; now: number }) {
  const theme = useTheme()
  const { confirmAction } = useAI()
  const [decision, setDecision] = useState<'confirm' | 'cancel' | null>(null)
  const expired = Date.parse(action.expiresAt) <= now
  const fields = action.fields.filter(field => field && typeof field.label === 'string' && typeof field.value === 'string')
  const decide = async (choice: 'confirm' | 'cancel') => {
    setDecision(choice)
    const saved = await confirmAction(action.actionId, choice === 'confirm')
    if (!saved) setDecision(null)
  }
  return (
    <View accessibilityLabel={`Review before saving: ${action.title}`} style={[styles.confirm, { borderColor: theme.colors.line, backgroundColor: theme.colors.surfaceCool }]} testID={`confirm-${messageId}`}>
      <View style={styles.row}>
        <ShieldCheck size={17} color={theme.colors.surfaceCoolInk} />
        <View style={{ flex: 1 }}>
          <Text style={[theme.type.label, { color: theme.colors.surfaceCoolInk }]}>Review before saving</Text>
          <Text style={[theme.type.caption, { color: theme.colors.surfaceCoolMuted, fontSize: 12.5 }]}>Stracker will not make this change until you confirm.</Text>
        </View>
      </View>
      <Text style={[theme.type.label, { color: theme.colors.ink }]}>{action.title}</Text>
      {fields.map((field, index) => (
        <View key={`${field.label}-${index}`} style={styles.fieldLine}>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{field.label}</Text>
          <Text style={[theme.type.caption, { color: theme.colors.ink }]}>{field.value}</Text>
        </View>
      ))}
      {expired ? (
        <View style={styles.row}>
          <Clock3 size={14} color={theme.colors.muted} />
          <Text style={[theme.type.caption, { color: theme.colors.muted, flex: 1 }]}>This confirmation expired. Ask the assistant to prepare it again.</Text>
        </View>
      ) : (
        <View style={styles.confirmActions}>
          <Button size="sm" variant="secondary" disabled={decision !== null} loading={decision === 'cancel'} onPress={() => void decide('cancel')} icon={<X size={14} color={theme.colors.ink} />}>
            Cancel change
          </Button>
          <Button size="sm" disabled={decision !== null} loading={decision === 'confirm'} onPress={() => void decide('confirm')} icon={<Check size={14} color={theme.colors.buttonPrimaryInk} />}>
            Confirm & save
          </Button>
        </View>
      )}
    </View>
  )
}

function AssistantMessage({ message, now }: { message: AIMessage; now: number }) {
  const theme = useTheme()
  const router = useRouter()
  const { providers, retryLast } = useAI()
  const resultRoute = typeof message.result?.route === 'string' && message.result.route.startsWith('/') ? message.result.route : null
  const providerId = message.providerId ?? null
  const providerName = activeProviderLabel(providerId, providers)
  const fallbackName = message.fallbackFrom?.providerName || activeProviderLabel(message.fallbackFrom?.providerId, providers)
  const failed = message.status === 'failed'
  return (
    <View style={styles.assistantRow}>
      <AIProviderMark provider={providerId || 'custom'} small />
      <View style={[styles.assistantBody, failed ? { borderColor: theme.colors.red } : null]}>
        {message.content ? <MessageBody content={message.content} tone="assistant" /> : null}
        {message.status === 'running' && !message.content ? (
          <View style={styles.typing} accessibilityLabel="Assistant is responding"><ActivityIndicator size="small" color={theme.colors.muted} /></View>
        ) : null}
        {message.confirmation ? <ActionConfirmationCard action={message.confirmation} messageId={message.id} now={now} /> : null}
        {message.fallbackFrom && message.status === 'completed' ? (
          <View style={styles.row}>
            <ArrowUpRight size={13} color={theme.colors.muted} />
            <Text style={[theme.type.caption, { color: theme.colors.muted, flex: 1, fontSize: 12.5 }]}>
              Switched from {fallbackName} to {providerName}; this answer came from the displayed model.
            </Text>
          </View>
        ) : null}
        {message.result && message.status === 'completed' ? (
          <View style={styles.proof}>
            <View style={styles.row}>
              <Check size={14} color={theme.colors.green} />
              <Text style={[theme.type.caption, { color: theme.colors.green }]}>Saved and verified in Stracker</Text>
            </View>
            {resultRoute ? (
              <Button size="sm" variant="quiet" onPress={() => router.navigate(resultRoute as Href)} icon={<ArrowUpRight size={13} color={theme.colors.ink} />}>
                View in Stracker
              </Button>
            ) : null}
          </View>
        ) : null}
        {failed ? (
          <View style={styles.retry}>
            <View style={[styles.row, { flex: 1 }]}>
              <CircleAlert size={14} color={theme.colors.red} />
              <Text style={[theme.type.caption, { color: theme.colors.red, flex: 1 }]}>{message.error ?? 'The request did not complete.'}</Text>
            </View>
            {message.retryable !== false ? (
              <Button size="sm" variant="secondary" onPress={() => void retryLast()} icon={<RotateCcw size={14} color={theme.colors.ink} />}>Retry</Button>
            ) : null}
          </View>
        ) : null}
        {message.status === 'cancelled' ? (
          <View style={styles.row}>
            <Square size={12} color={theme.colors.muted} />
            <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Request stopped. No Stracker change was made.</Text>
          </View>
        ) : null}
        {providerId || message.status === 'completed' ? (
          <View style={styles.meta}>
            {providerId ? (
              <>
                <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{providerName}</Text>
                {message.modelId ? <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{message.modelId}</Text> : null}
              </>
            ) : null}
            {message.createdAt ? <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{clock(message.createdAt)}</Text> : null}
          </View>
        ) : null}
      </View>
    </View>
  )
}

function UserMessage({ message }: { message: AIMessage }) {
  const theme = useTheme()
  return (
    <View style={styles.userRow}>
      <View style={[styles.userBubble, { backgroundColor: theme.colors.buttonPrimaryBg, borderColor: theme.colors.buttonPrimaryBorder }]}>
        <MessageBody content={message.content} tone="user" />
        <Text style={[theme.type.caption, { color: theme.colors.buttonPrimaryInk, fontSize: 11.5, opacity: 0.8, textAlign: 'right' }]}>{clock(message.createdAt)}</Text>
      </View>
    </View>
  )
}

function Welcome({ configured, onSuggest }: { configured: boolean; onSuggest: (text: string) => void }) {
  const theme = useTheme()
  const router = useRouter()
  const { user } = useAuth()
  const { providers } = useAI()
  const { data } = useData()
  const defaultProvider = providers.find(provider => provider.is_default && provider.enabled && provider.connection_status === 'connected')
  const firstName = user?.displayName?.split(' ')[0]
  return (
    <View style={styles.welcome}>
      <View style={[styles.welcomeMark, { backgroundColor: theme.colors.surfaceCoolAccentBg }]}>
        <Sparkles size={22} color={theme.colors.accent} />
      </View>
      <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>A STUDY PARTNER, ON YOUR TERMS</Text>
      <Text accessibilityRole="header" style={[theme.type.h2, { color: theme.colors.ink }]}>
        {firstName ? `Hi, ${firstName}.` : 'Let’s make your next step clearer.'}
      </Text>
      <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>
        Ask about your saved tests, chapters, revisions, mistakes, or study plan. I’ll use your Stracker data—not invented estimates.
      </Text>
      {!configured ? (
        <NotebookCard style={styles.nudge}>
          <View style={styles.row}>
            <ShieldCheck size={17} color={theme.colors.surfaceTipInk} />
            <View style={{ flex: 1 }}>
              <Text style={[theme.type.label, { color: theme.colors.ink }]}>Connect your own AI provider to begin.</Text>
              <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>BYOK only · provider billing applies · no DYPOL-owned key</Text>
            </View>
          </View>
          <Button size="sm" variant="secondary" onPress={() => router.navigate('/settings' as Href)} icon={<KeyRound size={14} color={theme.colors.ink} />}>Set up AI</Button>
        </NotebookCard>
      ) : (
        <View style={styles.row}>
          <AIProviderMark provider={defaultProvider?.provider_id ?? 'gemini'} small />
          <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}>
            Using your preferred <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>{defaultProvider ? activeProviderLabel(defaultProvider.provider_id, providers) : 'configured provider'}</Text>
            {defaultProvider?.model_id ? ` · ${defaultProvider.model_id}` : ''}
          </Text>
        </View>
      )}
      {configured ? (
        <View style={styles.suggestions}>
          {SUGGESTIONS.map((suggestion, index) => (
            <Pressable
              key={suggestion}
              accessibilityRole="button"
              accessibilityLabel={suggestion}
              onPress={() => onSuggest(suggestion)}
              style={({ pressed }) => [styles.suggestion, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft, opacity: pressed ? 0.75 : 1 }]}
            >
              <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{`0${index + 1}`}</Text>
              <Text style={[theme.type.caption, { color: theme.colors.ink, flex: 1 }]}>{suggestion}</Text>
              <ArrowUpRight size={14} color={theme.colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {configured ? (
        <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>
          {data.chapters.length} chapters in your notebook. Only the data needed for a question is sent.
        </Text>
      ) : null}
    </View>
  )
}

function HistorySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme()
  const { recentConversations, recentTasks, conversationId, openConversation, newConversation, loadConversations, isBusy } = useAI()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const open = async (id: string) => {
    if (loadingId) return
    setLoadingId(id)
    try {
      await openConversation(id)
      onClose()
    } catch {
      // The conversation list stays as it was; the assistant screen shows any error from the open call.
    } finally {
      setLoadingId(null)
    }
  }
  return (
    <Sheet visible={visible} onClose={onClose} title="Recent chats" subtitle="Stored in your Stracker account.">
      <View style={{ gap: 12 }}>
        <View style={styles.row}>
          <Button size="sm" variant="secondary" onPress={() => { newConversation(); onClose() }} disabled={isBusy} icon={<MessageSquarePlus size={15} color={theme.colors.ink} />}>New conversation</Button>
          <Button size="sm" variant="quiet" onPress={() => void loadConversations()} icon={<RotateCcw size={14} color={theme.colors.ink} />}>Refresh</Button>
        </View>
        {recentConversations.length ? recentConversations.map(conversation => (
          <Pressable
            key={conversation.id}
            accessibilityRole="button"
            accessibilityState={{ selected: conversation.id === conversationId, disabled: loadingId !== null || isBusy }}
            accessibilityLabel={`Open ${conversation.title}`}
            disabled={loadingId !== null || isBusy}
            onPress={() => void open(conversation.id)}
            style={[styles.historyItem, { borderColor: conversation.id === conversationId ? theme.colors.accent : theme.colors.line, backgroundColor: theme.colors.paperSoft }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[theme.type.label, { color: theme.colors.ink }]} numberOfLines={1}>{conversation.title}</Text>
              <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{format(new Date(conversation.updated_at), 'd MMM')}</Text>
            </View>
            {loadingId === conversation.id ? <LoaderCircle size={14} color={theme.colors.muted} /> : <ArrowUpRight size={14} color={theme.colors.muted} />}
          </Pressable>
        )) : <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Your saved conversations will appear here.</Text>}
        <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11, marginTop: 6 }]}>RECENT AI TASKS</Text>
        {recentTasks.length ? recentTasks.slice(0, 5).map(task => (
          <View key={task.id} style={[styles.historyItem, { borderColor: theme.colors.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={[theme.type.label, { color: theme.colors.ink }]} numberOfLines={1}>{task.progress || task.task_type}</Text>
              <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>
                {`${activeProviderLabel(task.provider_id, [])}${task.model_id ? ` · ${task.model_id}` : ''}`}
              </Text>
            </View>
            <StatusBadge tone={task.status === 'completed' ? 'good' : task.status === 'failed' ? 'bad' : task.status === 'cancelled' ? 'muted' : 'warn'}>
              {task.status.replaceAll('_', ' ')}
            </StatusBadge>
          </View>
        )) : <Text style={[theme.type.caption, { color: theme.colors.muted }]}>No AI tasks saved yet.</Text>}
      </View>
    </Sheet>
  )
}

/** The full assistant: conversation, provider status, confirmations, and the composer. */
export function AssistantScreen() {
  const theme = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const { notify } = useToast()
  const ai = useAI()
  const { providers, backendStatus, messages, activeTask, isBusy, lastRequest, sendMessage, retryLast, stopTask, conversationId, conversationTitle, clearConversation, newConversation, loadConversations, loadTasks } = ai
  const [value, setValue] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  // A clock for expiry checks. It refreshes every 15 seconds, so an expired confirmation turns over on its own.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const listRef = useRef<FlatList<AIMessage>>(null)
  const nearBottom = useRef(true)
  const configured = useMemo(() => providers.some(provider => provider.enabled && provider.connection_status === 'connected'), [providers])
  const enabledNames = useMemo(() => providers.filter(provider => provider.enabled).map(provider => provider.display_name || providerLabel(provider.provider_id)), [providers])

  useEffect(() => {
    void loadConversations()
    void loadTasks()
    // Load the history once when the assistant opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = (text: string) => {
    if (isBusy) {
      if (activeTask?.cancellable !== false) stopTask()
      return
    }
    const trimmed = text.trim()
    if (!trimmed) {
      if (lastRequest) void retryLast()
      return
    }
    setValue('')
    void sendMessage(trimmed, pathname)
  }

  const sendButton = (() => {
    if (isBusy) {
      const locked = activeTask?.cancellable === false
      return {
        label: locked ? 'Confirmed change is being saved' : 'Stop the current AI task',
        disabled: locked,
        icon: locked ? <LoaderCircle size={15} color={theme.colors.buttonPrimaryInk} /> : <Square size={15} color={theme.colors.buttonPrimaryInk} />,
        onPress: () => send('')
      }
    }
    if (value.trim()) return { label: 'Send message', disabled: false, icon: <Send size={16} color={theme.colors.buttonPrimaryInk} />, onPress: () => send(value) }
    if (lastRequest) return { label: 'Retry last request', disabled: false, icon: <RotateCcw size={15} color={theme.colors.buttonPrimaryInk} />, onPress: () => send('') }
    return { label: 'Send message', disabled: true, icon: <Send size={16} color={theme.colors.buttonPrimaryInk} />, onPress: () => undefined }
  })()

  const clear = async () => {
    if (clearing) return
    setClearing(true)
    try {
      await clearConversation()
      setClearOpen(false)
      notify('Conversation cleared.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Conversation could not be cleared.', 'error')
    } finally {
      setClearing(false)
    }
  }

  const header = (
    <View style={[styles.header, { borderBottomColor: theme.colors.line }]}>
      <View style={styles.brand}>
        <View style={[styles.brandMark, { backgroundColor: theme.colors.surfaceCoolAccentBg }]}>
          <Sparkles size={16} color={theme.colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[theme.type.label, { color: theme.colors.ink }]} numberOfLines={1}>
            {conversationId ? conversationTitle : 'Stracker AI'}
          </Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]} numberOfLines={1}>
            {conversationId ? (configured ? `Ready${enabledNames.length ? ` · ${enabledNames[0]}` : ''}` : 'Your study copilot') : configured ? `Ready${enabledNames.length ? ` · ${enabledNames[0]}` : ''}` : 'Your study copilot'}
          </Text>
        </View>
      </View>
      <View style={styles.tools}>
        {conversationId ? (
          <ToolButton label="Start a new conversation" disabled={isBusy} onPress={() => newConversation()} icon={<MessageSquarePlus size={18} color={theme.colors.ink} />} />
        ) : null}
        <ToolButton label="Conversation history" onPress={() => setHistoryOpen(true)} icon={<History size={18} color={theme.colors.ink} />} />
        <ToolButton label="Clear this conversation" disabled={!conversationId || isBusy} onPress={() => setClearOpen(true)} icon={<Trash2 size={18} color={theme.colors.ink} />} />
        <ToolButton label="Open AI provider settings" onPress={() => router.navigate('/settings' as Href)} icon={<KeyRound size={18} color={theme.colors.ink} />} />
      </View>
    </View>
  )

  return (
    <Screen scroll={false} contentStyle={[styles.frame, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom }]}>
      {header}

      {backendStatus === 'misconfigured' ? (
        <Notice text="The Stracker AI backend is not configured for this deployment. The administrator must finish the server setup before AI can run." />
      ) : null}
      {backendStatus === 'unreachable' ? (
        <Notice text="The Stracker AI backend is unavailable. The deployed app has no /api/ai functions." />
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (item.role === 'user' ? <UserMessage message={item} /> : <AssistantMessage message={item} now={now} />)}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Welcome configured={configured} onSuggest={text => send(text)} />}
        onScroll={event => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
          nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 120
        }}
        scrollEventThrottle={64}
        onContentSizeChange={() => { if (nearBottom.current) listRef.current?.scrollToEnd({ animated: true }) }}
        accessibilityRole="list"
        accessibilityLabel="AI conversation"
      />

      {activeTask && isBusy ? (
        <View style={[styles.taskRow, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]} accessibilityLiveRegion="polite">
          <LoaderCircle size={14} color={theme.colors.muted} />
          <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}>{activeTask.progress}</Text>
          {activeTask.providerId ? (
            <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>
              {`${activeProviderLabel(activeTask.providerId, providers)}${activeTask.modelId ? ` · ${activeTask.modelId}` : ''}`}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.composerWrap, { borderTopColor: theme.colors.line, backgroundColor: theme.colors.paper }]}>
        <View style={[styles.composer, { borderColor: theme.colors.lineStrong, backgroundColor: theme.colors.paperSoft }]}>
          <TextInput
            value={value}
            onChangeText={setValue}
            multiline
            maxLength={4000}
            editable={configured && !isBusy}
            placeholder={configured ? 'Ask about your study progress…' : 'Connect an AI provider in Settings first'}
            placeholderTextColor={theme.colors.muted}
            accessibilityLabel="Message Stracker AI"
            style={[styles.input, { color: theme.colors.ink, fontFamily: theme.fonts.body }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sendButton.label}
            disabled={sendButton.disabled}
            onPress={sendButton.onPress}
            style={({ pressed }) => [styles.sendButton, { backgroundColor: theme.colors.buttonPrimaryBg, opacity: sendButton.disabled ? 0.5 : pressed ? 0.8 : 1 }]}
          >
            {sendButton.icon}
          </Pressable>
        </View>
        <View style={styles.composerFooter}>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 11.5, flex: 1 }]}>{`${value.length}/4000 · Your provider handles AI processing and billing.`}</Text>
          <ShieldCheck size={12} color={theme.colors.muted} />
        </View>
      </View>

      <ConfirmDialog
        visible={clearOpen}
        title="Clear this conversation?"
        message="This removes the saved messages from your Stracker account. It does not change your study data or provider settings."
        confirmLabel="Clear conversation"
        loading={clearing}
        onConfirm={() => void clear()}
        onCancel={() => { if (!clearing) setClearOpen(false) }}
      />
      <HistorySheet visible={historyOpen} onClose={() => setHistoryOpen(false)} />
    </Screen>
  )
}

function ToolButton({ label, onPress, icon, disabled = false }: { label: string; onPress: () => void; icon: ReactNode; disabled?: boolean }) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tool, { borderColor: theme.colors.line, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 }]}
    >
      {icon}
    </Pressable>
  )
}

function Notice({ text }: { text: string }) {
  const theme = useTheme()
  return (
    <View accessibilityRole="alert" style={[styles.notice, { borderColor: theme.colors.red, backgroundColor: theme.colors.redBg }]}>
      <CircleAlert size={15} color={theme.colors.red} />
      <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { flex: 1, paddingHorizontal: 0, paddingTop: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  brandMark: { width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tool: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 10, margin: 12 },
  listContent: { flexGrow: 1, padding: 14, gap: 14 },
  welcome: { gap: 12, paddingVertical: 12 },
  welcomeMark: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  nudge: { gap: 10 },
  suggestions: { gap: 8 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userRow: { alignItems: 'flex-end' },
  userBubble: { maxWidth: '86%', borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10, gap: 4 },
  assistantRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  assistantBody: { flex: 1, gap: 10, minWidth: 0 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  typing: { paddingVertical: 4 },
  code: { borderWidth: 1, borderRadius: 10, padding: 10 },
  codeText: { fontFamily: 'monospace', fontSize: 13, lineHeight: 19 },
  confirm: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  confirmActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  fieldLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  proof: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  retry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  composerWrap: { borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, gap: 6 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderWidth: 1, borderRadius: 16, paddingLeft: 12, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, maxHeight: 120, fontSize: 16, lineHeight: 22, paddingTop: 8, paddingBottom: 8 },
  sendButton: { width: 42, height: 42, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  composerFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyItem: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 }
})
