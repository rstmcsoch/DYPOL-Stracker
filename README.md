# Stracker

**Stracker by DYPOL LABS** is a private, responsive study notebook for JEE 2027 preparation, published behind a public product homepage. It combines a seeded, editable syllabus with test tracking, mistake review, spaced revision, daily planning, focus sessions, analytics, and portable exports. The interface is designed to feel like a well-used notebook and works on desktop and mobile.

## What is included

- **Syllabus notebook:** Physics, Chemistry, and Maths topic lists; progress states, priorities, notes, formula notes, search, and reordering — drag a row's grip handle (mouse or touch) or open its ⋯ menu for *Move up / Move down*, notes, and delete.
- **Test journal:** chapter tests, subject tests, full mocks and PYQ practice; marks, correct/wrong/skipped counts, mock subject scores, chapter-level results, filters, and edits.
- **Mistake and retry notebooks:** typed mistake records, optional compressed question images, solution notes, and a dedicated retry workflow.
- **Revision planner:** configurable revision intervals, due/overdue lists, completion tracking, and chapter links.
- **Daily planner and weekly goals:** dated tasks, drag or button-based reordering, completion states, and derived or manually adjustable goal progress.
- **Focus timer:** Pomodoro, short break, long break, and custom blocks; timer state survives navigation and refresh, with optional locally generated sound and logged study sessions. Each block can be grounded to a subject, a chapter chosen from a searchable picker (the whole NTA-scale list filters as you type), and one of today's planner tasks.
- **Analytics:** subject and chapter signals, test trends, study time, streaks, mistake summaries, weak areas, and rule-based study prompts. Up to three favourite charts can be pinned to the top of the page (a per-browser preference), and a clearly-labelled example preview stands in until the first real test is logged. The weak-areas page keeps untested chapters in a collapsible section of tappable chips that jump straight to pre-filled test logging. Empty or incomplete data is shown as such rather than invented.
- **Exports and backups:** re-importable JSON notebook backup, UTF-8 test-history CSV, and selectable/date-ranged PDF and DOCX reports. Backup import validates records and relationships, previews the merge, and requires confirmation.
- **Privacy and offline support:** Supabase Auth, user-scoped PostgreSQL tables with RLS, a private image bucket, browser-local IndexedDB caching, and an owner-scoped sync queue for offline changes.
- **Appearance controls:** a light/night switch in the top-right corner (desktop header and mobile top bar) that stays in step with the theme choice in Settings, plus one application-wide font preference — Default (Poppins), Poppins, Sora, or Open Sans.
- **Public homepage and separate authentication:** a marketing-free product homepage on `/` for visitors, dedicated `/login` and `/signup` pages, and password recovery on `/reset-password`. Signed-in visitors go straight to the notebook instead.
- **JEE preparation system:** a Practice / DPP log per chapter (attempted, correct, incorrect, accuracy, source, optional time) kept separate from tests; a PYQ tracker for JEE Main and Advanced by year, with bulk actions and configurable year range; five independent chapter stages (Theory → Notes → PYQs → Revised → Tested) that accept real evidence from revisions, tests and PYQ records; a Backlog for skipped lectures, unsolved DPPs and come-back topics with snooze, due dates and grouping; weighted syllabus progress shown beside the raw count; study time split into Lecture, Practice and Revision, with a streak rule stated in the UI; mock deep-dive with time and attempts per subject, lost-mark classification and derived "fix before your next mock" insights; formula and flashcard decks on the R1 → R7 → R30 ladder; exam tracks (Main Session 1 and 2, Advanced, Boards) over one shared syllabus with Exam Mode in the final 30 days; a deterministic “What should I study now?” engine that explains every ranking; a weekly report that only compares weeks with real data; and in-app plus browser-notification reminders.
- **Installable PWA:** application manifest, service worker and app icons. The online navigation strategy is network-first; the precached shell is used only when the network is unavailable, so a deployment never waits behind a cached page or an update prompt.

The seeded syllabus is an editable topic grouping, not a claim that an official JEE 2027 notification has been published. Check the current NTA/JEE bulletin when it is released and adjust the list in the notebook if the official syllabus changes.

## Public routes

| Route | Visitor | Signed in |
| --- | --- | --- |
| `/` | Public Stracker homepage | The notebook dashboard |
| `/login` | Log-in page | Redirected to `/` |
| `/signup` | Sign-up page (real Supabase account) | Redirected to `/` |
| `/reset-password` | Request a reset link, or set a new password from the emailed link | Same page; the recovery link needs this route, so it is never redirected away |
| `/syllabus`, `/tests`, `/mistakes`, `/retry`, `/planner`, `/revision`, `/analytics`, `/weak-areas`, `/backup`, `/settings`, `/focus`, `/practice`, `/pyqs`, `/backlog`, `/mock-analysis`, `/decks`, `/study-now` | Redirected to `/login` | The notebook |

The guard is a single check on the restored session, so there is no redirect loop: while the session is being restored nothing else renders, and the installed PWA (`start_url: "/"`) opens the homepage for visitors and the notebook for signed-in users. A signed-out deep link such as `/syllabus` is remembered and replayed after a successful log-in.

The homepage is server-configuration agnostic: it never reads `import.meta.env`, never renders a provider key, and ships no third-party scripts, stock imagery or remote fonts. Its only texture is a ~300-byte inline SVG grain plus CSS.

## Run locally

Requirements: Node.js 20.19+ or 22.12+, and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open the Vite URL printed in the terminal. In development **without Supabase variables**, Stracker offers a clearly labelled local preview. That preview persists to this browser's IndexedDB but does not sign in to a cloud account or sync to Supabase. To use real cloud authentication, configure Supabase as described below.

Production build and local preview:

```bash
npm run build
npm run preview
```

Quality checks:

```bash
npm run typecheck
npm run lint
npm test
npm audit
```

## JEE preparation: how the numbers are defined

- **Practice accuracy** = correct ÷ attempted for the blocks in view. Correct + incorrect may not exceed attempted. Practice blocks never count as tests. A chapter is flagged “Practice weak” only with at least 20 questions.
- **Minutes on a practice block** are mirrored into study time under the Practice activity, using a stable ID. Editing or deleting the block updates or removes that time, and Undo restores both.
- **Raw syllabus completion** = chapters marked Done or Revised ÷ all chapters. **Weighted** uses each chapter’s importance (High / Medium / Low), multiplied by the weights in Settings → Exam. Every chapter starts at Medium, so the two numbers match until you change something. No JEE weightage is assumed anywhere.
- **Streak day**: 15+ minutes of recorded study, a practice log with questions attempted, a completed revision, or a logged test. Opening pages never counts.
- **Exam Mode** turns on automatically in the 30 days before the active track’s date, or by hand. It stops suggesting new theory and boosts revision, PYQs, mocks and weak-area fixes. Auto mode needs a date.
- **Study now** ranks candidates from overdue and due revisions, due backlog, due flashcards, mistakes awaiting retry, weak practice or test chapters, pending PYQs and mock losses, scaled by importance. Every result lists the reasons behind it.
- **Reminders** are checked while Stracker is open, at most once per day, and only for types that have something real to report. They are not background push notifications.

## Appearance and typography

Settings is organised into five tabs — **Account, Exam, Appearance, Study rhythm, and Data** — so long forms stay scannable. Each tab keeps its own draft, shows a dot while it has unsaved edits, and saves independently; the arrow keys move between tabs. Data resets and sign-out live in the Data and Account tabs behind their own confirmation dialogs, never behind a plain Save.

The header switch saves its choice immediately. *Settings → Appearance → Notebook theme* is part of the Appearance draft and saves with *Save appearance settings*. Both edit the same saved value, so once saved they never disagree: switching to `Auto` in Settings follows the device, and the next press of the header switch pins an explicit light or night choice.

*Settings → Appearance → Interface font* selects the single family used across the entire interface — content, headings, navigation, forms, tables, dialogs, notifications, and dynamically mounted UI:

| Choice | Family |
| --- | --- |
| Default | Poppins (balanced default) |
| Poppins | Poppins |
| Sora | Sora |
| Open Sans | Open Sans |

Each selectable family is bundled locally (latin subset, regular through bold) with `font-display: swap` and a system-sans fallback.

Picking a font is a draft. It previews across the whole interface at once, the Appearance tab shows its unsaved-changes dot, and nothing is written until you press **Save appearance settings**. Repeated picks save only the final choice. **Discard** restores the saved font, theme, and global font. Leaving Settings without saving reverts the preview and drops the draft, the same as every other unsaved tab. The saved value lives in `app_settings.interface_font` and restores on reload.

The effective font is applied once, as `--app-font-family` on the root element. Body copy, headings, labels, numbers, native controls, portals and overlays all inherit it. Components never name a family of their own, and nothing uses `!important` to force one. The one documented monospace exception is the `--font-code` token, which only fenced AI code blocks (`.ai-code-block`) use. Exports are intentionally separate: JSON, CSV, PDF, and DOCX keep their own typography and are never re-rendered in the interface font.

## Supabase setup (per-account, private by default)

1. Create a Supabase project and keep its URL and **publishable/anon key** available for the browser app.
2. Apply the migrations in [`supabase/migrations/`](supabase/migrations) in filename order (starting with `202610070001_init.sql`) from the Supabase SQL Editor or with the Supabase CLI. It creates the application tables, owner-only RLS policies, timestamp triggers, a private `mistake-images` bucket, storage ownership policies, and the `handle_new_user` profile trigger.
2a. **Also apply `20261008180000_jee_prep_features.sql`** after the migrations above. It is additive only: it adds columns with safe defaults to `study_sessions`, `chapters` and `app_settings`, and creates the owner-scoped tables for practice, PYQs, chapter stages, backlog, flashcards, mock error logs and time entries, and exam tracks. Existing rows are not changed. Deploy this migration before the app that uses it: the sync layer reads the new tables on every refresh, so an unmigrated project will report a sync error.

3. In **Authentication → Sign In / Providers → Email**, enable **Allow new users to sign up** so the public `/signup` page can create accounts, and decide whether email confirmation is required. Every account gets its own RLS-scoped notebook: chapters, tests, mistakes, revisions, plans and sessions are readable only by the account that wrote them, so an open sign-up never exposes another student's records. Turning sign-ups off again also works — `/signup` then reports that this deployment does not accept new accounts, and existing users keep signing in.
4. In **Authentication → URL Configuration**, add the deployed app URL, its `/signup` route as a redirect target for confirmation emails, and its `/reset-password` route to the allowed redirect URLs. Configure the email provider and password-reset delivery to suit your project.
5. Copy `.env.example` to `.env.local` and set:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
   ```

6. Restart the dev server and sign in. From a clean deployment, open `/signup` and create the first account, or create it from the Supabase dashboard and log in at `/login`.

**Never put a Supabase `service_role` key or any other private server secret in a `VITE_*` variable or the browser bundle.** The browser uses only the public key; RLS and the private storage policies are the access boundary. Review the generated policies and authentication settings in your own Supabase project before entering personal data.

### Stracker AI (BYOK)

Stracker AI is an optional, authenticated Vercel Node API that calls **your own** Gemini, OpenAI, Anthropic, DeepSeek, Qwen, or custom OpenAI-/Anthropic-compatible provider. DYPOL does not supply or proxy a DYPOL-owned model key. Provider usage is billed under your provider account. When you send a prompt, the prompt and the limited Stracker data required by the selected analytics tool are sent to the configured provider; review that provider’s retention and privacy policies before connecting it. AI requests need an internet connection and are not available in the device-only local preview.

1. Deploy the project to Vercel and apply `20261008150000_ai_assistant.sql` and `20261008160000_ai_atomic_test_write.sql` in filename order after the existing Stracker migrations. The second migration adds narrow, owner-scoped atomic test/chapter-score, Full Mock subject-score, and revision-completion RPCs; it does not enable arbitrary SQL access. **Do not deploy the AI UI against a Supabase project until its migrations have been applied.**
2. In Vercel Project Settings → Environment Variables, add the server-only values below. Keep `SUPABASE_SERVICE_ROLE_KEY` and `AI_CREDENTIALS_ENCRYPTION_KEY` unprefixed; never add either as a `VITE_*` variable. Generate a fresh encryption key with `openssl rand -hex 32`, store it in your password manager, and keep it stable: changing it without migrating stored provider credentials makes those credentials unreadable.

   ```dotenv
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
   AI_CREDENTIALS_ENCRYPTION_KEY=64_HEX_CHARACTERS_FROM_OPENSSL
   ```

   The browser still uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The AI function authenticates the user’s Supabase bearer token, scopes reads and writes to that owner, and stores provider keys only as authenticated AES-256-GCM ciphertext. Raw provider keys are never returned; settings display a masked status and provide test, disable, and remove controls.
3. Redeploy the Vercel project after migrations and server environment variables are ready. The chat function is configured for up to 60 seconds; the Vercel plan must permit that duration. `/api/ai/*` is implemented as Vercel Node functions, so a Netlify-only static deploy keeps the existing notebook but does not provide Stracker AI.
4. Sign in, open **Settings → Account → AI Assistant**, connect a provider with your own API key, choose a model, and test it. Only enabled, configured providers are eligible for capability-aware fallback. Model/tool support varies by provider; unsupported analytics tools are not simulated. Writes—including deletes—are previewed and require your explicit confirmation; the UI reports success only after the owner-scoped write returns successfully.

Conversation history, task status, and pending confirmations are stored in the signed-in account’s AI tables. Clearing an AI conversation does not alter study data. AI tool access is limited to canonical Stracker analytics and validated app actions—no user-provided SQL. The Vercel API uses the server-only Supabase service-role key only after verifying a user session; normal study-data operations use the authenticated user client and existing row ownership checks.

#### Troubleshooting: “The secure AI backend is not configured for this deployment yet.”

This message comes **only** from the deployed `/api/ai/*` functions (`api/_lib/supabase.ts` → `api/_lib/server-config.ts`) and means the serverless function environment is missing a server-only variable. It is **not** about your provider API key: a missing or invalid user key produces a different message (“`<Provider>` rejected the saved API key…”), and no provider configured at all produces “Connect and test an AI provider in Settings → AI Assistant…”.

The functions require exactly four deployment-level variables (never per-user provider keys, never `VITE_`-prefixed secrets):

- `SUPABASE_URL` (falls back to `VITE_SUPABASE_URL`)
- `SUPABASE_ANON_KEY` (falls back to `VITE_SUPABASE_ANON_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` — server-only; no fallback by design
- `AI_CREDENTIALS_ENCRYPTION_KEY` — `openssl rand -hex 32`; encrypts stored provider keys at rest

Diagnose the deployed backend directly — no guessing required:

```
GET https://YOUR_DEPLOYMENT/api/ai/health
{"service":"stracker-ai","configured":false,"checks":{"supabaseServerConfig":false,"credentialEncryption":false},"reason":"supabase_server_config_missing","missing":["SUPABASE_URL","SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY","AI_CREDENTIALS_ENCRYPTION_KEY"],"invalid":[]}
```

The response contains booleans, a normalized `reason` code, and the **names** of missing or malformed variables — never secret values. The same check runs automatically in Settings → AI Assistant, which shows a distinct banner when the backend is misconfigured, and a different one when no `/api/ai/*` functions answer at all (for example a Netlify-only static deploy or `npm run dev`). The function log also records a structured warning naming the missing variables. After adding or fixing variables, **redeploy**: Vercel functions only pick up environment-variable changes on a new deployment. When healthy, the endpoint returns `{"configured":true,...}`.

### Data and offline behavior

Application records are keyed to the signed-in Supabase user and protected by row-level security. Mistake images are stored privately beneath that user's UUID path. The browser keeps an IndexedDB cache for responsive use and offline access; offline edits are queued and reconciled when connectivity returns. When the server has a newer `updated_at` value, the latest cloud version wins for that record. A local preview is a separate device-only mode, not a cloud backup.

JSON, CSV, PDF, and DOCX exports are generated in the browser. Keep JSON backups somewhere private; Stracker does not upload exports to a third-party backup service. Resetting study data permanently deletes the signed-in account's Stracker rows and uploaded mistake images, but does not delete the Supabase login itself.

## Deploy

Both included deployment configs support client-side route fallback:

- **Netlify:** connect the repository, use `npm run build` and publish `dist`. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as build environment variables.
- **Vercel:** import the repository; Vite's production output is `dist`. Add the two public `VITE_SUPABASE_*` variables for the browser. To enable Stracker AI, also follow [Stracker AI (BYOK)](#stracker-ai-byok) for server-only environment variables, database migrations, and function duration.

Serve the production app over HTTPS so browser authentication, IndexedDB, and service-worker installation work as intended. Vercel sends the SPA entry HTML and other routes with browser- and CDN-level `no-store` headers; Vite's content-hashed `/assets/*` files are immutable at both layers. The PWA worker fetches online navigations from the active deployment first and only falls back to the precached shell offline; it does not show an update prompt or force-reload an open session. After deployment, add the exact production URL and `/reset-password` redirect URL to Supabase Auth settings. Do not add the service-role key to either host's client-side environment variables.

## Project commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite on `0.0.0.0` for local or preview access |
| `npm run build` | Type-check and produce the PWA production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Run TypeScript project checks |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest unit and IndexedDB migration tests |

## License

No license has been selected for this repository yet. Add a `LICENSE` file before redistributing or reusing the project outside the owner’s deployment.
