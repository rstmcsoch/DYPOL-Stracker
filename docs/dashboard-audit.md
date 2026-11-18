# Student Dashboard — Feature Audit & Roadmap

_Scope: the authenticated student experience (web `src/`, mirrored by `mobile/`). Not the public site, control center, or auth flows._
_Basis: routes in `src/lib/app-routes.ts`, nav in `src/components/AppShell.tsx`, 27 page files, 19 client data tables, 29 AI tools in `api/_lib/tools.ts`._

---

## 1. What exists today

### 1.1 Surface area

| Area | Pages | State |
|---|---|---|
| Planning | Home, Study plan (`/planner`), Study now (`/study-now`), Backlog (`/backlog`) | Deep, some overlap |
| Learning | Syllabus (`/syllabus`), Practice log (`/practice`), PYQ tracker (`/pyqs`), Focus (`/focus`) | Strong |
| Testing | Tests (`/tests`), Mock analysis (`/mock-analysis`), Mistake notebook (`/mistakes`), Retry (`/retry`) | Strong, one duplicate view |
| Revision | Revisions (`/revision`), Formulas & flashcards (`/decks`) | Solid, narrow |
| Insight | Analytics (`/analytics`), Weak areas (`/weak-areas`) | Good, gaps in mock/time analysis |
| Account | Profile (`/profile`), Settings (`/settings`), Export & backup (`/backup`, hidden from nav) | Profile is thin |

**Supporting systems that are already built well:**
- **Deterministic recommendation engine** (`src/lib/jee/recommend.ts`) — ranks revisions, backlog, flashcards, retries, weak chapters, PYQs and mock losses with human-readable reasons. This is the product's best differentiator.
- **Explainable analytics** (`src/lib/analytics.ts`, `src/lib/jee/*`) — thresholds, trend, "dropping", weighted vs raw syllabus progress, practice-signal cut-off (20+ questions), weekly report with week-over-week comparisons.
- **Data integrity** — zod schemas shared between client and server (`src/lib/*-validation.ts`), offline Dexie cache + ordered sync queue, owner-scoped RLS, full JSON backup with preview-and-merge import, CSV export, PDF/DOCX report builder.
- **Exam-agnostic model** — `Subject` is any string, exam catalogue covers JEE/NEET/CUET/CA/CS/CMA/school boards; JEE-specific logic is gated by `isJeeSettings()`.
- **AI copilot with guardrails** — BYOK providers, 29 typed tools, every write goes through an explicit confirm card with expiry; reads are canonical analytics, not model arithmetic.
- **Platform hygiene** — PWA, route-level lazy loading with chunk recovery, layout admin (`student_layout` draft/publish), text-override layer (`T`), 82 test files.

### 1.2 What the Home page actually renders

Header → exam countdown + streak → Study-now card → exam-mode strip → today's plan (6 tasks) + aside (study time ring, revision desk, study tip) → snapshot strip (today/week split, syllabus raw + weighted, practice & PYQ, track readiness, reminders) → latest-test checkpoint + syllabus progress by subject → AI launcher FAB + quick actions.

Roughly **11 distinct cards above the fold on desktop, 9 on mobile**. Every one is individually well-built; together they are the main problem (see §2).

---

## 2. Problems worth fixing

### 2.1 Home is a dashboard of dashboards
The snapshot strip repeats numbers already shown in the hero (countdown, chapters covered), in Study-now (what to do), in the revision card (due count) and in the checkpoint (latest test). The prior simplification pass removed some duplication but **the page still has no single focal point** — the student opens it and has to scan 11 cards to answer "what do I do in the next 40 minutes?"

### 2.2 Navigation doesn't match the student's mental model
- 17 sidebar items in 5 groups; `Profile` only exists in the drawer and the mobile bar; `Backup` is in neither (reachable only via Settings → Data).
- "Study now", "Study plan", "Backlog" and "Today's plan" are **four entry points to the same job** (deciding what to work on next).
- Mobile bar is Home / Tests / Analytics / Profile — Analytics over Planner or Focus, which are daily-use pages.
- "Tests" and "Test history" are used interchangeably (page title is "Test history", nav says "Tests").

### 2.3 Two parallel mistake taxonomies
`MistakeType` = Concept / Silly / Calculation / Time / Guess.
`ErrorCategory` (mock analysis) = Silly mistake / Concept gap / Calculation error / Time pressure / Misread question / Guess / Unattempted.

The same failure gets a different label depending on whether it came from the notebook or the mock deep-dive, so **mistake patterns can't be aggregated across both**. `TestErrorLog` also has no link to a `Mistake`, so "log this lost-mark as a mistake" is impossible.

### 2.4 Data captured but never used
- `PyqRecord.questions_total` / `questions_done` exist and are never surfaced — PYQs are year-grid only, so "60% of 2023 Main" is impossible to express.
- `Chapter.weightage` is a free-text badge that feeds no calculation while `importance` drives weighted progress; two competing "how much does this chapter matter" fields confuse the modal.
- `TestTimeEntry` (per-subject time & attempts) is captured in Mock analysis but never compared across mocks, and `TestRecord.time_minutes` never enters any chart.
- `PracticeSession.time_minutes` is logged but no per-question speed metric exists anywhere.

### 2.5 Retention mechanics are incomplete
- Streak has no grace: one missed day at 15 minutes resets months of work. No freeze, no rest day, no "week off" mode.
- Reminders are a single daily browser notification at one time (`shouldFireToday`), with no per-item nagging, no service-worker scheduling (so nothing fires when the tab is closed on mobile), and no re-engagement path.
- No goal surfaced on Home beyond the daily minute ring; weekly goals live one click away in Planner.

### 2.6 Mock analysis stops at classification
Lost marks are tagged and summed, but there is no **percentile/rank band, no per-subject time-vs-accuracy quadrants, no comparison to the previous mock per section, and no "this is a repeat offender" flag** tied to mistake history. Insights are one-line derived facts, not a strategy.

### 2.7 Small but real friction
- Manual study time is impossible: the only way to log minutes is the focus timer or a practice block with time. A student who studied offline can't record it (`study_sessions` has no manual entry UI).
- Retry is an 80-line read-only view of mistakes filtered by `retry_later` — a whole sidebar item for a filter.
- Profile is 44 lines (avatar, 3 streak numbers, exam picker) and duplicates Settings.
- Flashcards can only be reviewed chapter-by-chapter; "due overall" is displayed but **has no button**, and all-due review across chapters is missing. There's also no bulk/paste import for cards.
- No way to get a starter plan: onboarding seeds 64 chapters and nothing else — no first-week tasks, no default weekly goal.
- Syllabus has no import/paste path, so a CA/NEET student with their own chapter list must add ~30 rows by hand.
- Settings → Data "Reset all data" doesn't cover every user table (e.g. `practice_sessions`, `pyq_records`, `backlog_items`, `study_cards`, `test_error_logs`).

---

## 3. Improve — existing features

Ordered by impact per unit of effort.

### P0 — do first (highest leverage)

1. **Give Home one focal point.** Keep: greeting + countdown, **one** "do this now" card (Study-now), today's plan, streak. Move study-time ring and revision desk into that same card row as *indicators*, and collapse the snapshot strip into a single "This week" line. Target: **≤6 blocks, everything above the fold on a 390×844 screen.** Reuse `useLayoutOrder` so admins can re-pin what they want.
2. **Consolidate the "what now" family.** `/study-now` becomes the *expanded* view of the Home card (same component, `layoutAttrs` variant) rather than a separate destination with its own exam-mode + track-readiness blocks. Backlog folding belongs in the same page as a "backlog" tab, not a top-level item.
3. **Merge Retry into Mistake notebook** as a third tab (All / Retry list / Retried). Keep `/retry` as a redirect with `?filter=retry` for existing deep links; delete the 80-line page.
4. **Unify mistake + error taxonomy.** Add `Mistake.cause: ErrorCategory` (nullable, backfilled from `mistake_type`) and `Mistake.test_id`, then add a "Turn into a mistake note" action on each `TestErrorLog` row. One aggregation in Weak areas: "Top causes: Silly 42%, Concept 31%…" across notebook + mocks.
5. **Make PYQs question-granular.** In the year cell, offer `12/30` editing (questions done / total) with the year auto-completing at 100%. Existing year-grid toggle stays as the fast path. Unlocks "% of Main PYQs done" as a real readiness input in `trackReadiness`.
6. **Manual study time.** "Add time" dialog on Focus (and Home's study-time card): date, minutes, activity, optional chapter. Writes a `study_sessions` row with `mode: 'Custom'`, `completion_state: 'completed'`. This single addition makes the streak, weekly goals and study-time charts honest for offline study.

### P1 — next

7. **Streak that survives real life.** One "rest day" per week that doesn't break the chain (shown as an amber dot), plus a `streak_freezes` allowance (1/month, earned by a 7-day streak). Keep the rule copy honest — it's already excellent ("15+ min… a test counts").
8. **Weekly goal on Home.** One compact ring/bar under the streak using `getGoalProgress`, so the target is visible where the student opens the app.
9. **Mock analysis v2.** Add: delta vs previous mock per subject; time-per-question vs accuracy per subject (`TestTimeEntry`); repeat-offender list (chapters that appear in ≥2 mocks' error logs); "what to fix first" ordered by marks-recoverable, not by count.
10. **Practice speed/accuracy.** Per chapter, show (a) accuracy, (b) average seconds per question when time was logged, and (c) a **quadrant** — fast+accurate, slow+accurate, fast+wrong, slow+wrong. This is the single most actionable JEE diagnostic you can compute from existing fields.
11. **Flashcards: review everything due.** "Review all N due" across chapters with a subject filter; keep the per-chapter ladder view. Add paste-import (`front | back` per line) mirroring `importFormulaNotes`.
12. **Syllabus import.** "Paste a chapter list" (one per line) + optional CSV, validated through the existing zod chapter schema; dedupe by name within subject. Makes every non-JEE exam viable without hand-typing.
13. **Settings → Data: correct the reset list.** Use `TableName` to drive the wipe so new tables can never be forgotten; add per-table counts in the confirm dialog.
14. **Profile earns its slot or loses it.** Recommended: keep it as the mobile "you" tab and give it: exam + track picker (already there), streak calendar (30-day grid), weekly report card, backup status, sign-out. Otherwise drop the route and put the gear in the AppShell top bar for mobile.

### P2 — polish

15. Settings → Study rhythm should own **focus durations** (Pomodoro / short / long), currently fixed at 25/5/15 while only `Custom` is editable.
16. Mobile bottom bar: Home / **Planner** / **Focus** / Tests, with Analytics moved into the drawer. Planner and Focus are daily; Analytics is weekly at best. (Make it layout-config-driven rather than hardcoded, since `student_layout` already exists.)
17. Rename for consistency: nav "Tests" ↔ page title "Test history" → pick one ("Tests"). Sidebar "Revisions" → "Revision desk" matches the page.
18. Home's "Study tip" is a static heuristic string; turn it into the Weekly report's `actionable` line so it changes with real data.
19. Analytics: add **time allocation by subject** (sessions ⋈ chapters) and **study-time vs marks** scatter; both are already computable and both answer questions the current 6 charts can't.
20. Empty states already good — extend the same treatment to "no weekly goal", "no cards due", "no PYQ years configured".

---

## 4. Add — new features, ranked

Grouped by theme; effort in rough dev-days for one engineer familiar with the codebase.

### A. Close the loop on mistakes (2–3 d)
| Feature | Why | Where |
|---|---|---|
| Retry scheduling | "Retry later" items currently sit forever. Give them a `retry_due_on` (default +7 d) and a spaced 2nd retry. | `Mistake`, `RetryPage` → tab |
| Mistake → flashcard | One tap turns a mistake into a `StudyCard` (front = question note, back = solution); closes the recall loop. | `MistakesPage`, `DecksPage` |
| Repeated-mistake detector | "You've made a Silly mistake in Current Electricity 3× this month." | `lib/analytics` + Home tip |

### B. Exam-day realism (3–5 d)
| Feature | Why |
|---|---|
| **Mock percentile band** | Students care about "where am I", not just marks. Either user-entered percentile per mock (zero-dependency, honest) or a published marks→percentile table per year. Both fit `TestRecord`. |
| **Countdown-aware plan** | Exam mode already flips at 30 days; extend it to a 90/30/7-day plan shape (build → consolidate → revise-only) surfaced in Study-now's reason copy. |
| **Sitting planner** | "You have 3 mocks left before Main S1" — schedule mock dates and warn when the gap >14 days (the reminder rule already exists). |
| **PYQ mock mode** | Time a full PYQ paper using the focus timer, then log it as a `PYQ Practice` test in one flow. |

### C. Motivation without a leaderboard (2–4 d)
| Feature | Why |
|---|---|
| **Streak calendar** | 30/90-day grid with rest days and freezes; cheap, high emotional value, pure client compute from `sessions`/`tests`. |
| **Personal records** | Longest focus block, best mock, most questions in a day, first 100% chapter test. Stored as derived facts, no new table. |
| **Weekly report email/notification** | `buildWeeklyReport` already produces the content; ship it as a Sunday push/email digest. |
| **Milestone badges (private)** | 7/30/100-day streak, 1000 questions, all PYQs for a chapter. Keep them **private by default** — see §5 on why a leaderboard is a bad idea here. |

### D. Study mechanics (4–6 d)
| Feature | Why |
|---|---|
| **Formula sheet export** | Per subject, compile `Chapter.formula_notes` + `formula` cards into a print/PDF sheet. Backed by the existing report builder. |
| **Session notes on focus blocks** | Attach "what I actually did" to `StudySession`; feeds the weekly report. |
| **Backlog from syllabus gaps** | "Chapters with status Studying for >21 days" → one-click create backlog items. |
| **Daily target per subject** | Split `daily_study_goal_minutes` into per-subject targets; the ring becomes three arcs. Big for students whose weaker subject keeps getting skipped. |

### E. Accessibility & reach (ongoing)
- Keyboard-first flows exist (⌘K, shortcuts, focus Space) — add `?` help to the mobile drawer.
- Verify all new charts have text equivalents (Analytics cards already expose CSV).
- The `T` override layer makes copy changes safe; use it for anything student-facing.

---

## 5. Remove / merge — and what *not* to add

| Item | Action | Rationale |
|---|---|---|
| `/retry` page | **Merge** into Mistakes as a tab; redirect old links | 80-line filter view promoted to a sidebar item |
| `/study-now` page | **Merge** into Home's recommendation card + expanded view | Same component, second destination |
| Snapshot strip duplicate stats | **Remove** countdown/chapters duplicates already in hero | One statistic, one place |
| `Profile` page (as-is) | **Merge** into Settings, or rebuild as the mobile "you" hub | 44 lines, no unique function |
| `sidebar-search` + FAB + quick actions + ⌘K | **Keep**, but make the FAB the *single* "add" affordance on mobile | Four paths to "add a test" today |
| `weightage` free text | **Demote** to a note field, or promote to a number that feeds weighted progress — not both | Two competing importance signals |
| `Backup` hidden route | **Keep**, but surface a status chip in Settings (already partly done) | Backup is a safety feature; hiding it is fine, forgetting it isn't |

**Do not add:**
- **Leaderboards / rank vs other students.** It contradicts the product's own stance ("not a verdict", explainable thresholds, private notebook) and invites cheating + anxiety. Personal records and percentile bands deliver the same information safely.
- **A second AI surface** (e.g. a separate "AI planner" page). The copilot already has 29 tools and a floating launcher; extra entry points dilute the confirmable-write model.
- **Social feed / study groups.** No moderation surface exists (`control` RBAC is admin-only), and it's the single largest unowned risk in a student app.
- **Question banks / content library.** PYQs are tracked, not served; shipping content means licensing and a content pipeline. Stay a tracker.
- **Generic habit tracker.** The streak + weekly goals + planner already cover it; a generic habit module would be a fourth planning surface.

---

## 6. Suggested sequence

| Sprint | Ship | Expected effect |
|---|---|---|
| 1 | Manual study time · Merge Retry · Home focal-point pass · Fix Settings reset list | Removes the three loudest friction points; no schema risk |
| 2 | Unified mistake taxonomy (+ mock → mistake) · Questions-done on PYQs · Streak rest day/freeze | Data model foundations; makes later analytics cheap |
| 3 | Mock analysis v2 · Practice speed/accuracy quadrant · Weekly goal on Home | The "why are my marks stuck" answers |
| 4 | Flashcard all-due review + paste import · Syllabus import · Formula sheet PDF | Removes the biggest setup/throughput ceilings |
| 5 | Streak calendar · Personal records · Weekly digest · Profile rebuild (or removal) | Retention loop closes |

**Measurement already exists** — `analytics_events` and the rollup tables can answer: cards per session, time-to-first-task after login, Retry page visits before/after merge, and (most importantly) share of return sessions where a task was completed within 10 minutes of opening Home.

---

## 7. One-paragraph verdict

The student dashboard is **feature-rich and unusually honest** — deterministic recommendations with visible reasons, no invented percentages, offline-first sync, and an AI layer that can't silently write. Its problem is not capability but **shape**: 17 destinations for what are really five jobs (plan, learn, practise, test, review), a Home page that shows everything instead of one thing, and a handful of fields that are captured but never used. Fixing the shape — merge Retry/Study-now, give Home a focal point, unify the mistake taxonomy, surface questions-done and manual study time — buys more perceived improvement than any new feature, and it makes the genuinely good engines underneath finally visible.

---

## 8. Implementation status (2026-11-18)

Everything below is in the working branch. Anything that could not be shipped honestly is
listed as such, with the reason — no half-features described as finished.

### Shipped

| Area | What landed | Where |
|---|---|---|
| P0 | Manual study time, Retry merged into the mistake notebook tabs, Home focal-point pass, Settings reset covers every owner table | `HomePage`, `MistakesPage`, `SettingsPage` |
| Mistake taxonomy | `cause` on `Mistake` (`Silly mistake` … `Unattempted`), shared with mock error logs so a slip counts once | `lib/mistake-cause`, `MistakesPage`, `MockAnalysisPage` |
| Spaced retry | `retry_due_on` + 7/21-day ladder, retire after the 2nd pass | `RetryPanel`, `lib/mistake-cause` |
| Mistake → flashcard | One tap makes a `StudyCard` from a mistake | `MistakesPage` |
| Repeat-offender detector | 3+ same-cause mistakes in 30 days, surfaced as a SmartTip and on Weak areas | `lib/analytics`, `WeakAreasPage` |
| Mock analysis v2 | Per-subject deltas, repeat chapters, fix-first list, **percentile band** (reported value wins; otherwise a labelled 300-mark estimate clamped below 100) | `lib/jee/mock-analysis`, `MockAnalysisPage` |
| PYQ timed paper | "Log a timed paper" writes a `PYQ Practice` test and marks the chapter-years done | `PyqPage` |
| Countdown shapes | build ≤90 d / consolidate ≤30 d / revise-only ≤7 d plan shape | `lib/jee/exam`, `StudyNowPage` |
| Sitting planner | Booked mocks + a reminder when the gap between sittings exceeds 14 days | `lib/jee/reminders` |
| Streak calendar | 30/90-day grid with rest days and monthly freezes (one per calendar month, earned by a 7-day run) | `StreakCalendar` |
| Personal records / badges | Longest block, best mock, questions in a day, longest streak, total questions; private milestones | `lib/jee/records`, `ProfilePage` |
| Weekly digest | `buildWeeklyReport` surfaced on Home on Sunday/Monday only; full card stays in Analytics | `components/jee/WeekDigest` |
| Formula sheet | Per-subject print/PDF from `formula_notes` + formula cards, button on Decks | `lib/report`, `DecksPage` |
| Session notes | "What did you actually do?" on every focus block; flows into backup and the digest | `FocusContext`, `FocusPage`, `lib/backup` |
| Backlog from syllabus gaps | Chapters stuck in `Studying` for 21+ days → one click turns them into backlog items due in a week, priority rises at 35 days | `BacklogPage` |
| Per-subject daily targets | Optional minutes per subject; Home shows one bar per *set* target and hides the section entirely when nothing is set | `SettingsPage`, `HomePage`, `lib/jee/study-time` |
| Chart text equivalents | Every Analytics chart has a visually-hidden data table | `AnalyticsPage` |
| Empty states | No weekly goal, nothing due in a deck (says when the next card returns), empty backlog, empty digest week | `HomePage`, `DecksPage`, `WeekDigest` |

### Deliberately not shipped

| Asked for | Why not |
|---|---|
| **Weekly digest by email or push** | The app has no mail sender and no server-side scheduler, and the browser can only notify while the tab is open. Faking a "sent" digest would be a lie, so the digest is delivered in-app on the two days it is useful. Real email needs a backend job plus an address on file — out of scope for a client-only change. |
| **Percentile as a prediction** | Only an estimate from a published-style marks→percentile curve; it is labelled *Estimated*, ignores session normalisation, and the student's own reported percentile always overrides it. No rank, no college prediction. |
| **Leaderboards / rank vs other students** | Rejected on product grounds (see §5): it contradicts the app's stated stance and invites anxiety. |
