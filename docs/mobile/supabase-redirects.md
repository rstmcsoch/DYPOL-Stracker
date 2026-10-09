# Supabase redirect URLs for the Android app

The app uses the custom scheme `stracker://`, registered in the APK. Two links from email must come back into the
app, so the Supabase project must allow them. **This is a change to the existing production Supabase project,
which must be made by the project owner.** This repository does not change it.

## Add these redirect URLs

Supabase Dashboard → Authentication → URL Configuration → Redirect URLs. Add each one exactly:

| URL | Used for |
| --- | --- |
| `stracker:///` | Sign-up confirmation and resend (the app passes `emailRedirectTo` = `stracker:///`). |
| `stracker://reset-password` | Password reset. The app opens the new-password screen from this link. |

Supabase recommends exact entries for production (its documentation, *Redirect URLs*: "we recommend setting the exact
redirect URL path"). Wildcards such as `stracker://**` also work, but widen what the project will redirect to, so
use them only for development.

## Leave these unchanged

- **Site URL** stays as the website's production URL. It is the default for the website and the email templates.
- The existing website redirect URLs stay as they are. Adding the two app URLs does not affect the website.

## Email templates

The app sends `redirectTo` with each request. The default Supabase templates use `{{ .ConfirmationURL }}`, which honours
`redirectTo`, so no template change is needed. If a template was edited to use `{{ .SiteURL }}`, change that link to
`{{ .RedirectTo }}` (Supabase's documentation, *Email templates when using redirectTo*). Test the change on the
website first, because the same templates serve both platforms.

## How to check

1. Install the APK, then request a password reset from the sign-in screen.
2. Open the email on the phone and tap the link. Stracker should open on *Set a new password*.
3. Sign up with a new test address and tap the confirmation link. Stracker should open signed in.

If the browser opens instead, the URL is missing from the list or does not match exactly.
