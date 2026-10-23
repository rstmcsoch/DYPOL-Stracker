# Why sign-in can fail in the app and not on the website

Short version: **the app has no database of its own.** It signs in against one Supabase project
and reads that project's tables. If that project is the same one the website uses, the same email
and password work in both. If the APK was built with a *different* project address or a key from
another project, every attempt is rejected with **“Email or password is incorrect”** — which looks
exactly like a wrong password, but isn't.

| Question | Answer |
|---|---|
| Does the app share the website's database? | Yes — one Supabase project, one set of accounts, one set of rows. There is no second backend. |
| Do I need to set up an app database? | **No.** Nothing to create, migrate or seed. |
| Is the app really connected to Supabase? | Check it yourself: **Settings → Connection** (or “Check connection” under a failed sign-in). It shows the project ref this build talks to and whether that project accepts the key. |
| Why is it refusing my correct password? | Either the build points at another project, or this account has no password set for *this* project. Both are visible in the Connection sheet. |

## The one value that decides everything: the project ref

A Supabase project URL looks like `https://<ref>.supabase.co`. The `<ref>` is the project's
identity. Two builds with different refs are different apps with different user lists.

* What this repository's Supabase integration points at: **`tkggckwksoatbswrebpu`** (visible in
  the “Supabase Preview” check and in
  <https://supabase.com/dashboard/project/tkggckwksoatbswrebpu>).
* What the APK points at: shown in **Settings → Connection** and printed in every build log at the
  step *“Check which Supabase project the APK will talk to”*.
* If those two differ, the APK can never sign in with website credentials. Fix the repository
  secrets and rebuild — see below.

## Reading the Connection sheet

| What it says | What it means | What to do |
|---|---|---|
| **Connected to project `<ref>`** + `Key: accepted` | The APK and the project agree. A rejected password is then a real password problem. | Use **Forgot password?** on the sign-in page, set a new one, sign in. |
| **The key in this build does not belong to project `<ref>`** (`HTTP 401`, usually `Invalid API key`) | `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the repository secrets come from two different places. | Copy both from **one** project: Supabase → Project Settings → API. Re-run the workflow. |
| **Connected…** but the ref is not `tkggckwksoatbswrebpu` | The whole APK points at another project. Accounts there are not the website's accounts. | Correct `SUPABASE_URL` (and the key) to the website's project, rebuild. |
| **Cannot reach `<host>`** | The phone has no route to that address: offline, or the address is wrong. | Check the connection, then re-check the URL in the build log. |
| **This build has no project address** | The APK was compiled without the two values (the workflow warns about this). | Add the two secrets, rebuild. |

## Why the website can still work when the app cannot

The website is not a different system — it is the same project. Three situations explain the gap:

1. **The website keeps you signed in.** A session stored in the browser keeps working for weeks, so
   you never actually re-enter the password. The app has no such session and asks the server fresh.
   If the stored password on the account is not what you think, the website would look fine and the
   app would refuse.
2. **The account has no password.** Accounts created through an invite or a magic link have no
   password until one is set. The app signs in with email + password only.
3. **The APK was built against another project** (see above) — the most common cause when the same
   credentials are refused.

In all three cases **Forgot password?** is the fix, as long as the project ref matches. It sets a
password on the account that exists in that project.

## Fixing the secrets (phone only)

1. Open <https://supabase.com/dashboard> → the Stracker project → **Project Settings → API**.
2. Copy **Project URL** and the **anon / publishable** key from that same page.
3. GitHub → repo → **Settings → Secrets and variables → Actions** → update `SUPABASE_URL` and
   `SUPABASE_ANON_KEY` with those two values.
4. **Actions → Stracker Android release → Run workflow** (branch `main`).
5. In the new run, open the step **“Check which Supabase project the APK will talk to”** — it
   prints `APK points at` versus `Expected by this repo`, and the run summary repeats the table. If
   it says **NO**, stop there: the secrets are still wrong.
6. Install the new APK (uninstall an older Stracker build first if it came from the Capacitor
   experiment — different signing key).

## What the app deliberately does not do

* It never stores the service-role key; it uses the same public anon key the website ships.
* It never creates accounts in a second system, and never copies data between projects.
* A wrong password never becomes a silent success: the failure is surfaced with the server's own
  wording under the friendly sentence, so a support question can be answered without a computer.
