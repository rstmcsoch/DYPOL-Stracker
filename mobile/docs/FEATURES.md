# Feature and test summary

## Screens (22 areas, 60 Dart files)

| Area | File(s) | What a student can do | Writes to |
|---|---|---|---|
| Auth | `features/auth/*` | sign in, sign up (with display name), resend confirmation, password reset, recovery deep link, change password in-app | Supabase Auth, `profiles` |
| Splash | `features/splash` | brand splash while the session restores; no timed delay | — |
| Shell | `features/shell` | four tabs, drawer with 19 destinations plus AI, global search, sync pill, light/night switch | — |
| Home | `features/home` | today's numbers, due revisions, next actions, exam countdown, weekly report | — |
| Syllabus | `features/syllabus` | per-subject progress, status/priority/importance, notes, formula notes, five-stage pipeline, PYQ years, add/edit/delete chapters | `chapters`, `chapter_stages`, `pyq_records`, `chapter_revisions` |
| Tests | `features/tests` | log a test with marks, attempt counts, time, subject scores, error log, timing, chapter links; edit and delete | `tests`, `test_subject_scores`, `test_error_logs`, `test_time_entries`, `test_chapter_links` |
| Practice | `features/practice` | log a DPP with attempted/correct/incorrect, minutes, source, notes | `practice_sessions` |
| PYQs | `features/pyq` | mark a chapter's PYQ year as done for Main/Advanced; window from settings | `pyq_records` |
| Mistakes | `features/mistakes` | typed mistakes by category, question and solution notes, private image, retry flags | `mistakes`, `mistake-images` bucket |
| Retry | `features/retry` | work the retry queue, mark resolved or later | `mistakes` |
| Planner | `features/planner` | daily tasks with priority, estimate, completion; weekly goals | `daily_tasks`, `weekly_goals` |
| Revisions | `features/revision` | R1/R7/R30 ladder, complete a revision (schedules the next), schedule a finished chapter | `chapter_revisions` |
| Analytics | `features/analytics` | syllabus %, accuracy, trend line, subject signals, mistake mix, study prompts | — |
| Weak areas | `features/analytics/weak_areas_page.dart` | chapters below the threshold, dropping chapters, weak-by-practice, untested | — |
| Mock analysis | `features/mock` | lost marks by error category, minutes per subject, insights, chapter links | — |
| Backlog | `features/backlog` | add, snooze, complete, delete backlog items | `backlog_items` |
| Decks | `features/decks` | formulas and flashcards, R1/R7/R30 review ladder with difficulty | `study_cards` |
| Focus | `features/focus` | timer with break modes, subject/chapter, writes a completed session | `study_sessions` |
| Study now | `features/studynow` | the deterministic recommendation with reasons and alternatives | — |
| Backup | `features/backup` | export JSON and per-table CSV, share, import from pasted text with a preview | `app_settings.last_backup_at` + 19 tables on import |
| Settings | `features/settings` | exam, dates, tracks, thresholds, weights, reply gaps, daily goal, PYQ window, reminders, theme/palette/font, password | `app_settings` |
| Profile | `features/profile` | identity, exam tracks, account actions, owner-console note | `profiles`, `user_exam_tracks`, `app_settings` |
| AI | `features/ai` | streaming assistant chat, conversations, provider setup with BYOK | `/api/ai/*` (server side) |

## Shared logic (pure Dart, unit-tested)

`logic/analytics.dart` — percentage validity (half marks, whole totals, 0…total), full-mock
aggregation only when every subject row is present, chapter performance with weak/strong/
dropping thresholds from the account, subject signals, mistake summary.
`logic/progress.dart` — syllabus raw and weighted completion, practice accuracy with the
20-attempt signal floor, PYQ year windows, five-stage pipeline, next-cycle step.
`logic/aggregation.dart` — daily activity, study totals, streaks (15-minute rule), 28-day
consistency strip, weekly report.
`logic/revision.dart` — revision buckets and the gap-ladder.
`logic/recommend.dart` — deterministic "what should I study now" with reasons,
importance weighting and the 30-day Exam Mode boost.
`logic/mock.dart` — error-category aggregation and written insights.
`logic/cards.dart` — flashcard ladder.
`logic/exam.dart` — tracks, dates, Exam Mode.
`logic/backup.dart` — payload, counts, tolerant import, CSV.
`logic/reminders.dart` — in-app reminder lines.

## Test inventory

12 files, 51 test cases:

| File | Cases |
|---|---|
| `analytics_test.dart` | 7 |
| `revision_test.dart` | 3 |
| `recommend_test.dart` | 4 |
| `codec_test.dart` | 4 |
| `cards_test.dart` | 5 |
| `syllabus_test.dart` | 5 |
| `date_format_test.dart` | 4 |
| `exam_mode_test.dart` | 5 |
| `aggregation_test.dart` | 4 |
| `mock_test.dart` | 3 |
| `validators_test.dart` | 5 |
| `widgets_test.dart` | 8 |

They exercise the ported maths against hand-computed expectations, the JSON/cache/backup
round trip, input validation, and the shared widgets (including night mode and 1.6× text
scaling). Execution status: **not run here** — see `VERIFICATION.md`.
