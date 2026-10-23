# Sign-in problems

## The short version

The app is compiled against the one project the website uses. There is no separate app
database, nothing to set up, and no key to paste. The same email and password therefore work
in both places.

If a sign-in is refused now, it is one of these two things:

| What you see | What it means | What to do |
|---|---|---|
| “Email or password is incorrect.” | The account exists but the password sent does not match — including a password that was capitalised by the keyboard (fixed in this build) or an account created by an invite link that never got a password. | Use **Forgot password?** on the sign-in page, set a new one, sign in with it. |
| “This phone cannot reach Stracker right now.” or a spinner that never ends | The phone is offline, or the connection is being blocked. | Check mobile data / Wi-Fi, then try again. |

Tap **Still not working? Check the connection** under the error for a plain-language answer.
It tells you, in one sentence, whether the phone can reach your account, and what to do next.
“Details for support” holds the technical values — copy them only if support asks.

## Why the website can look fine while the app refuses

The browser keeps you signed in for weeks, so it never re-sends your password. The app has
no such session and asks every time. If the stored password is not what you remember, the
website looks fine and the app says no. **Forgot password?** fixes that — it sets a password
on the account that already exists.

## What the app never does

* No second account system, no copy of your data anywhere else.
* No service key on the phone; the public key it ships with grants nothing on its own.
* A failure is never turned into a fake success: the page says what happened and keeps your
  entries untouched.

## For whoever maintains the build

* The address and public key live in `mobile/lib/core/config.dart` (`supabaseUrl`,
  `supabaseAnonKey`). The release workflow reads them, prints the project ref in the run
  summary, and **fails the run** if the ref is not `tkggckwksoatbswrebpu`.
* The workflow no longer passes `SUPABASE_URL` / `SUPABASE_ANON_KEY` secrets to the build:
  a stale secret was what once pointed the APK at another project.
* `Settings → Connection check` performs one public `GET /auth/v1/settings` with the anon key
  — no password, no user token — and reports reachability, HTTP status and whether the key is
  accepted. Use **Copy** to attach that block to a bug report.
