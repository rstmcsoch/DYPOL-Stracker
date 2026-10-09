import { SYLLABUS } from '../../shared/lib/syllabus'

/** Copy for the public landing page. It mirrors the website's homepage sections word for word. */

export const CHAPTER_COUNT = Object.values(SYLLABUS).reduce((sum, chapters) => sum + chapters.length, 0)

export const HERO_PILLARS = ['Syllabus', 'Tests', 'Mistakes', 'Revision', 'Analytics']

export const LOOP = [
  { step: 'Learn', body: 'Work the syllabus chapter by chapter, keeping notes and formula notes on the same page as the status.', link: 'Syllabus notebook' },
  { step: 'Test', body: 'Log the chapter test, subject test, mock or PYQ session while the paper is still in front of you.', link: 'Test journal' },
  { step: 'Analyse', body: 'Read the marks, the error mix and the chapter signals instead of guessing where the score went.', link: 'Analytics' },
  { step: 'Revise', body: 'Let the intervals and the due desk bring each chapter back — including the ones that keep slipping.', link: 'Revision desk' },
  { step: 'Repeat', body: 'Fold the result into tomorrow’s tasks and this week’s goals, then start the next cycle.', link: 'Planner + Focus' }
]

export type FeatureKey = 'syllabus' | 'tests' | 'mistakes' | 'revision' | 'planning' | 'focus' | 'analytics' | 'ai'

export const FEATURES: { key: FeatureKey; title: string; summary: string; points: string[] }[] = [
  {
    key: 'syllabus',
    title: 'Syllabus Notebook',
    summary: 'The whole JEE 2027 topic list, kept like a real register.',
    points: [
      `Editable Physics, Chemistry and Maths chapters from the seeded ${CHAPTER_COUNT}-chapter grouping`,
      'Status and priority for each chapter: Not Started, Studying, Done or Revised',
      'Chapter notes, formula notes, search and custom ordering in one place'
    ]
  },
  {
    key: 'tests',
    title: 'Test Journal',
    summary: 'Every paper you write, recorded while it is still fresh.',
    points: [
      'Chapter tests, subject tests, full mocks and PYQ practice in one journal',
      'Marks with correct, wrong and skipped counts',
      'Chapter or subject breakdowns, filters and sorting across test history'
    ]
  },
  {
    key: 'mistakes',
    title: 'Mistake + Retry Notebook',
    summary: 'Where a wrong answer turns into a fixed one.',
    points: [
      'File each mistake against its chapter and error type',
      'Keep solution notes and an optional private question photo',
      'Pending and retried states verify that the fix really stuck'
    ]
  },
  {
    key: 'revision',
    title: 'Revision System',
    summary: 'Spaced revision that you configure once and follow.',
    points: [
      'Configurable intervals, with 1, 7 and 30 days ready to use',
      'A due-and-overdue desk keeps chapters from disappearing',
      'Completing a revision schedules the next one and keeps notes linked'
    ]
  },
  {
    key: 'planning',
    title: 'Daily Planning + Goals',
    summary: 'A finishable daily plan connected to the syllabus.',
    points: [
      'Dated tasks with subject, chapter, time estimate and priority',
      'Reorder tasks as the day changes shape',
      'Weekly goals and progress filled by the work you record'
    ]
  },
  {
    key: 'focus',
    title: 'Focus Sessions',
    summary: 'A timer that keeps the sitting honest and counts the day.',
    points: [
      'Pomodoro, breaks and custom focus blocks',
      'The timer survives notebook navigation and refreshes',
      'Sessions link to your subject and chapter and feed study-time goals'
    ]
  },
  {
    key: 'analytics',
    title: 'Analytics',
    summary: 'What the record says, with the working shown.',
    points: [
      'Subject signals measured against your own weak and strong thresholds',
      'Chapter and test trends instead of one flattering number',
      'Study time, mistake types, weak chapters and untested chapters in view'
    ]
  },
  {
    key: 'ai',
    title: 'AI Assistant',
    summary: 'Optional, and always on your own provider account.',
    points: [
      'Bring your own key for Gemini, OpenAI, Anthropic, DeepSeek, Qwen or compatible endpoints',
      'Ask questions grounded in your syllabus, tests, mistakes, revisions and analytics',
      'Writes are previewed first; credentials stay server-side and AI can stay switched off'
    ]
  }
]

export const PRINCIPLES = [
  { title: 'One place for the work', body: 'Syllabus, tests, mistakes, revision, planning and focus sessions in the same notebook — not five apps and a paper register.' },
  { title: 'A status you can state', body: 'Every chapter is Not Started, Studying, Done or Revised, so “where am I?” has an actual answer.' },
  { title: 'Tests become performance data', body: 'A paper is broken down by subject, chapter and error type instead of becoming a number you feel bad about.' },
  { title: 'Mistakes become revision material', body: 'Each mistake stays filed against its chapter and returns in the retry list until it is genuinely fixed.' },
  { title: 'Planning tied to the syllabus', body: 'Tasks point at real chapters, so the day’s list and the long-term syllabus are never two separate stories.' },
  { title: 'Signals instead of vibes', body: 'Thresholds, trends and untested chapters are computed from what you recorded — and shown even when the news is bad.' }
]

export const STEPS = [
  { title: 'Set up your preparation', body: 'Start from the seeded syllabus: set your exam dates and daily goal, mark what you have already covered, and put the first chapters in order.' },
  { title: 'Study and record', body: 'Run focus sessions, tick off the day’s tasks, log every test with its marks and counts, and file the mistakes that cost you.' },
  { title: 'Analyse', body: 'Open the analytics page and the due desk: subject signals, chapter trends, error types and the chapters sitting below your threshold.' },
  { title: 'Improve', body: 'Revise what is due, retry the mistakes, and let that decide tomorrow’s tasks and this week’s goals. Then run the loop again.' }
]

export const AI_FACTS = [
  { title: 'Your key, your provider', body: 'Connect Gemini, OpenAI, Anthropic, DeepSeek, Qwen, or any OpenAI- or Anthropic-compatible endpoint with your own API credentials. DYPOL does not supply or proxy a model key, so provider usage is billed by your provider, not by us.' },
  { title: 'Handled server-side', body: 'A saved key goes straight to the Stracker backend, where it is stored as authenticated AES-256-GCM ciphertext. It is never returned to the app and never appears anywhere on this page.' },
  { title: 'Grounded in your notebook', body: 'Supported tools read your own syllabus, tests, mistakes, revisions and analytics, and answer with those figures. Writes — including deletes — are previewed first and applied only after you confirm.' },
  { title: 'Entirely optional', body: 'Everything else in Stracker works with AI switched off. Stracker AI needs an internet connection and the deployed backend, and it is not available in the device-only local preview.' }
]

export const PRIVACY_POINTS = [
  { title: 'Account-scoped data', body: 'Every notebook table is tied to your signed-in account, and row-level security policies in Postgres allow only that account to read or change its own rows.' },
  { title: 'Authenticated access', body: 'The app holds only the public Supabase key. No policy grants the anonymous role access to study data — a signed-in session is required.' },
  { title: 'Private study records', body: 'There is no public profile, feed, share link or leaderboard. Your chapters, tests, mistakes and results are never published anywhere.' },
  { title: 'Private mistake images', body: 'Question photos live in a private storage bucket whose policies require the owner’s user ID in the path, and are served through signed, expiring links.' },
  { title: 'Server-side AI credentials', body: 'AI provider keys are encrypted with AES-256-GCM before storage, kept in the backend only, and never sent back to the app.' },
  { title: 'Yours to take with you', body: 'Backups export the whole notebook as JSON, and test history as CSV, whenever you want it — no lock-in and no export paywall.' }
]

export const SECTIONS = [
  { id: 'features', label: 'Features' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'ai', label: 'AI Assistant' },
  { id: 'privacy', label: 'Privacy' }
] as const
