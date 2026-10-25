import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUpRight, Check, ChevronDown, CircleAlert, Plus, Clock3, History, LoaderCircle, Maximize2, MessageSquarePlus, Minimize2, Minus, RefreshCw, RotateCcw, Send, Settings as SettingsIcon, ShieldCheck, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useAI, type AIActionConfirmation, type AIMessage } from '../../contexts/AIContext'
import { providerLabel } from '../../lib/ai/catalog'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { Button, Dialog, IconButton, StatusBadge } from '../ui'
import { AIProviderMark } from './AIProviderMark'
import { STRACKER_AI_NAME, StrackerUnavailableNotice } from './StrackerAIRow'
import { CopyButton } from './markdown/CopyButton'

// The Markdown/GFM renderer is its own chunk (KaTeX is a further chunk loaded only for math),
// so neither the public site nor the notebook's first load grows.
const loadMarkdown = () => import('./markdown/AIMarkdown')
const AIMarkdown = lazy(loadMarkdown)
import { useScrollExpanded } from '../../lib/ui/scroll-expand'
import { useExit } from '../../lib/ui/use-exit'
import { isSafeAppPath } from '../../lib/safe-path'

const SUGGESTIONS = [
  'How am I doing in each subject?',
  'Which chapters should I revise next?',
  'Summarize my recent test performance.',
  'Add a study task for today.'
]

/** Settings link that opens the "add your own model" editor straight away. */
export const ADD_OWN_MODEL_PATH = '/settings?add-ai=1#ai-provider-settings'
export const AI_SETTINGS_PATH = '/settings#ai-provider-settings'

function activeProviderLabel(providerId:string|undefined|null,providers:Array<{provider_id:string;display_name:string}>):string {
  if (!providerId) return 'AI Assistant'
  if (providerId === 'stracker') return STRACKER_AI_NAME
  const configured = providers.find(item => item.provider_id === providerId)
  return configured?.display_name || providerLabel(providerId)
}

/**
 * Which AI answers next: Stracker AI (Default) unless the student prefers (and has) their own
 * working model. When the default is unavailable, their own models take over automatically.
 */
function useActiveAI() {
  const { providers,stracker,preference } = useAI()
  return useMemo(() => {
    const own = providers.filter(provider => provider.enabled && provider.connection_status === 'connected')
    const ownPreferred = own.find(provider => provider.is_default) ?? own[0] ?? null
    const strackerReady = stracker?.status === 'ready'
    const useStracker = strackerReady && (preference === 'stracker' || !ownPreferred)
    const active = useStracker
      ? { providerId:'stracker',name:STRACKER_AI_NAME,model:stracker?.model ?? null }
      : ownPreferred ? { providerId:ownPreferred.provider_id,name:ownPreferred.display_name || providerLabel(ownPreferred.provider_id),model:ownPreferred.model_id } : null
    return { configured:Boolean(active),active,strackerUnavailable:stracker?.status === 'unavailable',hasOwn:own.length > 0 }
  },[providers,stracker,preference])
}

/** AI answers: full Markdown (plain text shows until the renderer chunk arrives). */
function MessageBody({ content,streaming=false }: { content:string;streaming?:boolean }) {
  const safe = content.trim()
  if (!safe) return null
  return <div className="ai-message-body"><Suspense fallback={<span className="ai-message-prose">{safe}</span>}><AIMarkdown content={safe} streaming={streaming} /></Suspense></div>
}

/** The student's own message: plain text with its line breaks kept. */
function PlainBody({ content }: { content:string }) {
  return <div className="ai-message-body ai-message-plain"><span className="ai-message-prose">{content}</span></div>
}

function ActionConfirmationCard({ action,messageId }: { action:AIActionConfirmation; messageId:string }) {
  const { confirmAction } = useAI()
  const [decision,setDecision] = useState<'confirm'|'cancel'|null>(null)
  const expired = Date.parse(action.expiresAt) <= Date.now()
  const fields = action.fields.filter(field => field && typeof field.label === 'string' && typeof field.value === 'string')
  const decide = async (choice:'confirm'|'cancel') => {
    setDecision(choice)
    const saved = await confirmAction(action.actionId,choice === 'confirm')
    if (!saved) setDecision(null)
  }
  return <section className="ai-confirm-card" aria-labelledby={`ai-confirm-title-${messageId}`}>
    <div className="ai-confirm-heading"><span className="ai-confirm-icon"><ShieldCheck size={17} /></span><div><strong id={`ai-confirm-title-${messageId}`}>Review before saving</strong><small>Stracker will not make this change until you confirm.</small></div></div>
    <div className="ai-confirm-summary"><strong>{action.title}</strong>{fields.length > 0 && <dl>{fields.map((field,index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}</div>
    {expired ? <p className="ai-confirm-expired"><Clock3 size={14} /> This confirmation expired. Ask the assistant to prepare it again.</p> : <div className="ai-confirm-actions"><Button size="sm" variant="secondary" disabled={decision !== null} onClick={() => void decide('cancel')}>{decision === 'cancel' ? <LoaderCircle size={14} className="spin" /> : <X size={14} />} Cancel change</Button><Button size="sm" disabled={decision !== null} onClick={() => void decide('confirm')}>{decision === 'confirm' ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Confirm & save</Button></div>}
  </section>
}

function AssistantMessage({ message }: { message:AIMessage }) {
  const { providers,retryLast } = useAI()
  const navigate = useNavigate()
  const resultRoute = typeof message.result?.route === 'string' && isSafeAppPath(message.result.route) ? message.result.route : null
  const providerId = message.providerId ?? null
  const providerName = activeProviderLabel(providerId,providers)
  const fallbackName = message.fallbackFrom?.providerName || activeProviderLabel(message.fallbackFrom?.providerId,providers)
  return <article className={`ai-message ai-message-assistant ${message.status === 'failed' ? 'is-error' : ''}`}>
    <div className="ai-message-avatar"><AIProviderMark provider={providerId || 'custom'} small /></div>
    <div className="ai-message-main">
      {message.content && <MessageBody content={message.content} streaming={message.status === 'running'} />}
      {message.status === 'running' && !message.content && <div className="ai-typing-indicator" aria-label="Assistant is responding"><i /><i /><i /></div>}
      {message.confirmation && <ActionConfirmationCard action={message.confirmation} messageId={message.id} />}
      {message.fallbackFrom && message.status === 'completed' && <div className="ai-fallback-note"><ArrowUpRight size={13} /><span>Switched from {fallbackName} to {providerName}; this answer came from the displayed model.</span></div>}
      {message.result && message.status === 'completed' && <div className="ai-result-proof"><span><Check size={14} /> Saved and verified in Stracker</span>{resultRoute && <button onClick={() => navigate(resultRoute)}>View in Stracker <ArrowUpRight size={13} /></button>}</div>}
      {message.status === 'failed' && <div className="ai-retry-row"><span><CircleAlert size={14} /> {message.error ?? 'The request did not complete.'}</span>{message.errorCode?.startsWith('stracker_ai') && <Button size="sm" variant="secondary" onClick={() => navigate(ADD_OWN_MODEL_PATH)}><Plus size={14} /> Add your own model</Button>}{message.errorCode === 'stracker_ai_unavailable' && <Button size="sm" variant="quiet" onClick={() => navigate(AI_SETTINGS_PATH)}><SettingsIcon size={14} /> AI settings</Button>}{message.retryable !== false && <Button size="sm" variant="secondary" onClick={() => void retryLast()}><RotateCcw size={14} /> Retry</Button>}</div>}
      {message.status === 'cancelled' && <div className="ai-cancelled-note"><Square size={12} /> Request stopped. No Stracker change was made.</div>}
      {message.content.trim() && message.status !== 'running' && <div className="ai-message-actions"><CopyButton text={message.content} label="Copy response" /></div>}
      {(providerId || message.status === 'completed') && <div className="ai-message-meta">{providerId && <><AIProviderMark provider={providerId} small /><span>{providerName}</span>{message.modelId && <span className="ai-model-name">{message.modelId}</span>}</>}{message.createdAt && <time dateTime={message.createdAt}>{new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(message.createdAt))}</time>}</div>}
    </div>
  </article>
}

function UserMessage({ message }: { message:AIMessage }) {
  return <article className="ai-message ai-message-user"><div className="ai-user-stack"><div className="ai-user-bubble"><PlainBody content={message.content} /><time dateTime={message.createdAt}>{new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(message.createdAt))}</time></div><div className="ai-message-actions"><CopyButton text={message.content} label="Copy your message" /></div></div></article>
}

function ConversationMessages({ compact=false }: { compact?:boolean }) {
  const { messages,providers,sendMessage,activeTask,isBusy,providersLoading } = useAI()
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll,setAutoScroll] = useState(true)
  const { configured,active,strackerUnavailable,hasOwn } = useActiveAI()
  const showWelcome = messages.length === 0
  useEffect(() => { if (autoScroll) bottomRef.current?.scrollIntoView({behavior:'smooth',block:'end'}) },[messages,activeTask?.progress,autoScroll])
  const prompt = (text:string) => { void sendMessage(text,location.pathname) }
  return <div className={`ai-conversation ${compact ? 'ai-conversation-compact' : ''}`}>
    <div className="ai-message-scroll" role="log" aria-label="AI conversation" aria-live="polite" onScroll={event => {
      const element = event.currentTarget
      setAutoScroll(element.scrollHeight - element.scrollTop - element.clientHeight < 100)
    }}>
      {showWelcome ? <div className="ai-welcome">
        <div className="ai-welcome-mark"><Sparkles size={22} /></div>
        <span className="eyebrow">A STUDY PARTNER, ON YOUR TERMS</span>
        <h2>{user?.displayName ? `Hi, ${user.displayName.split(' ')[0]}.` : 'Let’s make your next step clearer.'}</h2>
        <p>Ask about your saved tests, chapters, revisions, mistakes, or study plan. I’ll use your Stracker data—not invented estimates.</p>
        {!configured ? (strackerUnavailable ? <StrackerUnavailableNotice onAddOwn={() => navigate(ADD_OWN_MODEL_PATH)} /> : providersLoading ? null : <div className="ai-connect-nudge"><KeyRoundIcon /><span><strong>Stracker AI is getting ready.</strong><small>You can also add your own AI model in Settings.</small></span><Link to={ADD_OWN_MODEL_PATH} className="button button-secondary button-sm">Add your own model</Link></div>) : <>
          <div className="ai-provider-ready"><AIProviderMark provider={active?.providerId ?? 'custom'} small /><span>Using <strong>{active?.name}</strong>{active?.model ? ` · ${active.model}` : ''}</span></div>
          {strackerUnavailable && hasOwn && <div className="ai-provider-ready"><CircleAlert size={14} /><span>Stracker AI is temporarily unavailable, so your own model is answering.</span></div>}
        </>}
        {configured && <div className="ai-suggestion-grid">{SUGGESTIONS.map((suggestion,index) => <button key={suggestion} onClick={() => prompt(suggestion)} disabled={isBusy}><span>{index === 0 ? '01' : index === 1 ? '02' : index === 2 ? '03' : '04'}</span>{suggestion}<ArrowUpRight size={14} /></button>)}</div>}
      </div> : <div className="ai-messages-list">{messages.map(message => message.role === 'user' ? <UserMessage key={message.id} message={message} /> : <AssistantMessage key={message.id} message={message} />)}</div>}
      {activeTask && isBusy && <div className="ai-task-progress" role="status"><LoaderCircle size={14} className="spin" /><span>{activeTask.progress}</span>{activeTask.providerId && <small>{activeProviderLabel(activeTask.providerId,providers)}{activeTask.modelId ? ` · ${activeTask.modelId}` : ''}</small>}</div>}
      <div ref={bottomRef} />
    </div>
    {!autoScroll && <button className="ai-scroll-bottom" onClick={() => { bottomRef.current?.scrollIntoView({behavior:'smooth',block:'end'}); setAutoScroll(true) }}><ArrowDown size={14} /> Latest</button>}
  </div>
}

function KeyRoundIcon() { return <span className="ai-connect-icon"><ShieldCheck size={17} /></span> }

function ChatComposer({ compact=false }: { compact?:boolean }) {
  const { isBusy,activeTask,lastRequest,sendMessage,stopTask,retryLast } = useAI()
  const { configured,active } = useActiveAI()
  const location = useLocation()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [value,setValue] = useState('')
  const send = (event?:FormEvent) => {
    event?.preventDefault()
    if (isBusy) { if (activeTask?.cancellable !== false) stopTask(); return }
    const text = value
    if (!text.trim()) { if (lastRequest) void retryLast(); return }
    setValue('')
    void sendMessage(text,location.pathname)
    window.setTimeout(() => inputRef.current?.focus(),0)
  }
  const keyDown = (event:KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() }
  }
  const fit = () => {
    const element = inputRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight,120)}px`
  }
  return <div className={`ai-composer-wrap ${compact ? 'ai-composer-compact' : ''}`}>
    <form className="ai-composer" onSubmit={send}>
      <textarea ref={inputRef} rows={1} maxLength={4000} value={value} onChange={event => { setValue(event.target.value); fit() }} onKeyDown={keyDown} placeholder={configured ? 'Ask about your study progress…' : 'Add your own AI model to keep going'} aria-label="Message Stracker AI" disabled={!configured || isBusy} />
      <div className="ai-composer-footer"><span>Enter to send · Shift + Enter for a new line</span><div><span className="ai-message-limit">{value.length}/4000</span><button type="submit" className={`ai-send-button ${isBusy && activeTask?.cancellable !== false ? 'ai-stop-button' : ''}`} disabled={isBusy ? activeTask?.cancellable === false : !value.trim() && !lastRequest} aria-label={isBusy ? activeTask?.cancellable === false ? 'Confirmed change is being saved' : 'Stop the current AI task' : value.trim() ? 'Send message' : 'Retry last request'} title={isBusy ? activeTask?.cancellable === false ? 'Saving the confirmed change' : 'Stop this task' : 'Send message'}>{isBusy ? activeTask?.cancellable === false ? <LoaderCircle size={15} className="spin" /> : <Square size={15} fill="currentColor" /> : value.trim() ? <Send size={16} /> : lastRequest ? <RotateCcw size={15} /> : <Send size={16} />}</button></div></div>
    </form>
    <div className="ai-composer-disclaimer"><ShieldCheck size={12} /> {active?.providerId === 'stracker' ? 'Stracker AI is included with your account.' : 'Your provider handles AI processing and billing.'} Review before changes are saved.</div>
  </div>
}

function HistorySidebar({ onSelect,hidden=false }: { onSelect:()=>void;hidden?:boolean }) {
  const { recentConversations,recentTasks,conversationId,openConversation,newConversation,loadConversations,isBusy } = useAI()
  const [loadingId,setLoadingId] = useState<string|null>(null)
  const handleOpen = async (id:string) => {
    if (loadingId) return
    setLoadingId(id)
    try { await openConversation(id); onSelect() } finally { setLoadingId(null) }
  }
  return <aside className="ai-history-sidebar" aria-label="Conversation history" aria-hidden={hidden || undefined} inert={hidden || undefined}>
    <div className="ai-history-top"><span>RECENT CHATS</span><IconButton label="Refresh conversation history" onClick={() => void loadConversations()}><RefreshCw size={14} /></IconButton></div>
    <Button size="sm" variant="secondary" className="ai-new-chat-button" onClick={newConversation} disabled={isBusy}><MessageSquarePlus size={15} /> New conversation</Button>
    <div className="ai-history-list">{recentConversations.length ? recentConversations.map(conversation => <button key={conversation.id} className={`ai-history-item ${conversation.id === conversationId ? 'selected' : ''}`} onClick={() => void handleOpen(conversation.id)} disabled={loadingId !== null || isBusy} aria-current={conversation.id === conversationId ? 'page' : undefined}><span><strong>{conversation.title}</strong><small>{new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(new Date(conversation.updated_at))}</small></span>{loadingId === conversation.id ? <LoaderCircle size={14} className="spin" /> : <ChevronDown size={13} className="ai-history-arrow" />}</button>) : <p className="ai-history-empty">Your saved conversations will appear here.</p>}</div>
    <details className="ai-task-history"><summary>Recent AI tasks <span>{recentTasks.length}</span></summary><div className="ai-task-history-list">{recentTasks.length ? recentTasks.slice(0,5).map(task => <button key={task.id} onClick={() => void handleOpen(task.conversation_id)} disabled={loadingId !== null || isBusy}><span><strong>{task.progress || task.task_type}</strong><small>{activeProviderLabel(task.provider_id,[]) }{task.model_id ? ` · ${task.model_id}` : ''}</small></span><StatusBadge tone={task.status === 'completed' ? 'good' : task.status === 'failed' ? 'bad' : task.status === 'cancelled' ? 'muted' : 'warn'}>{task.status.replaceAll('_',' ')}</StatusBadge></button>) : <p>No AI tasks saved yet.</p>}</div></details><div className="ai-history-foot"><ShieldCheck size={14} /> Stored in your Stracker account.</div>
  </aside>
}

export function AIExperience() {
  const { panelOpen,minimized,largeOpen,openPanel,restorePanel,minimizePanel,closePanel,expandPanel,collapseLarge,conversationTitle,conversationId,clearConversation,newConversation,isBusy } = useAI()
  const launcherExpanded = useScrollExpanded()
  // Exit animations: the floating window fades/scales out before close or minimise; the large
  // workspace fades out before it closes or returns to the floating window.
  const floatingExit = useExit(170)
  const largeExit = useExit(170)
  const largeExitFn = largeExit.exit
  const closeAnimated = () => (largeOpen ? largeExit : floatingExit).exit(closePanel)
  const minimizeAnimated = () => (largeOpen ? largeExit : floatingExit).exit(minimizePanel)
  const collapseAnimated = () => largeExit.exit(collapseLarge)
  const { backendStatus } = useAI()
  const { configured,active } = useActiveAI()
  const [clearConfirmOpen,setClearConfirmOpen] = useState(false)
  const [historyOpen,setHistoryOpen] = useState(false)
  const [smallScreen,setSmallScreen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width:520px)').matches)
  const [clearing,setClearing] = useState(false)
  const historyOpenRef = useRef(historyOpen)
  const historyToggleRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const { notify } = useToast()
  useEffect(() => { historyOpenRef.current = historyOpen },[historyOpen])
  useEffect(() => { if (panelOpen || largeOpen) void loadMarkdown().catch(() => undefined) },[panelOpen,largeOpen])
  useEffect(() => {
    const media = window.matchMedia('(max-width:520px)')
    const update = () => setSmallScreen(media.matches)
    update()
    media.addEventListener('change',update)
    return () => media.removeEventListener('change',update)
  },[])
  useEffect(() => {
    if (!largeOpen) return
    const previous = document.activeElement as HTMLElement|null
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>('.ai-large-workspace [aria-label="Close workspace"]')?.focus(),20)
    const onKey = (event:globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (historyOpenRef.current) { setHistoryOpen(false); window.setTimeout(() => historyToggleRef.current?.focus(),0) }
        else largeExitFn(collapseLarge)
      }
      if (event.key === 'Tab') {
        const root = document.querySelector('.ai-large-workspace')
        const elements = root ? [...root.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter(element => element.getClientRects().length > 0 && !element.closest('[inert]')) : []
        if (!elements.length) return
        const first = elements[0]; const last = elements.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown',onKey)
    document.body.classList.add('modal-open')
    return () => { clearTimeout(timer); document.removeEventListener('keydown',onKey); document.body.classList.remove('modal-open'); previous?.focus?.() }
  },[largeOpen,collapseLarge,largeExitFn])

  const content = <>
    <header className="ai-window-header"><div className="ai-window-brand"><span className="ai-brand-mark"><Sparkles size={16} /></span><div><strong>Stracker AI</strong><span>{conversationId ? conversationTitle : configured ? `Ready${active ? ` · ${active.name}` : ''}` : 'Your study copilot'}</span></div></div><div className="ai-window-tools">{conversationId && <IconButton label="Start a new conversation" onClick={() => newConversation()} disabled={isBusy}><MessageSquarePlus size={16} /></IconButton>}{!largeOpen && <IconButton label="Conversation history and workspace" onClick={() => { setHistoryOpen(true); expandPanel() }}><History size={16} /></IconButton>}{largeOpen && <button ref={historyToggleRef} type="button" className="icon-button" aria-label={historyOpen ? 'Hide recent chats' : 'Show recent chats'} aria-expanded={historyOpen} onClick={() => setHistoryOpen(open => !open)}><History size={16} /></button>}{largeOpen && <IconButton label="Close workspace" onClick={collapseAnimated}><Minimize2 size={16} /></IconButton>}{!largeOpen && <IconButton label="Open large workspace" onClick={expandPanel}><Maximize2 size={16} /></IconButton>}<IconButton label="Minimize assistant; task continues" onClick={minimizeAnimated}><Minus size={17} /></IconButton><IconButton label="Close assistant; task continues" onClick={closeAnimated}><X size={18} /></IconButton></div></header>
    {backendStatus === 'misconfigured' && <div className="ai-service-notice" role="alert"><CircleAlert size={15} /><span><strong>The Stracker AI backend is not configured for this deployment.</strong> The administrator must finish the server setup before AI can run.</span></div>}
    {backendStatus === 'unreachable' && <div className="ai-service-notice" role="alert"><CircleAlert size={15} /><span><strong>The Stracker AI backend is unavailable.</strong> The deployed app has no <code>/api/ai/*</code> functions.</span></div>}
    {largeOpen ? <div className={`ai-workspace-body ${historyOpen ? 'history-open' : ''}`}><button className="ai-history-backdrop" aria-label="Close recent conversations" onClick={() => setHistoryOpen(false)} tabIndex={historyOpen ? 0 : -1} /><HistorySidebar hidden={smallScreen && !historyOpen} onSelect={() => { setHistoryOpen(false); if (smallScreen) historyToggleRef.current?.focus() }} /><div className="ai-workspace-chat"><div className="ai-workspace-toolbar"><div><span className="eyebrow">YOUR PRIVATE STUDY WORKSPACE</span><strong>{conversationTitle}</strong></div><div><Button variant="quiet" size="sm" onClick={() => setClearConfirmOpen(true)} disabled={!conversationId || isBusy}><Trash2 size={14} /> Clear chat</Button><Button variant="quiet" size="sm" onClick={() => navigate('/settings#ai-provider-settings')}><KeyRoundIcon /> Providers</Button></div></div><ConversationMessages /><ChatComposer /></div></div>
      : <><div className="ai-compact-titlebar"><span>{conversationId ? conversationTitle : 'Ask about your studies'}</span><span className="ai-compact-titlebar-actions"><button type="button" className="ai-add-own-model" onClick={() => navigate(ADD_OWN_MODEL_PATH)} title="Add your own AI model"><Plus size={12} /> Add your own model</button>{configured && <span className="ai-ready-dot">Ready</span>}</span></div><ConversationMessages compact /><ChatComposer compact /></>}
  </>
  return <>
    {!panelOpen && !largeOpen && <div className={`ai-launcher-wrap ${minimized ? 'ai-launcher-minimized' : ''} ${minimized || launcherExpanded ? 'ai-launcher-expanded' : ''}`}>
      <button className={`ai-launcher ${isBusy ? 'ai-launcher-active' : ''}`} onClick={minimized ? restorePanel : openPanel} aria-label={minimized ? 'Restore AI Assistant; task continues' : 'Ask Stracker'} aria-expanded={false}><Sparkles size={20} aria-hidden="true" /><span className="ai-launcher-label" aria-hidden="true">{minimized ? 'Restore' : 'Ask Stracker'}</span>{isBusy && <i aria-label="AI task active" />}</button>
    </div>}
    {panelOpen && !largeOpen && <section className="ai-floating-window" aria-label="Stracker AI Assistant" data-state={floatingExit.state} onAnimationEnd={floatingExit.onAnimationEnd}><div className="ai-floating-shell">{content}</div></section>}
    {largeOpen && <div className="ai-workspace-backdrop" data-state={largeExit.state} onAnimationEnd={largeExit.onAnimationEnd} onMouseDown={event => { if (event.target === event.currentTarget) collapseAnimated() }}><section className="ai-large-workspace" role="dialog" aria-modal="true" aria-label="Stracker AI workspace"><div className="ai-large-shell">{content}</div></section></div>}
    {clearConfirmOpen && <Dialog title="Clear this conversation?" subtitle="This removes the saved messages from your Stracker account. It does not change your study data or provider settings." onClose={() => !clearing && setClearConfirmOpen(false)} className="dialog-narrow"><div className="dialog-actions"><Button variant="secondary" onClick={() => setClearConfirmOpen(false)} disabled={clearing}>Keep conversation</Button><Button variant="danger" loading={clearing} onClick={() => { if (clearing) return; setClearing(true); void clearConversation().then(() => { setClearConfirmOpen(false); notify('Conversation cleared.') }).catch(error => notify(error instanceof Error ? error.message : 'Conversation could not be cleared.', 'error')).finally(() => setClearing(false)) }}><Trash2 size={15} /> Clear conversation</Button></div></Dialog>}
  </>
}
