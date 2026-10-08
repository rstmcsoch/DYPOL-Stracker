import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUpRight, Check, ChevronDown, CircleAlert, Clock3, History, LoaderCircle, Maximize2, MessageSquarePlus, Minimize2, Minus, RefreshCw, RotateCcw, Send, ShieldCheck, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useAI, type AIActionConfirmation, type AIMessage } from '../../contexts/AIContext'
import { providerLabel } from '../../lib/ai/catalog'
import { useAuth } from '../../contexts/AuthContext'
import { useData } from '../../contexts/DataContext'
import { useToast } from '../../contexts/ToastContext'
import { Button, Dialog, IconButton, StatusBadge } from '../ui'
import { AIProviderMark } from './AIProviderMark'

const SUGGESTIONS = [
  'How am I doing in each subject?',
  'Which chapters should I revise next?',
  'Summarize my recent test performance.',
  'Add a study task for today.'
]

function activeProviderLabel(providerId:string|undefined|null,providers:Array<{provider_id:string;display_name:string}>):string {
  if (!providerId) return 'AI Assistant'
  const configured = providers.find(item => item.provider_id === providerId)
  return configured?.display_name || providerLabel(providerId)
}

function MessageBody({ content }: { content:string }) {
  const safe = content.trim()
  if (!safe) return null
  const blocks = safe.split(/```/)
  return <div className="ai-message-body">{blocks.map((block,index) => index % 2 === 1
    ? <pre className="ai-code-block" key={index}><code>{block.replace(/^\w+\n/,'').trimEnd()}</code></pre>
    : <span className="ai-message-prose" key={index}>{block}</span>)}</div>
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
  const resultRoute = typeof message.result?.route === 'string' && message.result.route.startsWith('/') ? message.result.route : null
  const providerId = message.providerId ?? null
  const providerName = activeProviderLabel(providerId,providers)
  const fallbackName = message.fallbackFrom?.providerName || activeProviderLabel(message.fallbackFrom?.providerId,providers)
  return <article className={`ai-message ai-message-assistant ${message.status === 'failed' ? 'is-error' : ''}`}>
    <div className="ai-message-avatar"><AIProviderMark provider={providerId || 'custom'} small /></div>
    <div className="ai-message-main">
      {message.content && <MessageBody content={message.content} />}
      {message.status === 'running' && !message.content && <div className="ai-typing-indicator" aria-label="Assistant is responding"><i /><i /><i /></div>}
      {message.confirmation && <ActionConfirmationCard action={message.confirmation} messageId={message.id} />}
      {message.fallbackFrom && message.status === 'completed' && <div className="ai-fallback-note"><ArrowUpRight size={13} /><span>Switched from {fallbackName} to {providerName}; this answer came from the displayed model.</span></div>}
      {message.result && message.status === 'completed' && <div className="ai-result-proof"><span><Check size={14} /> Saved and verified in Stracker</span>{resultRoute && <button onClick={() => navigate(resultRoute)}>View in Stracker <ArrowUpRight size={13} /></button>}</div>}
      {message.status === 'failed' && <div className="ai-retry-row"><span><CircleAlert size={14} /> {message.error ?? 'The request did not complete.'}</span>{message.retryable !== false && <Button size="sm" variant="secondary" onClick={() => void retryLast()}><RotateCcw size={14} /> Retry</Button>}</div>}
      {message.status === 'cancelled' && <div className="ai-cancelled-note"><Square size={12} /> Request stopped. No Stracker change was made.</div>}
      {(providerId || message.status === 'completed') && <div className="ai-message-meta">{providerId && <><AIProviderMark provider={providerId} small /><span>{providerName}</span>{message.modelId && <span className="ai-model-name">{message.modelId}</span>}</>}{message.createdAt && <time dateTime={message.createdAt}>{new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(message.createdAt))}</time>}</div>}
    </div>
  </article>
}

function UserMessage({ message }: { message:AIMessage }) {
  return <article className="ai-message ai-message-user"><div className="ai-user-bubble"><MessageBody content={message.content} /><time dateTime={message.createdAt}>{new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(message.createdAt))}</time></div></article>
}

function ConversationMessages({ compact=false }: { compact?:boolean }) {
  const { messages,providers,sendMessage,activeTask,isBusy } = useAI()
  const location = useLocation()
  const { user } = useAuth()
  const { data } = useData()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll,setAutoScroll] = useState(true)
  const configured = providers.some(provider => provider.enabled && provider.connection_status === 'connected')
  const defaultProvider = providers.find(provider => provider.is_default && provider.enabled && provider.connection_status === 'connected')
  const showWelcome = messages.length === 0
  const contextChapters = useMemo(() => data.chapters.length,[data.chapters.length])
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
        {!configured ? <div className="ai-connect-nudge"><KeyRoundIcon /><span><strong>Connect your own AI provider to begin.</strong><small>BYOK only · provider billing applies · no DYPOL-owned key</small></span><Link to="/settings" className="button button-secondary button-sm">Set up AI</Link></div> : <div className="ai-provider-ready"><AIProviderMark provider={defaultProvider?.provider_id ?? 'gemini'} small /><span>Using your preferred <strong>{defaultProvider ? activeProviderLabel(defaultProvider.provider_id,providers) : 'configured provider'}</strong>{defaultProvider?.model_id ? ` · ${defaultProvider.model_id}` : ''}</span></div>}
        {configured && <div className="ai-suggestion-grid">{SUGGESTIONS.map((suggestion,index) => <button key={suggestion} onClick={() => prompt(suggestion)} disabled={isBusy}><span>{index === 0 ? '01' : index === 1 ? '02' : index === 2 ? '03' : '04'}</span>{suggestion}<ArrowUpRight size={14} /></button>)}</div>}
        {configured && <p className="ai-local-data-note">{contextChapters} chapters in your notebook · active page: {location.pathname === '/' ? 'Dashboard' : location.pathname.slice(1)}. Only the data needed for a question is sent.</p>}
      </div> : <div className="ai-messages-list">{messages.map(message => message.role === 'user' ? <UserMessage key={message.id} message={message} /> : <AssistantMessage key={message.id} message={message} />)}</div>}
      {activeTask && isBusy && <div className="ai-task-progress" role="status"><LoaderCircle size={14} className="spin" /><span>{activeTask.progress}</span>{activeTask.providerId && <small>{activeProviderLabel(activeTask.providerId,providers)}{activeTask.modelId ? ` · ${activeTask.modelId}` : ''}</small>}</div>}
      <div ref={bottomRef} />
    </div>
    {!autoScroll && <button className="ai-scroll-bottom" onClick={() => { bottomRef.current?.scrollIntoView({behavior:'smooth',block:'end'}); setAutoScroll(true) }}><ArrowDown size={14} /> Latest</button>}
  </div>
}

function KeyRoundIcon() { return <span className="ai-connect-icon"><ShieldCheck size={17} /></span> }

function ChatComposer({ compact=false }: { compact?:boolean }) {
  const { providers,isBusy,activeTask,lastRequest,sendMessage,stopTask,retryLast } = useAI()
  const location = useLocation()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [value,setValue] = useState('')
  const configured = providers.some(provider => provider.enabled && provider.connection_status === 'connected')
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
      <textarea ref={inputRef} rows={1} maxLength={4000} value={value} onChange={event => { setValue(event.target.value); fit() }} onKeyDown={keyDown} placeholder={configured ? 'Ask about your study progress…' : 'Connect an AI provider in Settings first'} aria-label="Message Stracker AI" disabled={!configured || isBusy} />
      <div className="ai-composer-footer"><span>Enter to send · Shift + Enter for a new line</span><div><span className="ai-message-limit">{value.length}/4000</span><button type="submit" className={`ai-send-button ${isBusy && activeTask?.cancellable !== false ? 'ai-stop-button' : ''}`} disabled={isBusy ? activeTask?.cancellable === false : !value.trim() && !lastRequest} aria-label={isBusy ? activeTask?.cancellable === false ? 'Confirmed change is being saved' : 'Stop the current AI task' : value.trim() ? 'Send message' : 'Retry last request'} title={isBusy ? activeTask?.cancellable === false ? 'Saving the confirmed change' : 'Stop this task' : 'Send message'}>{isBusy ? activeTask?.cancellable === false ? <LoaderCircle size={15} className="spin" /> : <Square size={15} fill="currentColor" /> : value.trim() ? <Send size={16} /> : lastRequest ? <RotateCcw size={15} /> : <Send size={16} />}</button></div></div>
    </form>
    <div className="ai-composer-disclaimer"><ShieldCheck size={12} /> Your provider handles AI processing and billing. Review before changes are saved.</div>
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
  const { panelOpen,minimized,largeOpen,openPanel,restorePanel,minimizePanel,closePanel,expandPanel,collapseLarge,conversationTitle,conversationId,clearConversation,newConversation,activeTask,isBusy } = useAI()
  const { providers,backendStatus } = useAI()
  const [clearConfirmOpen,setClearConfirmOpen] = useState(false)
  const [historyOpen,setHistoryOpen] = useState(false)
  const [smallScreen,setSmallScreen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width:520px)').matches)
  const [clearing,setClearing] = useState(false)
  const historyOpenRef = useRef(historyOpen)
  const historyToggleRef = useRef<HTMLButtonElement>(null)
  const configured = providers.some(provider => provider.enabled && provider.connection_status === 'connected')
  const navigate = useNavigate()
  const { notify } = useToast()
  const providerNames = useMemo(() => providers.filter(provider => provider.enabled).map(provider => provider.display_name || providerLabel(provider.provider_id)),[providers])
  useEffect(() => { historyOpenRef.current = historyOpen },[historyOpen])
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
        else collapseLarge()
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
  },[largeOpen,collapseLarge])

  const content = <>
    <header className="ai-window-header"><div className="ai-window-brand"><span className="ai-brand-mark"><Sparkles size={16} /></span><div><strong>Stracker AI</strong><span>{conversationId ? conversationTitle : configured ? `Ready${providerNames.length ? ` · ${providerNames[0]}` : ''}` : 'Your study copilot'}</span></div></div><div className="ai-window-tools">{conversationId && <IconButton label="Start a new conversation" onClick={() => newConversation()} disabled={isBusy}><MessageSquarePlus size={16} /></IconButton>}{!largeOpen && <IconButton label="Conversation history and workspace" onClick={() => { setHistoryOpen(true); expandPanel() }}><History size={16} /></IconButton>}{largeOpen && <button ref={historyToggleRef} type="button" className="icon-button" aria-label={historyOpen ? 'Hide recent chats' : 'Show recent chats'} aria-expanded={historyOpen} onClick={() => setHistoryOpen(open => !open)}><History size={16} /></button>}{largeOpen && <IconButton label="Close workspace" onClick={collapseLarge}><Minimize2 size={16} /></IconButton>}{!largeOpen && <IconButton label="Open large workspace" onClick={expandPanel}><Maximize2 size={16} /></IconButton>}<IconButton label="Minimize assistant; task continues" onClick={minimizePanel}><Minus size={17} /></IconButton><IconButton label="Close assistant; task continues" onClick={closePanel}><X size={18} /></IconButton></div></header>
    {backendStatus === 'misconfigured' && <div className="ai-service-notice" role="alert"><CircleAlert size={15} /><span><strong>The Stracker AI backend is not configured for this deployment.</strong> The administrator must finish the server setup before AI can run.</span></div>}
    {backendStatus === 'unreachable' && <div className="ai-service-notice" role="alert"><CircleAlert size={15} /><span><strong>The Stracker AI backend is unavailable.</strong> The deployed app has no <code>/api/ai/*</code> functions.</span></div>}
    {largeOpen ? <div className={`ai-workspace-body ${historyOpen ? 'history-open' : ''}`}><button className="ai-history-backdrop" aria-label="Close recent conversations" onClick={() => setHistoryOpen(false)} tabIndex={historyOpen ? 0 : -1} /><HistorySidebar hidden={smallScreen && !historyOpen} onSelect={() => { setHistoryOpen(false); if (smallScreen) historyToggleRef.current?.focus() }} /><div className="ai-workspace-chat"><div className="ai-workspace-toolbar"><div><span className="eyebrow">YOUR PRIVATE STUDY WORKSPACE</span><strong>{conversationTitle}</strong></div><div><Button variant="quiet" size="sm" onClick={() => setClearConfirmOpen(true)} disabled={!conversationId || isBusy}><Trash2 size={14} /> Clear chat</Button><Button variant="quiet" size="sm" onClick={() => navigate('/settings#ai-provider-settings')}><KeyRoundIcon /> Providers</Button></div></div><ConversationMessages /><ChatComposer /></div></div>
      : <><div className="ai-compact-titlebar"><span>{conversationId ? conversationTitle : 'Ask about your studies'}</span>{configured && <span className="ai-ready-dot">Ready</span>}</div><ConversationMessages compact /><ChatComposer compact /></>}
  </>
  return <>
    {!panelOpen && !largeOpen && <div className={`ai-launcher-wrap ${minimized ? 'ai-launcher-minimized' : ''}`}>
      {minimized && <span className="ai-launcher-status">{isBusy ? activeTask?.progress ?? 'Working…' : 'Assistant minimized · task continues'}</span>}
      <button className={`ai-launcher ${isBusy ? 'ai-launcher-active' : ''}`} onClick={minimized ? restorePanel : openPanel} aria-label={minimized ? 'Restore AI Assistant; task continues' : 'Open Stracker AI Assistant'} aria-expanded={false}><Sparkles size={20} /><span>{minimized ? 'Restore' : 'Ask Stracker'}</span>{isBusy && <i aria-label="AI task active" />}</button>
    </div>}
    {panelOpen && !largeOpen && <section className="ai-floating-window" aria-label="Stracker AI Assistant"><div className="ai-floating-shell">{content}</div></section>}
    {largeOpen && <div className="ai-workspace-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) collapseLarge() }}><section className="ai-large-workspace" role="dialog" aria-modal="true" aria-label="Stracker AI workspace"><div className="ai-large-shell">{content}</div></section></div>}
    {clearConfirmOpen && <Dialog title="Clear this conversation?" subtitle="This removes the saved messages from your Stracker account. It does not change your study data or provider settings." onClose={() => !clearing && setClearConfirmOpen(false)} className="dialog-narrow"><div className="dialog-actions"><Button variant="secondary" onClick={() => setClearConfirmOpen(false)} disabled={clearing}>Keep conversation</Button><Button variant="danger" loading={clearing} onClick={() => { if (clearing) return; setClearing(true); void clearConversation().then(() => { setClearConfirmOpen(false); notify('Conversation cleared.') }).catch(error => notify(error instanceof Error ? error.message : 'Conversation could not be cleared.', 'error')).finally(() => setClearing(false)) }}><Trash2 size={15} /> Clear conversation</Button></div></Dialog>}
  </>
}
