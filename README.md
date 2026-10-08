# Stracker

**Stracker by DYPOL LABS** is a private, responsive study notebook for JEE 2027 preparation, published behind a public product homepage. It combines a seeded, editable syllabus with test tracking, mistake review, spaced revision, daily planning, focus sessions, analytics, and portable exports. The interface is designed to feel like a well-used notebook and works on desktop and mobile.

## What is included

- **Syllabus notebook:** Physics, Chemistry, and Maths topic lists; progress states, priorities, notes, formula notes, search, and reorder controls.
- **Test journal:** chapter tests, subject tests, full mocks and PYQ practice; marks, correct/wrong/skipped counts, mock subject scores, chapter-level results, filters, and edits.
- **Mistake and retry notebooks:** typed mistake records, optional compressed question images, solution notes, and a dedicated retry workflow.
- **Revision planner:** configurable revision intervals, due/overdue lists, completion tracking, and chapter links.
- **Daily planner and weekly goals:** dated tasks, drag or button-based reordering, completion states, and derived or manually adjustable goal progress.
- **Focus timer:** Pomodoro, short break, long break, and custom blocks; timer state survives navigation and refresh, with optional locally generated sound and logged study sessions.
- **Analytics:** subject and chapter signals, test trends, study time, streaks, mistake summaries, weak areas, and rule-based study prompts. Empty or incomplete data is shown as such rather than invented.
- **Exports and backups:** re-importable JSON notebook backup, UTF-8 test-history CSV, and selectable/date-ranged PDF and DOCX reports. Backup import validates records and relationships, previews the merge, and requires confirmation.
- **Privacy and offline support:** Supabase Auth, user-scoped PostgreSQL tables with RLS, a private image bucket, browser-local IndexedDB caching, and an owner-scoped sync queue for offline changes.
- **Appearance controls:** a light/night switch in the top-right corner (desktop header and mobile top bar) that stays in step with the theme choice in Settings, plus an interface-font preference — Default (the Stracker notebook hand), Poppins, Sora, or Open Sans.
- **Public homepage and separate authentication:** a marketing-free product homepage on `/` for visitors, dedicated `/login` and `/signup` pages, and password recovery on `/reset-password`. Signed-in visitors go straight to the notebook instead.
- **Installable PWA:** application manifest, service worker, app icons, and offline-cached application shell.

The seeded syllabus is an editable topic grouping, not a claim that an official JEE 2027 notification has been published. Check the current NTA/JEE bulletin when it is released and adjust the list in the notebook if the official syllabus changes.

## Public routes

| Route | Visitor | Signed in |
| --- | --- | --- |
| `/` | Public Stracker homepage | The notebook dashboard |
| `/login` | Log-in page | Redirected to `/` |
| `/signup` | Sign-up page (real Supabase account) | Redirected to `/` |
| `/reset-password` | Request a reset link, or set a new password from the emailed link | Same page; the recovery link needs this route, so it is never redirected away |
| `/syllabus`, `/tests`, `/mistakes`, `/retry`, `/planner`, `/revision`, `/analytics`, `/weak-areas`, `/backup`, `/settings`, `/focus` | Redirected to `/login` | The notebook |

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

## Appearance and typography

The header switch and *Settings → Notebook theme* edit the same value, so they never disagree: switching to `Auto` in Settings follows the device, and the next press of the header switch pins an explicit light or night choice.

*Settings → Interface font* selects the family the whole interface uses — dashboard, navigation, forms, tables, dialogs, and empty states:

| Choice | Family |
| --- | --- |
| Default | Patrick Hand (the Stracker notebook hand, bundled locally) |
| Poppins | Poppins |
| Sora | Sora |
| Open Sans | Open Sans |

Only the default cut of each family is loaded (latin subset, regular to bold) and each family falls back to a system sans if it cannot be fetched, so the app stays usable offline or behind a blocked font host. The preference is stored in `app_settings.interface_font` and restores with the rest of your settings. Exports are intentionally separate: JSON, CSV, PDF, and DOCX keep their own typography and are never re-rendered in the interface font.

## Supabase setup (per-account, private by default)

1. Create a Supabase project and keep its URL and **publishable/anon key** available for the browser app.
2. Apply the migrations in [`supabase/migrations/`](supabase/migrations) in filename order (starting with `202610070001_init.sql`) from the Supabase SQL Editor or with the Supabase CLI. It creates the application tables, owner-only RLS policies, timestamp triggers, a private `mistake-images` bucket, storage ownership policies, and the `handle_new_user` profile trigger.
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
4. Sign in, open **Settings → AI Assistant**, connect a provider with your own API key, choose a model, and test it. Only enabled, configured providers are eligible for capability-aware fallback. Model/tool support varies by provider; unsupported analytics tools are not simulated. Writes—including deletes—are previewed and require your explicit confirmation; the UI reports success only after the owner-scoped write returns successfully.

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

Serve the production app over HTTPS so browser authentication, IndexedDB, and service-worker installation work as intended. After deployment, add the exact production URL and `/reset-password` redirect URL to Supabase Auth settings. Do not add the service-role key to either host's client-side environment variables.

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
