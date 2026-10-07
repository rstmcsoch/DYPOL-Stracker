# Stracker

**Stracker by DYPOL LABS** is a private, responsive study notebook for JEE 2027 preparation. It combines a seeded, editable syllabus with test tracking, mistake review, spaced revision, daily planning, focus sessions, analytics, and portable exports. The interface is designed to feel like a well-used notebook and works on desktop and mobile.

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
- **Installable PWA:** application manifest, service worker, app icons, and offline-cached application shell.

The seeded syllabus is an editable topic grouping, not a claim that an official JEE 2027 notification has been published. Check the current NTA/JEE bulletin when it is released and adjust the list in the notebook if the official syllabus changes.

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

## Supabase setup (private account)

1. Create a Supabase project and keep its URL and **publishable/anon key** available for the browser app.
2. Apply [`supabase/migrations/202610070001_init.sql`](supabase/migrations/202610070001_init.sql) from the Supabase SQL Editor or with the Supabase CLI. It creates the application tables, owner-only RLS policies, timestamp triggers, a private `mistake-images` bucket, storage ownership policies, and a profile trigger.
3. In Supabase Auth, disable public sign-ups. Create or invite only the owner account from the dashboard. Stracker deliberately has no public registration workflow.
4. In **Authentication → URL Configuration**, add the deployed app URL and its `/reset-password` route to the allowed redirect URLs. Configure the email provider and password-reset delivery to suit your project.
5. Copy `.env.example` to `.env.local` and set:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
   ```

6. Restart the dev server and sign in using the owner account created in Supabase Auth.

**Never put a Supabase `service_role` key or any other private server secret in a `VITE_*` variable or the browser bundle.** The browser uses only the public key; RLS and the private storage policies are the access boundary. Review the generated policies and authentication settings in your own Supabase project before entering personal data.

### Data and offline behavior

Application records are keyed to the signed-in Supabase user and protected by row-level security. Mistake images are stored privately beneath that user's UUID path. The browser keeps an IndexedDB cache for responsive use and offline access; offline edits are queued and reconciled when connectivity returns. When the server has a newer `updated_at` value, the latest cloud version wins for that record. A local preview is a separate device-only mode, not a cloud backup.

JSON, CSV, PDF, and DOCX exports are generated in the browser. Keep JSON backups somewhere private; Stracker does not upload exports to a third-party backup service. Resetting study data permanently deletes the signed-in account's Stracker rows and uploaded mistake images, but does not delete the Supabase login itself.

## Deploy

Both included deployment configs support client-side route fallback:

- **Netlify:** connect the repository, use `npm run build` and publish `dist`. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as build environment variables.
- **Vercel:** import the repository; Vite's production output is `dist`. Add the same two public environment variables to the project.

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
