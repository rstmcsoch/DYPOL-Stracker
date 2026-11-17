/**
 * Student workspace component registry (Student Dashboard Editor).
 *
 * Separate from the public Live Site Editor (src/lib/site-editor): its own pages, ids,
 * capabilities and validation. Every editable thing is declared here; anything not declared
 * cannot be stored, and the server rejects it.
 *
 * Data lock: a component's `data` entries name the values that come from the signed-in
 * student's own records (dates, marks, scores, names, streaks, counts, timers, progress…).
 * They are listed so the editor can show them as locked ("Live student data, not editable")
 * and so the validator can refuse any configuration that tries to set them. Only `text`
 * (static labels with the exact shipped wording as default), `props` (presentation options)
 * and styles are editable.
 */

import { PAGE_LABELS } from './labels.generated.js'

export const STUDENT_LAYOUT_SCHEMA_VERSION = 1

export type StudentPageId =
  | 'shell' | 'home' | 'focus' | 'backlog' | 'practice' | 'syllabus' | 'weak-areas' | 'pyqs' | 'tests'
  | 'mock-analysis' | 'mistakes' | 'retry' | 'analytics' | 'revision' | 'decks' | 'study-now' | 'planner'
  | 'settings' | 'profile' | 'backup'

export interface StudentPage { id: StudentPageId; label: string; path: string | null }

/** Every student route (the existing paths) plus the common application shell. */
export const STUDENT_PAGES: readonly StudentPage[] = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'focus', label: 'Focus', path: '/focus' },
  { id: 'backlog', label: 'Backlog', path: '/backlog' },
  { id: 'practice', label: 'Practice', path: '/practice' },
  { id: 'syllabus', label: 'Syllabus', path: '/syllabus' },
  { id: 'weak-areas', label: 'Weak areas', path: '/weak-areas' },
  { id: 'pyqs', label: 'PYQs', path: '/pyqs' },
  { id: 'tests', label: 'Tests', path: '/tests' },
  { id: 'mock-analysis', label: 'Mock analysis', path: '/mock-analysis' },
  { id: 'mistakes', label: 'Mistake notebook', path: '/mistakes' },
  { id: 'retry', label: 'Retry', path: '/retry' },
  { id: 'analytics', label: 'Analytics', path: '/analytics' },
  { id: 'revision', label: 'Revisions', path: '/revision' },
  { id: 'decks', label: 'Formulas & flashcards', path: '/decks' },
  { id: 'study-now', label: 'Study now', path: '/study-now' },
  { id: 'planner', label: 'Study plan', path: '/planner' },
  { id: 'settings', label: 'Settings', path: '/settings' },
  { id: 'profile', label: 'Profile', path: '/profile' },
  { id: 'backup', label: 'Backup', path: '/backup' },
  { id: 'shell', label: 'Application shell', path: null }
]

export type ComponentKind = 'page' | 'container' | 'section' | 'card' | 'navigation' | 'control'

export interface TextField { label: string; default: string; max: number }
export type PropField =
  | { kind: 'number'; label: string; default: number; min: number; max: number }
  | { kind: 'options'; label: string; default: string; options: readonly string[] }

export interface Capabilities {
  /** Essential to correct operation: cannot be hidden or removed. */
  required: boolean
  hideable: boolean
  reorderable: boolean
  duplicable: boolean
  deletable: boolean
  lockable: boolean
  /** Shows values from the student's own records (always read-only in the editor). */
  dataBound: boolean
  /** Contains real actions (complete, save, navigate…) that keep working unchanged. */
  interactive: boolean
}

export interface ComponentDef {
  id: string
  page: StudentPageId
  label: string
  kind: ComponentKind
  /** Parent container id; null for page roots. */
  parent: string | null
  /** For containers: the default order of their children. */
  children?: readonly string[]
  caps: Capabilities
  text?: Readonly<Record<string, TextField>>
  props?: Readonly<Record<string, PropField>>
  /** Live student data / system calculations shown by this component: locked, never stored. */
  data?: Readonly<Record<string, string>>
  /** Why behaviour is protected, shown in the inspector. */
  note?: string
}

const caps = (overrides: Partial<Capabilities> = {}): Capabilities => ({
  required: false, hideable: true, reorderable: true, duplicable: false, deletable: false, lockable: true,
  dataBound: false, interactive: false, ...overrides
})
const text = (label: string, value: string, max = 80): TextField => ({ label, default: value, max })

const HOME: ComponentDef[] = [
  { id: 'home', page: 'home', label: 'Home', kind: 'page', parent: null, caps: caps({ required: true, hideable: false, reorderable: false }),
    children: ['home.header', 'home.focus', 'home.hero', 'home.exam-mode', 'home.study-now', 'home.grid', 'home.snapshot', 'home.bottom'] },
  { id: 'home.header', page: 'home', label: 'Page header', kind: 'section', parent: 'home', caps: caps({ required: true, hideable: false, dataBound: true }),
    data: { date: 'Today’s date', greeting: 'Greeting for the time of day', name: 'Student’s name' } },
  { id: 'home.focus', page: 'home', label: 'Focus indicator', kind: 'section', parent: 'home', caps: caps({ required: true, hideable: false, dataBound: true, interactive: true }),
    data: { timer: 'Running focus timer (shared FocusContext)', status: 'Running or paused' }, note: 'Uses the one shared focus timer; it only appears while a focus block is running or paused.' },
  { id: 'home.hero', page: 'home', label: 'Exam and rhythm section', kind: 'container', parent: 'home', caps: caps({ hideable: false }), children: ['home.countdown', 'home.streak'] },
  { id: 'home.countdown', page: 'home', label: 'Exam countdown', kind: 'card', parent: 'home.hero', caps: caps({ required: true, hideable: false, dataBound: true, interactive: true }),
    text: { kicker: text('Card label', 'EXAM COUNTDOWN', 40), daysUnit: text('Days unit', 'days', 20), until: text('“until” word', 'until', 20), chapters: text('Chapters label', 'Chapters covered', 40), addDate: text('Add-date button', 'Add exam date', 40) },
    data: { examDates: 'Exam dates from the student’s settings', daysLeft: 'Days remaining (calculated)', exam: 'Exam and track', chaptersCovered: 'Chapters covered count' } },
  { id: 'home.streak', page: 'home', label: 'Study streak', kind: 'card', parent: 'home.hero', caps: caps({ dataBound: true }),
    text: { kicker: text('Card label', 'STUDY STREAK', 40), subtitle: text('Streak caption', 'current study streak', 60), longestLabel: text('Longest label', 'longest', 30), weekLabel: text('Week label', 'active this week', 40) },
    data: { current: 'Current streak (calculated)', longest: 'Longest streak (calculated)', activeDays: 'Active days this week', rule: 'Qualifying-activity message (system rule)' } },
  { id: 'home.exam-mode', page: 'home', label: 'Exam Mode banner', kind: 'section', parent: 'home', caps: caps({ required: true, hideable: false, dataBound: true }),
    text: { focus: text('Priority note', 'Revision, PYQs, mocks and weak areas come first.', 140) },
    data: { daysLeft: 'Days left', label: 'Exam Mode label', reason: 'Why Exam Mode is on (exam logic)' }, note: 'Appears only when the student’s exam track turns Exam Mode on.' },
  { id: 'home.study-now', page: 'home', label: 'Study recommendation', kind: 'card', parent: 'home', caps: caps({ dataBound: true, interactive: true }),
    data: { recommendation: 'Recommendation and reasons (recommendation engine)' } },
  { id: 'home.grid', page: 'home', label: 'Daily dashboard', kind: 'container', parent: 'home', caps: caps({ hideable: false }), children: ['home.today-plan', 'home.aside'] },
  { id: 'home.today-plan', page: 'home', label: 'Today’s plan', kind: 'card', parent: 'home.grid', caps: caps({ required: true, hideable: false, dataBound: true, interactive: true }),
    text: { title: text('Section title', 'Today\'s plan', 40), listLabel: text('List label', 'Today’s tasks', 60), empty: text('Empty-state title', 'No tasks today.', 60), addTask: text('Add-task button', 'Add task', 30), planTask: text('Empty-state button', 'Plan a task', 30), openPlanner: text('Planner link', 'Open planner', 30) },
    data: { tasks: 'Today’s tasks', progress: 'Tasks done count', date: 'Today’s date' }, note: 'Task completion and reordering keep using the real planner records.' },
  { id: 'home.aside', page: 'home', label: 'Study sidebar', kind: 'container', parent: 'home.grid', caps: caps({ hideable: false }), children: ['home.study-time', 'home.revisions', 'home.tip'] },
  { id: 'home.study-time', page: 'home', label: 'Daily study time', kind: 'card', parent: 'home.aside', caps: caps({ dataBound: true, interactive: true }),
    text: { kicker: text('Card label', 'DAILY STUDY TIME', 40), goalCaption: text('Goal caption', 'of your daily goal', 60), start: text('Focus button', 'Start a focus session', 40) },
    data: { minutes: 'Study time today (study-time aggregation)', goal: 'Daily goal from settings', percent: 'Progress percentage' } },
  { id: 'home.revisions', page: 'home', label: 'Revision desk', kind: 'card', parent: 'home.aside', caps: caps({ dataBound: true, interactive: true }),
    text: { kicker: text('Card label', 'REVISION DESK', 40), open: text('Open link', 'Open', 20), due: text('Due label', 'due now', 30), empty: text('Empty message', 'Nothing due today.', 120) },
    data: { revisions: 'Due and overdue revisions', count: 'Due count', lateness: 'Days late' } },
  { id: 'home.tip', page: 'home', label: 'Smart tip', kind: 'card', parent: 'home.aside', caps: caps({ dataBound: true, interactive: true }),
    text: { kicker: text('Card label', 'STUDY TIP', 40), cta: text('Link text', 'See analytics', 40) },
    data: { tip: 'Tip derived from the student’s analytics' } },
  { id: 'home.snapshot', page: 'home', label: 'Study snapshot', kind: 'section', parent: 'home', caps: caps({ dataBound: true }),
    data: { metrics: 'Study time, syllabus, practice, PYQ, backlog, readiness and reminders' } },
  { id: 'home.bottom', page: 'home', label: 'Bottom dashboard', kind: 'container', parent: 'home', caps: caps({ hideable: false }), children: ['home.checkpoint', 'home.syllabus'] },
  { id: 'home.checkpoint', page: 'home', label: 'Latest test checkpoint', kind: 'card', parent: 'home.bottom', caps: caps({ dataBound: true, interactive: true }),
    text: { emptyEyebrow: text('Empty eyebrow', 'LATEST TEST', 40), emptyTitle: text('Empty title', 'No tests yet.', 60), emptyBody: text('Empty text', 'Log a test, PYQ session or mock.', 140), add: text('Add-test button', 'Add test', 30), view: text('View button', 'View it', 30), addAnother: text('Add-another button', 'Add another test', 40) },
    data: { test: 'Latest test title and type', marks: 'Marks and percentage', count: 'Tests logged today' } },
  { id: 'home.syllabus', page: 'home', label: 'Subject syllabus progress', kind: 'card', parent: 'home.bottom', caps: caps({ dataBound: true, interactive: true }),
    text: { eyebrow: text('Eyebrow', 'OVERALL', 40), title: text('Title', 'Syllabus progress', 40) },
    props: { subjectRows: { kind: 'number', label: 'Subject rows shown', default: 5, min: 1, max: 8 } },
    data: { percent: 'Overall syllabus percentage', subjects: 'Per-subject chapters done / total' } }
]

const SHELL: ComponentDef[] = [
  { id: 'shell', page: 'shell', label: 'Application shell', kind: 'page', parent: null, caps: caps({ required: true, hideable: false, reorderable: false }),
    children: ['shell.sidebar', 'shell.topline', 'shell.mobile-nav', 'shell.quick-actions'] },
  { id: 'shell.sidebar', page: 'shell', label: 'Sidebar navigation', kind: 'navigation', parent: 'shell', caps: caps({ required: true, hideable: false, reorderable: false, interactive: true, dataBound: true }),
    data: { date: 'Current date', sync: 'Sync status and pending count', account: 'Student name and email' }, note: 'Routes and sign-in guards stay fixed; labels are edited in Appearance → Navigation & labels.' },
  { id: 'shell.topline', page: 'shell', label: 'Top bar', kind: 'section', parent: 'shell', caps: caps({ required: true, hideable: false, reorderable: false, interactive: true, dataBound: true }),
    data: { exam: 'Student’s exam', page: 'Current page' } },
  { id: 'shell.mobile-nav', page: 'shell', label: 'Mobile bottom navigation', kind: 'navigation', parent: 'shell', caps: caps({ required: true, hideable: false, reorderable: false, interactive: true }) },
  { id: 'shell.quick-actions', page: 'shell', label: 'Quick actions button', kind: 'control', parent: 'shell', caps: caps({ required: true, hideable: false, reorderable: false, interactive: true }) }
]

interface PageSpec {
  header?: { title: string; subtitle?: string; eyebrow?: string }
  /** Top-level sections: [key, label, data-bound, optional (may be hidden), static text]. */
  sections: ReadonlyArray<[string, string, boolean, boolean, Record<string, TextField>?]>
}

/**
 * Per-page parts. Headers carry the page's static title/subtitle (exact shipped wording);
 * sections are styled, resized and (when optional) hidden. Section order on these pages is
 * fixed: their layout is part of how each page works.
 */
const PAGE_SPECS: Record<Exclude<StudentPageId, 'home' | 'shell'>, PageSpec> = {
  focus: { sections: [
    ['topbar', 'Top bar', true, false],
    ['prelude', 'Motto line', false, true, { label: text('Motto', 'FOCUS SESSION', 60) }],
    ['clock', 'Timer', true, false],
    ['context', 'Block details', true, false],
    ['footnote', 'Footer note', false, true]
  ] },
  backlog: { header: { title: 'Backlog', subtitle: 'Lectures, DPPs and topics to catch up on.' }, sections: [['summary', 'Summary cards', true, true], ['filters', 'Filters', true, false]] },
  practice: { header: { title: 'Practice log', subtitle: 'DPPs, modules and sheets. Not counted as tests.' }, sections: [['summary', 'Summary cards', true, true], ['filters', 'Filters', true, false]] },
  syllabus: { header: { title: 'Syllabus' }, sections: [['board', 'Syllabus board', true, false]] },
  'weak-areas': { header: { title: 'Weak areas', subtitle: 'Based on your last three results.' }, sections: [
    ['rule', 'Threshold banner', true, true], ['overview', 'Overview cards', true, false], ['tested', 'Tested chapters', true, false], ['untested', 'Untested chapters', true, false], ['legend', 'Classification footer', true, true]
  ] },
  pyqs: { header: { title: 'PYQ tracker', subtitle: 'Track past papers by chapter.' }, sections: [['summary', 'Completion cards', true, true], ['filters', 'Filters', true, false]] },
  tests: { header: { title: 'Test history' }, sections: [['summary', 'Summary cards', true, true], ['board', 'Test history list', true, false]] },
  'mock-analysis': { header: { title: 'Mock analysis', subtitle: 'Where you lost marks, and why.' }, sections: [['filters', 'Test picker', true, false], ['analysis', 'Analysis grid', true, false]] },
  mistakes: { header: { title: 'Mistake notebook' }, sections: [['overview', 'Overview cards', true, true], ['board', 'Mistake list', true, false]] },
  retry: { header: { title: 'Retry list' }, sections: [['intro', 'Intro cards', true, true], ['board', 'Retry list', true, false]] },
  analytics: { header: { title: 'Analytics', subtitle: 'Based on your records.' }, sections: [['kpis', 'Key numbers', true, false], ['insights', 'Insight cards', true, true]] },
  revision: { header: { title: 'Revision desk' }, sections: [['columns', 'Due and overdue columns', true, false], ['completed', 'Recently completed', true, true]] },
  decks: { header: { title: 'Formula & flashcards', subtitle: 'Rate each card. Good and Easy push it further out.' }, sections: [['summary', 'Due cards', true, true], ['filters', 'Deck picker', true, false]] },
  'study-now': { header: { title: 'Study now', subtitle: 'Your most useful next task.' }, sections: [['exam-mode', 'Exam Mode card', true, false], ['tracks', 'Track readiness', true, false]] },
  planner: { header: { title: 'Planner' }, sections: [['grid', 'Planner board', true, false]] },
  settings: { header: { title: 'Settings' }, sections: [['tabs', 'Settings tabs', false, false], ['panels', 'Settings panels', true, false], ['panel-account', 'Account tab', true, false], ['panel-exam', 'Exam tab', true, false], ['panel-appearance', 'Appearance tab', true, false], ['panel-rhythm', 'Study rhythm tab', true, false], ['panel-data', 'Data tab', true, false]] },
  profile: { header: { title: 'Profile', eyebrow: 'PROFILE' }, sections: [['card', 'Profile card', true, false]] },
  backup: { header: { title: 'Export & backup', subtitle: 'Download, import or report your data.' }, sections: [['exports', 'Export cards', false, false], ['report', 'Report builder', true, false], ['import', 'Import section', false, false], ['security', 'Security note', false, true]] }
}

const PAGE_PARTS: ComponentDef[] = STUDENT_PAGES
  .filter(page => page.id !== 'home' && page.id !== 'shell')
  .flatMap(page => {
    const spec = PAGE_SPECS[page.id as keyof typeof PAGE_SPECS]
    const header: ComponentDef[] = spec.header ? [{
      id: `${page.id}.header`, page: page.id, label: 'Page header', kind: 'section', parent: page.id, caps: caps({ required: true, hideable: false, reorderable: false, interactive: true }),
      text: {
        title: text('Page title', spec.header.title, 40),
        ...(spec.header.subtitle ? { subtitle: text('Info tip text', spec.header.subtitle, 160) } : {}),
        ...(spec.header.eyebrow ? { eyebrow: text('Eyebrow', spec.header.eyebrow, 40) } : {})
      },
      note: 'Its action button keeps its real behaviour.'
    }] : []
    const sections: ComponentDef[] = spec.sections.map(([key, label, dataBound, optional, texts]) => ({
      id: `${page.id}.${key}`, page: page.id, label, kind: 'section' as const, parent: page.id,
      caps: caps({ required: !optional, hideable: optional, reorderable: false, dataBound, interactive: dataBound }),
      ...(texts ? { text: texts } : {}),
      ...(dataBound ? { data: { records: 'Values from the student’s own records' } } : {})
    }))
    const root: ComponentDef = { id: page.id, page: page.id, label: page.label, kind: 'page', parent: null,
      caps: caps({ required: true, hideable: false, reorderable: false, dataBound: true, interactive: true }),
      children: [...header, ...sections].map(item => item.id), data: { records: 'The student’s own records on this page' } }
    return [root, ...header, ...sections]
  })

/**
 * Static wording of each page, its sub-tabs and dialogs (headings, button text, field labels,
 * helper and empty-state text), generated from literal source strings only. One component per
 * page, outside the section order; values are plain text, so a label can never show data.
 */
const PAGE_TEXT: ComponentDef[] = Object.entries(PAGE_LABELS).map(([page, labels]) => ({
  id: `${page}.labels`, page: page as StudentPageId, label: 'Page text', kind: 'section' as const, parent: null,
  caps: caps({ required: true, hideable: false, reorderable: false }),
  text: Object.fromEntries(labels.map(([key, value]) => [key, text(value.length > 60 ? `${value.slice(0, 57)}…` : value, value, Math.min(240, Math.max(40, value.length * 2)))])),
  note: 'Every static label on this page, including its sub-tabs and dialogs. Double-click a label on the canvas to edit it in place.'
}))

export const COMPONENTS: readonly ComponentDef[] = [...SHELL, ...HOME, ...PAGE_PARTS, ...PAGE_TEXT]
export const COMPONENT_MAP: ReadonlyMap<string, ComponentDef> = new Map(COMPONENTS.map(def => [def.id, def]))

/** Sidebar groups and their routes, in shipped order (mirrors AppShell navGroups). */
export const NAV_GROUPS: ReadonlyArray<{ id: string; caption: string; routes: readonly string[] }> = [
  { id: 'study', caption: 'STUDY', routes: ['/', '/focus', '/backlog', '/practice'] },
  { id: 'syllabus', caption: 'SYLLABUS', routes: ['/syllabus', '/weak-areas', '/pyqs'] },
  { id: 'tests', caption: 'TESTS', routes: ['/tests', '/mock-analysis', '/mistakes', '/retry', '/analytics'] },
  { id: 'revision', caption: 'REVISION', routes: ['/revision', '/decks'] },
  { id: 'planning', caption: 'PLANNING', routes: ['/study-now', '/planner', '/settings'] }
]
/** The only sidebar way to reach these, so they can never be hidden. */
export const NAV_ALWAYS_VISIBLE: readonly string[] = ['/', '/settings']

/**
 * Keys that always mean "a student value" wherever they appear. A configuration carrying
 * one of them (as a text, prop or config key) is rejected with `data_locked`, even on a
 * component that does not list it, so data overrides can never slip in under another name.
 */
export const DATA_KEY_PATTERN = /^(value|values|data|source|binding|bind|query|record|records|student|user|name|email|date|dates|time|timer|marks?|scores?|percent(age)?|count|counts|streak|progress|total|days?|minutes|result|results|notes?|exam|tasks?)$/i
