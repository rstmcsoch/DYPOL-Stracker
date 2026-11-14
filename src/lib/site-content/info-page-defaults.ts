/**
 * Built-in text of the Privacy, Terms and About pages, written for Stracker by DYPOL LABS from
 * what the code actually does (see the README, the Supabase migrations, api/_lib and
 * src/lib/telemetry). The owner can replace any of it in Control Center → Appearance → Footer ·
 * Information pages. Format (plain text, no markup):
 *   - a paragraph starting with "## " is a section heading
 *   - a paragraph whose lines all start with "- " is a bullet list
 *   - a paragraph starting with "Last updated:" is shown as the page date
 * Keep every statement true of the running product; do not add contact details, addresses,
 * company registration, user counts or certifications that do not exist.
 */
export const INFO_PAGES_LAST_UPDATED = '14 November 2026'

export const DEFAULT_PRIVACY_BODY = `Last updated: ${INFO_PAGES_LAST_UPDATED}

This policy explains what Stracker by DYPOL LABS collects when you visit the Stracker website or use the signed-in Stracker study notebook, why it is collected, where it is kept and the choices you have. Stracker is built and run by DYPOL LABS for students preparing for exams such as JEE, NEET UG, MHT CET, BITSAT, CUET UG, CLAT, CA, CS and CMA, GATE, CAT, UPSC and banking exams, and for school students in Classes 9 to 12.

## The short version

- Your study records belong to your account. Other students cannot see them, and DYPOL LABS does not sell them or use them for advertising.
- Stracker shows no ads and loads no third-party tracking or advertising scripts.
- Stracker's own product analytics never include the text you type, your marks or your notes, and they switch off completely when your browser sends Do Not Track or Global Privacy Control.
- Stracker AI is optional. When you use it, your question and the study data needed to answer it are sent to an AI model provider, as explained below.

## What you give us when you create an account

To sign up you enter a display name, an email address and a password. Accounts are handled by Supabase Auth: your password is stored there only in hashed form and DYPOL LABS cannot read it. Your email address is used to confirm the account, to sign you in and to send password-reset links. Stracker does not send marketing email.

## What you record in your notebook

When you first sign in you choose your exam and, if you want, your exam date, display theme and fonts. After that, Stracker stores what you choose to record:

- syllabus progress, chapter stages, priorities, notes and formula notes;
- tests and mock tests, with marks, correct, wrong and skipped counts, subject and chapter scores and time spent;
- mistakes, solution notes and any question images you upload;
- practice and DPP logs, PYQ records, revision schedules and flashcard decks;
- daily planner tasks, weekly goals, backlog items and focus or study sessions;
- your settings, such as exam tracks, revision intervals, reminders, theme and fonts.

These records are saved in your account in Stracker's Supabase database. Row-level security means each record can be read or changed only by the signed-in account that owns it. Mistake images go to a private storage folder that belongs to your account.

## What stays on your device

Stracker keeps a copy of your notebook in your browser's IndexedDB storage so pages open quickly and you can keep working offline; offline changes are queued and synced when you reconnect. Your sign-in session and a few display preferences, such as your light or dark choice and pinned charts, are kept in your browser. JSON backups, CSV files and PDF or DOCX reports are created inside your browser; Stracker does not upload your exports anywhere.

## Stracker AI

Stracker AI is an optional assistant inside the notebook. It can answer with DYPOL LABS's default models, which have a daily limit per student, or with your own model if you add your own API key in Settings. Keys you add are encrypted on Stracker's server (AES-256-GCM) before they are stored and are never shown back to you in full; you can test, disable or remove them at any time.

When you send a message, Stracker sends the model provider your message, the earlier messages in that conversation, Stracker's instructions to the assistant, and any of your study data that the assistant's tools look up to answer you, such as test scores or chapter progress. Depending on the model, the provider is Google (Gemini), OpenAI, Anthropic, OpenRouter, DeepSeek, Qwen, NVIDIA or a custom endpoint you configured. The provider processes that request under its own terms and privacy policy. Any change the assistant suggests to your notebook is shown to you first and is saved only if you confirm it. Your conversations are stored in your account so you can return to them, and you can delete them. Stracker counts your AI requests to apply the per-minute and daily limits.

## AI observability with three.dev

To monitor the quality, errors and cost of Stracker AI, chats sent to Gemini, OpenAI, Anthropic and OpenRouter models are routed through three.dev, an AI observability service. three.dev records each request and response, including Stracker's instructions, your messages and the study data returned by the assistant's tools, along with model, token and cost details. These requests carry an anonymous, hashed conversation reference, not your name, email address or account ID, and provider API keys are passed through without being stored by three.dev. Chats with DeepSeek, Qwen, NVIDIA and other custom endpoints go straight to the provider and are not recorded by three.dev. If three.dev is unavailable, the chat goes straight to the provider. If you do not want an AI chat recorded, do not send it; every other part of Stracker works without AI.

## Product analytics

Stracker records its own first-party product analytics so DYPOL LABS can see which pages and features are used and fix what breaks. Events include page views, features opened, sign-up and log-in outcomes, whether saving a record succeeded, promotional video plays, page loading speed and app errors. Each event can carry:

- a random session ID that lives only in that browser tab and is cleared when the tab closes;
- when you are signed in, a pseudonymous account reference made with a one-way keyed hash, not your account ID or email;
- your device type (phone, tablet or desktop), screen size and browser family;
- the domain of the website that linked you to Stracker and any campaign tags in that link.

Analytics never include the text you type, your marks, notes or questions. Stracker does not set analytics cookies. If your browser sends Do Not Track or Global Privacy Control, Stracker sends no analytics events at all.

## Messages you send through the Contact page

When you use the Contact page, Stracker stores your name, email address, the reason you chose, the subject and message, any extra details that reason asks for, links you add and files you attach (PDF, JPG or PNG), and your account ID if you were signed in. Attachments are kept in a private storage area that only DYPOL LABS can open, through short-lived links in the Stracker Control Center. Messages are used only to read and answer your request. To stop spam, Stracker uses a one-way fingerprint of your network address to limit how many messages can be sent; the address itself is not stored.

## Who can access your data

Everything travels over HTTPS. The Stracker Control Center, where DYPOL LABS runs the service, requires an owner role and two-step verification with an authenticator app, and every privileged action there is written to an audit log. It shows account-level information such as display name, sign-up date and how many records an account has, not the content of your notes, tests or mistakes. DYPOL LABS reads contact messages there.

## Services Stracker relies on

- Supabase: accounts and sign-in, the database and private file storage.
- Vercel: hosting for the website and the server functions behind Stracker AI and the Contact form.
- AI model providers, only when you use Stracker AI, as described above.
- three.dev, for Stracker AI observability as described above.

DYPOL LABS does not sell or rent your information and does not share it with advertisers. It would disclose information only where the law requires it.

## Keeping, exporting and deleting your data

- Edit or delete any record in your notebook whenever you like.
- Download a full JSON backup, a CSV of your tests or PDF and DOCX reports from the Backup page.
- Settings → Data → reset permanently deletes your Stracker study records and uploaded mistake images from the cloud and from that device. It does not delete your login.
- To delete your login as well, send a request from the Contact page using the email address on your account.
- Contact messages and their files are kept until DYPOL LABS deletes them in the Control Center.

## Younger students

Stracker is used by school students as well as college aspirants. If you are under 18, use Stracker with the knowledge of a parent or guardian. A parent or guardian who wants a child's account or data removed can ask through the Contact page.

## Changes to this policy

When Stracker starts collecting something new or uses data in a new way, this page is updated before the change goes live and the date at the top changes.

## Questions

Use the Contact page and choose General query. Messages go straight to the Stracker team at DYPOL LABS.`

export const DEFAULT_TERMS_BODY = `Last updated: ${INFO_PAGES_LAST_UPDATED}

These terms apply when you use Stracker by DYPOL LABS: the public Stracker website, the signed-in study notebook, Stracker AI and the Contact page. By creating a Stracker account or using Stracker, you agree to them. Please read them together with the Stracker Privacy Policy.

## What Stracker is

Stracker is a digital study notebook for planning and tracking exam preparation. It brings together your syllabus, tests and mocks, mistakes and retries, revision, practice and PYQs, a daily planner and weekly goals, a focus timer, analytics, exports and the optional Stracker AI assistant. Stracker helps you organise your own preparation. It is not a coaching institute, it does not provide official exam papers or results, and it is not affiliated with any exam conducting body, board or university.

## Syllabus lists, marking defaults and exam details

The ready-made syllabus, chapter lists and marking defaults are a starting point prepared by DYPOL LABS so you do not begin from a blank page. They can differ from the latest official notification for your exam. Always check the official bulletin and edit your notebook if anything has changed. Exam dates and targets in Stracker are the ones you enter.

## Your account

- Use an email address you can access and keep your password private.
- An account is for one person. You are responsible for what happens in your account.
- If you think someone else has used your account, change your password and tell us through the Contact page.

## Your content

Your study records, notes, images and backups remain yours. You allow DYPOL LABS to store, process, sync and display them only to run Stracker for you, including sending them to an AI model provider when you use Stracker AI. Upload only content you have the right to use, and nothing unlawful, abusive or harmful.

## Stracker AI

- Stracker AI is optional. Its answers are generated by AI models and can be wrong, incomplete or out of date. Check important facts against your textbooks, official material and teachers, and do not treat its answers as professional advice.
- DYPOL LABS's default models come with per-minute and daily limits. DYPOL LABS may change those limits, switch models, or pause the default models at any time.
- If you add your own API key, your use of that provider is also governed by the provider's terms, and any charges are billed to you by that provider.
- Changes the assistant proposes to your notebook are saved only after you confirm them. Review them before confirming.

## Fair use

When using Stracker, do not:

- try to access another person's account, data or files, or the Stracker Control Center;
- probe, bypass or overload Stracker's security, rate limits or servers, or scrape the service with automated tools;
- use Stracker AI to produce unlawful or harmful content, or try to extract its instructions or any stored keys;
- send spam, abuse or misleading messages through the Contact page;
- copy, resell or present Stracker, or a substantial part of it, as your own product.

## Price and availability

Stracker is free to use at present. If DYPOL LABS introduces paid features, they will be explained on Stracker before anything is charged. Stracker is provided as it is and as available. DYPOL LABS works to keep it reliable, but it can be unavailable for maintenance or because of problems with hosting or other services, and features can change. Changes you make offline sync when you reconnect; keep regular JSON backups from the Backup page for anything you cannot afford to lose.

## Stracker's name and design

The Stracker name, the "Stracker by DYPOL LABS" mark, the logo, the notebook design, the website text and the software belong to DYPOL LABS. These terms do not give you any right to use them beyond using Stracker itself. If you believe something on Stracker uses your work without permission, send a notice through the Contact page using the Copyright reason.

## Suspending or closing an account

DYPOL LABS may limit or suspend an account that breaks these terms or puts other students or the service at risk. You can stop using Stracker at any time, reset your study data from Settings → Data, and ask for your login to be deleted through the Contact page.

## Limits of responsibility

Stracker is a tool to support your preparation; your results depend on your own study. To the extent the law allows, DYPOL LABS is not responsible for exam outcomes, for decisions you make based on Stracker's analytics, suggestions or AI answers, or for loss of data you did not back up.

## Changes to these terms

If these terms change in a way that matters, this page is updated and the date at the top changes. Continuing to use Stracker after that means you accept the updated terms.

## Questions

Use the Contact page. Messages go straight to the Stracker team at DYPOL LABS.`

export const DEFAULT_ABOUT_BODY = `Last updated: ${INFO_PAGES_LAST_UPDATED}

Stracker by DYPOL LABS is a digital study notebook for students preparing for an exam. It keeps the whole preparation in one place, with the calm, familiar feel of a well-used paper notebook, and it works on phones, tablets and desktops.

## Who Stracker is for

Stracker is not built for one exam. Students choose their exam when they start, and the notebook adapts its subjects, syllabus and marking defaults. The list includes JEE Main and Advanced, MHT CET, BITSAT, VITEEE, COMEDK UGET, WBJEE, KCET, NEET UG, CUET UG, CLAT, NDA, CA Foundation, Intermediate and Final, CS Executive and Professional, CMA, GATE, CAT, UPSC Civil Services, SSC CGL, IBPS PO, SBI PO, and school Classes 9, 10, 11 and 12.

## What you can do in Stracker

- Work through a ready-made, editable syllabus and move each chapter through Theory, Notes, PYQs, Revised and Tested.
- Log chapter tests, subject tests and full mocks, with marks, attempts and time, then see where marks were lost.
- Keep a mistake notebook and a retry list so the same question does not catch you twice.
- Schedule spaced revision and flashcard decks, record practice and PYQs, and track your backlog.
- Plan each day, set weekly goals and study in focused timer blocks.
- See analytics, weak areas and a "What should I study now?" list that explains every suggestion.
- Ask Stracker AI about your own progress, with changes saved only when you confirm.
- Export a full backup or a report whenever you want.

## How we build it

- Your data is yours. Records are private to your account, the full notebook can be exported at any time, and Stracker shows no ads.
- Numbers you can trust. Every metric is defined in the app, empty data is shown as empty, and nothing is invented to fill a chart.
- Built for real study days. Stracker keeps working offline, can be installed as an app, and has light and dark themes and readable fonts.

## About DYPOL LABS

DYPOL LABS makes practical tools for serious learners: tools that do one job well and keep your data yours. Stracker is a DYPOL LABS product and is designed, built and run by DYPOL LABS.

## Talk to us

Ideas, bug reports, complaints, copyright notices, sponsorship proposals and general questions all go through the Contact page, straight to the Stracker team.`
