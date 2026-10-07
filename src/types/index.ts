export const SUBJECTS = ['Physics', 'Chemistry', 'Maths'] as const
export type Subject = (typeof SUBJECTS)[number]
export type ChapterStatus = 'Not Started' | 'Studying' | 'Done' | 'Revised'
export type Priority = 'High' | 'Medium' | 'Low'
export type TestType = 'Chapter Test' | 'Subject Test' | 'Full Mock' | 'PYQ Practice'
export type MistakeType = 'Concept' | 'Silly' | 'Calculation' | 'Time' | 'Guess'
export type RetryStatus = 'pending' | 'retried'
export type ThemeMode = 'light' | 'dark' | 'auto'

export interface BaseRecord {
  id: string
  user_id?: string
  created_at: string
  updated_at: string
}

export interface Chapter extends BaseRecord {
  subject: Subject
  name: string
  position: number
  status: ChapterStatus
  priority: Priority
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

export interface StudySession extends BaseRecord {
  subject: Subject | null
  chapter_id: string | null
  started_at: string
  ended_at: string | null
  duration_minutes: number
  completion_state: 'completed' | 'interrupted'
  mode: 'Pomodoro' | 'Short Break' | 'Long Break' | 'Custom'
}

export interface AppSettings extends BaseRecord {
  owner_name: string
  main_exam_date: string
  advanced_exam_date: string
  target_score: number
  theme: ThemeMode
  weak_threshold: number
  strong_threshold: number
  dropping_threshold: number
  revision_gaps: number[]
  daily_study_goal_minutes: number
  last_backup_at: string | null
  sound_enabled: boolean
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
  profile: Profile | null
}
