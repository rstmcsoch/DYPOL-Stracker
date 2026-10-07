import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, Check, Coffee, Focus, Moon, Pause, Play, RotateCcw, Sparkles, Timer } from 'lucide-react'
import { Button, ProgressRing, SubjectBadge } from '../components/ui'
import { useFocus, type FocusMode } from '../contexts/FocusContext'
import { useData } from '../contexts/DataContext'
import type { Subject } from '../types'
import { SUBJECTS } from '../types'

const MODES: { name: FocusMode; minutes: number; label: string; icon: React.ReactNode }[] = [
  { name: 'Pomodoro', minutes: 25, label: 'Focus', icon: <Focus size={15} /> },
  { name: 'Short Break', minutes: 5, label: 'Short break', icon: <Coffee size={15} /> },
  { name: 'Long Break', minutes: 15, label: 'Long break', icon: <Moon size={15} /> },
  { name: 'Custom', minutes: 40, label: 'Custom', icon: <Timer size={15} /> }
]

export default function FocusPage() {
  const timer = useFocus()
  const { running: timerRunning, pause: pauseTimer, start: startTimer } = timer
  const { data } = useData()
  const navigate = useNavigate()
  const selectedTask = data.tasks.find(task => task.id === timer.taskId)
  const selectedChapter = data.chapters.find(chapter => chapter.id === timer.chapterId)
  const availableChapters = data.chapters.filter(chapter => !timer.subject || chapter.subject === timer.subject).sort((a, b) => a.position - b.position)
  const clock = `${String(Math.floor(timer.remainingSeconds / 60)).padStart(2, '0')}:${String(timer.remainingSeconds % 60).padStart(2, '0')}`
  const subtitle = useMemo(() => timer.mode === 'Pomodoro' || timer.mode === 'Custom' ? 'One clear block. Leave the rest for later.' : 'A pause is part of good preparation.', [timer.mode])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target && (['INPUT','TEXTAREA','SELECT'].includes(target.tagName) || target.isContentEditable)
      if (typing) return
      if (event.code === 'Space') { event.preventDefault(); if (timerRunning) pauseTimer(); else startTimer() }
      if (event.key === 'Escape') { event.preventDefault(); navigate('/') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [timerRunning, pauseTimer, startTimer, navigate])

  const chooseSubject = (value: string) => {
    const nextSubject = value ? value as Subject : null
    timer.setSubject(nextSubject)
    const chapter = data.chapters.find(item => item.id === timer.chapterId)
    if (chapter && chapter.subject !== nextSubject) timer.setChapter(null)
  }

  return <div className="focus-page" data-mode={timer.mode.toLowerCase().replace(' ', '-') }>
    <div className="focus-vignette" aria-hidden="true" />
    <header className="focus-topbar"><button className="focus-exit" onClick={() => navigate('/')}><ArrowLeft size={17} /> Exit focus</button><div className="focus-wordmark"><span className="focus-mark">S</span><span>Stracker <i>focus mode</i></span></div><div className="focus-top-note"><span className={timer.running ? 'focus-live-dot live' : 'focus-live-dot'} />{timer.running ? 'BLOCK IN PROGRESS' : 'DISTRACTION-FREE SPACE'}</div></header>
    <main className="focus-main">
      <div className="focus-prelude"><span className="focus-star">✳</span><span className="eyebrow">MAKE THIS MOMENT COUNT</span><span className="focus-star">✦</span></div>
      <h1>{timer.mode === 'Pomodoro' || timer.mode === 'Custom' ? 'One thing at a time.' : 'Take the pause.'}</h1>
      <p className="focus-subtitle">{subtitle}</p>
      <div className="focus-mode-selector" role="group" aria-label="Timer mode">{MODES.map(mode => <button key={mode.name} className={timer.mode === mode.name ? 'selected' : ''} onClick={() => timer.switchMode(mode.name)} disabled={timer.running} aria-pressed={timer.mode === mode.name}>{mode.icon}<span>{mode.label}</span>{mode.name !== 'Custom' && <small>{timer.durations[mode.name]}m</small>}</button>)}</div>
      {timer.mode === 'Custom' && <label className="custom-time-control">Custom focus minutes <input type="number" min="1" max="180" step="1" value={timer.durations.Custom} disabled={timer.running} onChange={event => timer.setCustomMinutes(Number(event.target.value) || 1)} /></label>}
      <div className={`focus-clock-wrap ${timer.running ? 'is-running' : ''} ${timer.finished ? 'is-finished' : ''}`}>
        <span className="focus-clock-orbit orbit-one" aria-hidden="true" /><span className="focus-clock-orbit orbit-two" aria-hidden="true" />
        <ProgressRing value={timer.progress} size={332} color="var(--focus-accent)" label={<span className="focus-clock" aria-live="off">{clock}</span>} />
        <div className="focus-clock-caption">{timer.finished ? <><Check size={15} /> BLOCK COMPLETE</> : timer.running ? 'STAY WITH THIS PAGE' : 'READY WHEN YOU ARE'}</div>
      </div>
      <div className="focus-primary-actions">{timer.running ? <Button className="focus-start-button" size="lg" variant="marker" onClick={timer.pause}><Pause size={18} /> Pause <kbd>Space</kbd></Button> : <Button className="focus-start-button" size="lg" variant="marker" onClick={timer.start}><Play size={17} fill="currentColor" /> {timer.finished ? 'Start another block' : timer.remainingSeconds < timer.focusMinutes * 60 ? 'Resume focus' : 'Begin focus'} <kbd>Space</kbd></Button>}{(timer.running || timer.elapsedSeconds > 0 || timer.finished) && <button className="focus-reset-button" onClick={timer.reset} aria-label="Reset timer"><RotateCcw size={16} /> Reset</button>}</div>
      <div className="focus-context-card"><div className="focus-context-head"><BookOpen size={15} /><span>KEEP THIS BLOCK GROUNDED</span><span className="context-free-note">Optional</span></div><div className="focus-context-fields"><label><span>Subject</span><select value={timer.subject ?? ''} disabled={timer.running} onChange={event => chooseSubject(event.target.value)}><option value="">Choose a subject</option>{SUBJECTS.map(subject => <option key={subject}>{subject}</option>)}</select></label><label><span>Chapter</span><select value={timer.chapterId ?? ''} disabled={timer.running} onChange={event => timer.setChapter(event.target.value || null)}><option value="">Choose a chapter</option>{availableChapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select></label><label><span>Today's task</span><select value={timer.taskId ?? ''} disabled={timer.running} onChange={event => timer.setTask(event.target.value || null)}><option value="">No linked task</option>{data.tasks.filter(task => task.task_date === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label></div>{selectedTask && <div className="focus-current-task"><span className="focus-task-bullet">↳</span><div><span>CURRENT TASK</span><strong>{selectedTask.title}</strong>{selectedChapter && <small><SubjectBadge subject={selectedChapter.subject} /> {selectedChapter.name}</small>}</div></div>}</div>
      <div className="focus-footer-note"><Sparkles size={14} /> Your timer continues if you leave focus mode. Study time is logged when the focus block finishes.</div>
    </main>
    <footer className="focus-bottom"><span>Stracker <strong>by DYPOL LABS</strong></span><span>Press <kbd>Esc</kbd> to exit · <kbd>Space</kbd> to pause or resume</span></footer>
  </div>
}
