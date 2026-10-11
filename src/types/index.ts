export const SUBJECTS = ['Physics', 'Chemistry', 'Maths'] as const
export type Subject = (typeof SUBJECTS)[number]
export type ChapterStatus = 'Not Started' | 'Studying' | 'Done' | 'Revised'
export type Priority = 'High' | 'Medium' | 'Low'
export type TestType = 'Chapter Test' | 'Subject Test' | 'Full Mock' | 'PYQ Practice'
export type MistakeType = 'Concept' | 'Silly' | 'Calculation' | 'Time' | 'Guess'
export type RetryStatus = 'pending' | 'retried'
export type ThemeMode = 'light' | 'dark' | 'auto'

/**
 * User-selectable Reading fonts affect authenticated content only. Patrick Hand is
 * reserved for identity typography and is deliberately not part of this union.
 */
export const READING_FONTS = ['default', 'poppins', 'sora', 'open-sans'] as const
export type ReadingFont = (typeof READING_FONTS)[number]

/**
 * Account-scoped colour theme. Independent of the light/dark/auto display mode:
 * every theme ships a light AND a dark palette, applied via `data-color` on the
 * document root while `data-theme` keeps owning the mode. `default` is the
 * established Stracker warm-paper/chalkboard identity.
 */
export const COLOR_THEMES = [
  'default',
  'sunset-blaze',
  'forest-emerald',
  'sandalwood',
  'ocean-deep',
  'sakura-blossom',
  'dracula-midnight',
  'lavender-mist',
  'cyberpunk-neon'
] as const
export type ColorTheme = (typeof COLOR_THEMES)[number]

/** @deprecated Kept as a source-compatible alias for the legacy database column. */
export const INTERFACE_FONTS = READING_FONTS
export type InterfaceFont = ReadingFont

/* ------------------------------------------------------------------ */
/* Practice / DPP log                                                  */
/* ------------------------------------------------------------------ */

export const PRACTICE_SOURCES = ['DPP', 'Module', 'Practice sheet', 'Coaching material', 'Other'] as const
export type PracticeSource = (typeof PRACTICE_SOURCES)[number]

/** One logged practice block outside formal tests. Never counted as a mock/test attempt. */
export interface PracticeSession extends BaseRecord {
  chapter_id: string
  practice_date: string
  attempted: number
  correct: number
  incorrect: number
  source: PracticeSource
  time_minutes: number | null
  notes: string
}

/* ------------------------------------------------------------------ */
/* PYQ tracker                                                         */
/* ------------------------------------------------------------------ */

export const PYQ_EXAMS = ['Main', 'Advanced'] as const
export type PYQExam = (typeof PYQ_EXAMS)[number]
export type PYQStatus = 'done' | 'pending'

/**
 * One tracked PYQ slot for (chapter, exam, year). Real question-level datasets can be
 * imported later without changing this shape: `meta` carries optional question metadata
 * and `questions_total` / `questions_done` support question-granular progress.
 */
export interface PyqRecord extends BaseRecord {
  chapter_id: string
  exam: PYQExam
  year: number
  status: PYQStatus
  questions_total: number | null
  questions_done: number | null
  meta: Record<string, unknown> | null
  completed_at: string | null
}

/* ------------------------------------------------------------------ */
/* Chapter stages                                                      */
/* ------------------------------------------------------------------ */

export const CHAPTER_STAGES = ['Theory', 'Notes', 'PYQs', 'Revised', 'Tested'] as const
export type ChapterStageLabel = (typeof CHAPTER_STAGES)[number]
export const CHAPTER_STAGE_KEYS = ['theory', 'notes', 'pyqs', 'revised', 'tested'] as const
export type ChapterStageKey = (typeof CHAPTER_STAGE_KEYS)[number]

/**
 * Explicit stage toggle for one chapter stage. PYQs / Revised / Tested also derive
 * progress from real evidence (PYQ records, completed revisions, test results); the
 * stored row is the student's own claim and coexists with that evidence.
 */
export interface ChapterStage extends BaseRecord {
  chapter_id: string
  stage: ChapterStageKey
  done: boolean
  completed_at: string | null
}

/* ------------------------------------------------------------------ */
/* Backlog                                                             */
/* ------------------------------------------------------------------ */

export const BACKLOG_TYPES = ['Lecture', 'DPP', 'Topic'] as const
export type BacklogType = (typeof BACKLOG_TYPES)[number]
export type BacklogStatus = 'active' | 'done' | 'snoozed'

export interface BacklogItem extends BaseRecord {
  title: string
  type: BacklogType
  subject: Subject | null
  chapter_id: string | null
  priority: Priority
  due_on: string | null
  status: BacklogStatus
  snoozed_until: string | null
  completed_at: string | null
  notes: string
}

/* ------------------------------------------------------------------ */
/* Study time + consistency                                            */
/* ------------------------------------------------------------------ */

export const STUDY_ACTIVITIES = ['Lecture', 'Practice', 'Revision', 'Mock/Test', 'PYQ practice'] as const
export type StudyActivity = (typeof STUDY_ACTIVITIES)[number]

export interface StudySession extends BaseRecord {
  subject: Subject | null
  chapter_id: string | null
  started_at: string
  ended_at: string | null
  duration_minutes: number
  completion_state: 'completed' | 'interrupted'
  mode: 'Pomodoro' | 'Short Break' | 'Long Break' | 'Custom'
  /** Which kind of studying this block was. Defaults to 'Practice' for legacy rows. */
  activity: StudyActivity
}

/* ------------------------------------------------------------------ */
/* Formula / flashcard decks                                           */
/* ------------------------------------------------------------------ */

export const CARD_KINDS = ['formula', 'flashcard'] as const
export type CardKind = (typeof CARD_KINDS)[number]
export const CARD_DIFFICULTIES = ['easy', 'known', 'difficult'] as const
export type CardDifficulty = (typeof CARD_DIFFICULTIES)[number]

export interface StudyCard extends BaseRecord {
  chapter_id: string
  kind: CardKind
  front: string
  back: string
  hint: string
  position: number
  difficulty: CardDifficulty | null
  reviews: number
  last_reviewed_at: string | null
  next_review_at: string | null
}

/* ------------------------------------------------------------------ */
/* Mock deep-dive                                                      */
/* ------------------------------------------------------------------ */

export const ERROR_CATEGORIES = [
  'Silly mistake', 'Concept gap', 'Calculation error', 'Time pressure',
  'Misread question', 'Guess / bad attempt', 'Unattempted'
] as const
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number]

/** User-entered classification of lost marks for one mock/section. */
export interface TestErrorLog extends BaseRecord {
  test_id: string
  chapter_id: string | null
  subject: Subject | null
  category: ErrorCategory
  marks_lost: number | null
  questions: number | null
  note: string
}

/** Optional recorded time/attempt data per subject or section. Never invented when absent. */
export interface TestTimeEntry extends BaseRecord {
  test_id: string
  subject: Subject | null
  label: string
  minutes: number | null
  attempted: number | null
  unattempted: number | null
  order_index: number
}

/* ------------------------------------------------------------------ */
/* Exam tracks (Main S1 / Main S2 / Advanced / Boards)                 */
/* ------------------------------------------------------------------ */

export const TRACK_IDS = ['main1', 'main2', 'advanced', 'boards'] as const
export type TrackId = (typeof TRACK_IDS)[number]
export const EXAM_MODES = ['auto', 'on', 'off'] as const
export type ExamMode = (typeof EXAM_MODES)[number]

/** Per-user track configuration. One shared syllabus; tracks differ by date/target. */
export interface UserExamTrack extends BaseRecord {
  track: TrackId
  label: string
  exam_date: string | null
  enabled: boolean
  target_score: number | null
  notes: string
}

/* ------------------------------------------------------------------ */
/* Core records                                                        */
/* ------------------------------------------------------------------ */

export interface BaseRecord {
  id: string
  user_id?: string
  created_at: string
  updated_at: string
}

export type ChapterImportance = 'high' | 'medium' | 'low'

export interface Chapter extends BaseRecord {
  subject: Subject
  name: string
  position: number
  status: ChapterStatus
  priority: Priority
  /** Configurable importance bucket used by weighted progress (not a JEE weightage claim). */
  importance: ChapterImportance
  weightage: string | null
  notes: string
  formula_notes: string
  completed_on: string | null
}

export interface Revision extends BaseRecord {
  chapter_id: string
  revision_number: number
  due_on: string
  completed_at: string | null
}

export interface TestRecord extends BaseRecord {
  title: string
  test_date: string
  test_type: TestType
  subject: Subject | null
  chapter_id: string | null
  marks_obtained: number | null
  total_marks: number | null
  correct: number | null
  wrong: number | null
  skipped: number | null
  negative_marks: number | null
  time_minutes: number | null
  notes: string
}

export interface TestSubjectScore extends BaseRecord {
  test_id: string
  subject: Subject
  marks_obtained: number | null
  total_marks: number | null
}

export interface TestChapterLink extends BaseRecord {
  test_id: string
  chapter_id: string
  marks_obtained: number | null
  total_marks: number | null
}

export interface Mistake extends BaseRecord {
  chapter_id: string
  test_id: string | null
  mistake_type: MistakeType
  question_note: string
  solution_note: string
  image_path: string | null
  retry_later: boolean
  retry_status: RetryStatus
  image_data?: string | null
  image_preview?: string | null
  image_pending?: boolean
}

export interface DailyTask extends BaseRecord {
  title: string
  subject: Subject | null
  chapter_id: string | null
  estimated_minutes: number
  priority: Priority
  is_completed: boolean
  task_date: string
  position: number
}

export type GoalType = 'study_hours' | 'tests' | 'chapters' | 'revisions' | 'custom'
export interface WeeklyGoal extends BaseRecord {
  goal_type: GoalType
  title: string
  target: number
  progress_value: number
  week_start: string
  unit: string
}

export const REMINDER_KINDS = ['revision', 'backlog', 'practice', 'pyq', 'mock', 'plan'] as const
export type ReminderKind = (typeof REMINDER_KINDS)[number]

export interface AppSettings extends BaseRecord {
  owner_name: string
  main_exam_date: string
  advanced_exam_date: string
  target_score: number
  theme: ThemeMode
  /** Backward-compatible database column now presented as Reading font in the UI. */
  interface_font: ReadingFont
  /** Colour palette, kept separate from the light/dark/auto display mode. */
  color_theme: ColorTheme
  weak_threshold: number
  strong_threshold: number
  dropping_threshold: number
  revision_gaps: number[]
  daily_study_goal_minutes: number
  last_backup_at: string | null
  sound_enabled: boolean
  /** Multipliers for chapter importance buckets — configurable, not hardcoded in math. */
  weight_high: number
  weight_medium: number
  weight_low: number
  /** Configurable PYQ year window used for completion grids (no question content invented). */
  pyq_from_year: number
  pyq_to_year: number
  active_track: TrackId
  exam_mode: ExamMode
  reminders_enabled: boolean
  reminder_time: string
  reminder_types: ReminderKind[]
  /** Chosen exam from the catalogue; null = set up before exam choice existed (JEE). */
  exam_id: string | null
  exam_year: number | null
  /** Attempt/session, e.g. a CA attempt month. */
  exam_session: string | null
  /** School board, or the board for the Class 12 boards add-on. */
  exam_board: string | null
  /** Class 12 boards tracked alongside the main exam. */
  boards_addon: boolean
}

export interface Profile extends BaseRecord {
  display_name: string
  email: string
}

export interface AppData {
  chapters: Chapter[]
  revisions: Revision[]
  tests: TestRecord[]
  testSubjectScores: TestSubjectScore[]
  testChapterLinks: TestChapterLink[]
  mistakes: Mistake[]
  tasks: DailyTask[]
  goals: WeeklyGoal[]
  sessions: StudySession[]
  practiceSessions: PracticeSession[]
  pyqRecords: PyqRecord[]
  chapterStages: ChapterStage[]
  backlogItems: BacklogItem[]
  studyCards: StudyCard[]
  testErrorLogs: TestErrorLog[]
  testTimeEntries: TestTimeEntry[]
  examTracks: UserExamTrack[]
  settings: AppSettings
  profile: Profile | null
}

export type TableName =
  | 'chapters'
  | 'chapter_revisions'
  | 'tests'
  | 'test_subject_scores'
  | 'test_chapter_links'
  | 'mistakes'
  | 'daily_tasks'
  | 'weekly_goals'
  | 'study_sessions'
  | 'practice_sessions'
  | 'pyq_records'
  | 'chapter_stages'
  | 'backlog_items'
  | 'study_cards'
  | 'test_error_logs'
  | 'test_time_entries'
  | 'user_exam_tracks'
  | 'app_settings'
  | 'profiles'

export type RecordFor<T extends TableName> =
  T extends 'chapters' ? Chapter :
  T extends 'chapter_revisions' ? Revision :
  T extends 'tests' ? TestRecord :
  T extends 'test_subject_scores' ? TestSubjectScore :
  T extends 'test_chapter_links' ? TestChapterLink :
  T extends 'mistakes' ? Mistake :
  T extends 'daily_tasks' ? DailyTask :
  T extends 'weekly_goals' ? WeeklyGoal :
  T extends 'study_sessions' ? StudySession :
  T extends 'practice_sessions' ? PracticeSession :
  T extends 'pyq_records' ? PyqRecord :
  T extends 'chapter_stages' ? ChapterStage :
  T extends 'backlog_items' ? BacklogItem :
  T extends 'study_cards' ? StudyCard :
  T extends 'test_error_logs' ? TestErrorLog :
  T extends 'test_time_entries' ? TestTimeEntry :
  T extends 'user_exam_tracks' ? UserExamTrack :
  T extends 'app_settings' ? AppSettings : Profile

export interface QueuedChange {
  queueId?: number
  user_id: string
  table: TableName
  operation: 'upsert' | 'delete'
  id: string
  record?: Record<string, unknown>
  queued_at: string
}

export interface ExportBackup {
  app: 'Stracker'
  version: 1
  exported_at: string
  settings: AppSettings
  chapters: Chapter[]
  revisions: Revision[]
  tests: TestRecord[]
  testSubjectScores: TestSubjectScore[]
  testChapterLinks: TestChapterLink[]
  mistakes: Omit<Mistake, 'image_preview' | 'image_pending'>[]
  tasks: DailyTask[]
  goals: WeeklyGoal[]
  sessions: StudySession[]
  practiceSessions: PracticeSession[]
  pyqRecords: PyqRecord[]
  chapterStages: ChapterStage[]
  backlogItems: BacklogItem[]
  studyCards: StudyCard[]
  testErrorLogs: TestErrorLog[]
  testTimeEntries: TestTimeEntry[]
  examTracks: UserExamTrack[]
  profile: Profile | null
}
