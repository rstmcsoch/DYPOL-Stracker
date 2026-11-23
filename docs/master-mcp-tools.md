# Master MCP tool reference

This list is the implemented Master MCP catalogue: **118 tools**. Only these names are
advertised by `tools/list`. Alternate or forbidden names are refused on the server.

High-impact tools require a preview and a one-use `confirmationToken` before they mutate
anything. Search, where offered, is an argument on the list tool (for example `q` on
`list_site_media` and `list_contact_messages`). Analytics tools accept a date range and an
explicit `timeZone` (default `Asia/Kolkata`; `Asia/Calcutta` is also accepted).

Email sending is not available and is not advertised. Raw admin AI keys are never returned.
Sign-up, sign-in, domain, authentication and security settings are not reachable.

## Overview and permissions (7)

- `get_master_permissions` — Show the Master MCP principal, the tools that are actually implemented, the operational capabilities that are authorized, and the actions that are permanently refused (roles, owner controls, security, user-account deletion, infrastructure and secrets).
- `get_master_overview` — Operational snapshot of Stracker accounts, recent activity and database reachability for a reporting window. Metrics come from the live backend; nothing is fabricated.
- `get_site_health` — Run the same bounded, read-only health probes as the Control Centre: database connectivity, server configuration (variable names only), Supabase Auth, and email-delivery status when known.
- `get_account_overview` — Account-level totals for the selected window: registrations, verification, pending confirmations, active and suspended accounts, and tracker adoption. No per-account security fields are included.
- `get_daily_activity` — Daily registrations, verified sign-ups and test-journal rows for a reporting window and time zone.
- `get_recent_errors` — Recent grouped application errors from analytics. Messages are already length-bounded; student notes and request payloads are not included.
- `get_audit_events` — Read permitted Control Centre and Master MCP audit events. This tool cannot edit or delete audit history.

## Students and moderation (10)

- `list_students` — List student accounts with pagination and filters. Never returns passwords, MFA, passkeys or other authentication secrets.
- `search_students` — Search student accounts by email or display name, with the same pagination and filters as list_students. Authentication secrets are never returned.
- `get_student_account` — Permitted profile and account metadata for one student: display name, registration, verification, last sign-in, exam tracks (without notes), and usage counts. Passwords, MFA and passkeys are never included.
- `get_student_activity` — Activity summary for one student: record counts and recent test dates and study-session times. Marks, notes and other study content are not returned.
- `get_student_study_overview` — Counts of the student's study-record tables. Row contents, notes and marks are not returned.
- `update_student_display_profile` — Update a student display name only. Email, passwords and other authentication identity cannot be changed. The Owner and Control Centre role holders are protected.
- `get_student_moderation_history` — Warning and ban history for one student. This tool does not apply sanctions.
- `warn_student` — Issue a warning to a student. This is student-facing, so a preview and confirmation token are required before the warning is stored. The Owner and Control Centre role holders cannot be warned. Never delete an account.
- `ban_student` — Ban a student account after a confirmation preview. Permanent or timed bans revoke sessions. The Owner and Control Centre role holders cannot be banned. User-account deletion is permanently prohibited.
- `unban_student` — Lift a student ban after a confirmation preview. The Owner and Control Centre role holders cannot be unsanctioned through Master MCP.

## Student study data (20)

- `get_student_dashboard` — Summary of one student's chapters, tests, mistakes, tasks due, and recent scored tests. Uses the same percentage maths as the student app. Notes are not included.
- `get_student_settings` — The student's app settings after the standard settings schema. Authentication secrets and AI keys are never included.
- `get_student_analytics` — Test averages by type and subject for one student, computed with the shared analytics helpers. Notes are not included.
- `export_student_notebook` — Export one student\
- `manage_student_chapters` — List, search, create, update, reorder or delete one student's chapters. Deletes require a confirmation preview because linked mistakes, revisions and chapter links are affected. Records must belong to the named student.
- `manage_student_tests` — List, search, create, update or delete one student's tests using the shared test validation rules. Deletes require confirmation because subject scores and chapter links cascade, and linked mistakes lose their test_id. Records must belong to the named student.
- `manage_student_subject_scores` — Manage subject scores that belong to a student's tests. The named test must belong to the same student. Numeric integrity follows the shared subject-score schema.
- `manage_student_test_chapter_links` — Manage chapter links on a student's tests. Both the test and the chapter must belong to the same student. Numeric integrity follows the shared chapter-score schema.
- `manage_student_mistakes` — List, create, update or delete one student's mistakes. Deletes require a confirmation preview. The chapter and optional test must belong to the same student.
- `manage_student_revisions` — List, create, update, snooze, complete or delete a student\
- `manage_student_tasks` — List, search, create, update, reorder, complete or delete a student\
- `manage_student_weekly_goals` — List, create, update, complete or delete a student\
- `manage_student_study_sessions` — List, create, update or delete historical study sessions. Master MCP cannot start, edit or delete an active browser timer (a session with no end time). Deletes require confirmation.
- `manage_student_practice_records` — List, create, update or delete practice blocks. Correct plus incorrect cannot exceed attempted. The chapter must belong to the named student. Deletes require confirmation.
- `manage_student_pyq_records` — List, create, update or delete PYQ year records. One row per chapter, exam and year. Questions done cannot exceed the total. Deletes require confirmation.
- `manage_student_chapter_stages` — Read derived chapter-stage progress (manual claims plus real evidence) or toggle a student\
- `manage_student_backlog` — List, create, update, snooze, complete or delete backlog items. Snooze is a first-class backlog status. The optional chapter must belong to the named student. Deletes require confirmation.
- `manage_student_study_cards` — List, create, update, reorder or delete formula and flash cards for one student. The chapter must belong to that student. Deletes require confirmation.
- `manage_student_mock_analysis` — Manage error logs and time entries that belong to a student\
- `manage_student_exam_tracks` — List, create, update or delete a student\

## Exam catalogue (9)

- `list_exam_catalogue` — List every exam in the catalogue, including hidden exams. Hide is a soft flag only; catalogue rows are never physically deleted.
- `get_exam_definition` — Return one exam definition and how many students currently have it as their selected exam. Hidden exams remain readable.
- `create_exam` — Add a new exam to the catalogue using the same validation as the Control Center exam editor. Fails if the id already exists. updated_by is left empty because Master MCP is not an Owner account.
- `update_exam` — Replace an existing exam definition using the same validation as the Control Center exam editor. The id cannot be reused for a different exam. updated_by is left empty.
- `hide_exam` — Hide an exam from new student pickers. Students already on the exam keep it. The catalogue row is not physically deleted. Requires confirmation.
- `restore_exam` — Restore a hidden exam so it appears in new student pickers again. The catalogue row was never deleted. Requires confirmation because this change is visible to students.
- `reorder_exams` — Rewrite exam sort_order from the given id list (first id is first). Unknown ids are rejected and no rows are deleted.
- `update_exam_marking_scheme` — Set or clear the marking defaults for one exam using the shared marking-scheme validator. Null clears the stored scheme so built-in defaults apply.
- `update_exam_ai_model_preferences` — Update the global AI model preference lists used when ranking models. Providers are limited to Gemini, OpenAI, Anthropic, DeepSeek and Qwen.

## Global Stracker AI (20)

- `get_site_ai_status` — Show Stracker AI (Default) settings, every site provider with a masked key only, and whether credential encryption is configured. Never returns plaintext or encrypted keys. Does not read student BYOK providers.
- `list_site_ai_providers` — List global Stracker AI providers, including disabled ones, with masked keys only. Student-owned BYOK providers are never queried.
- `add_site_ai_provider` — Add a global Stracker AI provider. The API key is encrypted with AES-256-GCM and only a masked key is returned. Custom providers stay disabled and not default unless a valid discovery approval token is supplied.
- `update_site_ai_provider` — Update a global Stracker AI provider. A new API key is encrypted at rest. Custom providers without a valid approval token stay disabled and not default. Only a masked key is returned.
- `replace_site_ai_api_key` — Replace the encrypted API key for a global Stracker AI provider. Requires confirmation. The preview and result show only a masked key; the plaintext is never returned, logged or audited.
- `discover_site_ai_models` — Discover models for a saved site AI provider using the existing SSRF and endpoint rules. The stored key is decrypted only in memory and is never echoed. Custom discovery may return approval tokens, which are not API keys.
- `test_site_ai_provider` — Test the connection for a saved site AI provider. The stored key is decrypted only in memory and is never echoed. Network failures update site provider health only; student BYOK rows are not touched.
- `enable_site_ai_provider` — Enable a global Stracker AI provider. Unapproved custom providers stay disabled until they are approved or a connection test succeeds.
- `disable_site_ai_provider` — Disable a global Stracker AI provider and clear its default flag if it was the default.
- `set_default_site_ai_provider` — Make one enabled site AI provider the default. Unapproved custom providers cannot be made default.
- `reorder_site_ai_providers` — Move a site AI provider one place up or down in the fallback chain and rewrite priorities as 1..n.
- `remove_site_ai_provider` — Remove a global Stracker AI provider. Requires confirmation. This does not touch student BYOK providers.
- `update_site_ai_limits` — Update Stracker AI (Default) availability and per-student limits (1–60 requests per minute, 1–1000 per day).
- `get_ai_model_preferences` — Return the effective global AI model preference lists used when ranking models.
- `update_ai_model_preferences` — Update the global AI model preference lists. Providers are limited to Gemini, OpenAI, Anthropic, DeepSeek and Qwen.
- `get_ai_usage` — Aggregate Stracker AI usage since midnight Asia/Calcutta and the current count of active AI tasks. Returns available: false if the data cannot be read. It does not invent metrics.
- `get_ai_provider_health` — Return connection_status and runtime health for each site AI provider, with masked keys only.
- `list_ai_tasks` — List recent AI tasks with safe status fields only. Conversation content and metadata are omitted. Model IDs are masked for display.
- `get_ai_task` — Read one AI task by id, or by request id and student id. Conversation content and metadata are omitted.
- `cancel_ai_task` — Record cancellation for an active AI task. The agent observes the request at its next checkpoint; this does not claim the model has already halted.

## Public site editor (13)

- `get_site_content` — Read the current public-site draft and published copy (overrides plus Live Site Editor document). Drafts are never treated as live.
- `get_site_published_version` — Read the currently published public-site version only.
- `get_site_draft` — Read the unpublished public-site draft. If none exists, the published copy is returned as the working document with exists: false.
- `update_site_content_draft` — Replace the unpublished public-site draft using the existing Live Site Editor validators. Nothing is published. A revision check is applied when expectedUpdatedAt is sent.
- `update_site_page` — Replace the blocks on one public page in the draft (home, privacy, terms, about or contact). The change is validated with checkSiteDocument and is not published.
- `update_site_blocks` — Replace the blocks on one public page in the draft. Unsupported block types or properties are rejected by the existing validator. Nothing is published.
- `update_site_navigation_labels` — Update only existing public-header and notebook navigation label keys in the draft. Destinations and access rules stay fixed. Nothing is published.
- `update_site_design_tokens` — Merge Live Site Editor design tokens (light:name / dark:name) into the draft document. Unknown or disallowed values are rejected. Nothing is published.
- `preview_site_content` — Validate the current draft (or a supplied document) and return a validation report plus compiled CSS for one page. This does not publish.
- `validate_site_content` — Validate the current draft (or a supplied document) with the existing Live Site Editor and copy validators. This does not publish.
- `publish_site_content` — Publish the validated public-site draft atomically through site_content_commit_document and append version history. Requires confirmation. Never writes site_content_published directly.
- `list_site_content_versions` — List public-site version history (metadata only). Restore publishes a previous version as a new version through the same commit function.
- `restore_site_content_version` — Restore an earlier public-site version as a new version through site_content_commit_document. Requires confirmation. The version is re-validated first. Never writes site_content_published directly.

## Student dashboard editor (10)

- `get_student_dashboard_layout` — Read the published Student Dashboard Editor layout. This is presentation configuration only, not live student data.
- `get_student_dashboard_layout_draft` — Read the unpublished student layout draft. If none exists, the published layout is returned as the working document with exists: false.
- `update_student_dashboard_layout` — Replace the unpublished student layout draft after the existing layout validator runs. Required and data-bound components stay protected. Nothing is published.
- `update_student_dashboard_component` — Update one registered student component in the draft (supported text, props, style, visibility or lock). Essential components cannot be hidden; data-bound values cannot be written. Nothing is published.
- `reorder_student_dashboard_components` — Set the order of a container’s parts in the draft. Fixed-position and required parts cannot move. Nothing is published.
- `preview_student_dashboard_layout` — Validate the current draft (or a supplied layout) and return a validation report plus compiled CSS for phone, tablet and desktop. This does not publish.
- `validate_student_dashboard_layout` — Validate the current draft (or a supplied layout) with the existing Student Dashboard Editor validator. This does not publish.
- `publish_student_dashboard_layout` — Publish the validated student layout draft atomically through student_layout_commit and append version history. Requires confirmation. Never writes student_layout_published directly.
- `list_student_layout_versions` — List student layout version history (metadata only).
- `restore_student_dashboard_layout_version` — Restore an earlier student layout as a new version through student_layout_commit. Requires confirmation. The version is re-validated first. Never writes student_layout_published directly.

## Media library (6)

- `list_site_media` — List and search the public website media library. Filter by kind or whether a file is unused. Approved JPEG, PNG, WebP and MP4 files only. Public URLs are returned; storage credentials are not.
- `get_site_media` — Inspect one media library file: metadata, size, public URL and where it is used (draft, live site, saved versions).
- `upload_site_media` — Add an image or MP4 to the media library. Only approved MIME types are accepted. Small files may be sent as base64; larger files receive a single-use signed upload URL. The file is not published until a site draft uses it.
- `update_site_media` — Update the display name and alt text of a library file. This does not change any page by itself.
- `get_media_usage` — Show whether a media file is referenced by the draft, the live site or any saved version. Referenced files cannot be deleted.
- `delete_site_media` — Delete a genuinely unused media file from the library and storage. Requires confirmation. Files still referenced by a draft, the live site or a saved version are refused.

## Contact messages (5)

- `list_contact_messages` — List and search the public website contact inbox. Filter by status or reason. Pending uploads are hidden. This tool does not send email.
- `get_contact_message` — Read one contact message, including short-lived signed attachment URLs. Permanent storage URLs and bucket credentials are never returned. This tool does not send email.
- `update_contact_message_status` — Mark a contact message as new, read or archived. The change is audited by message id only, never by email or body text.
- `archive_contact_message` — Archive a contact message. This does not delete it and does not send email.
- `delete_contact_message` — Permanently delete a contact message and its attachments. Requires confirmation. This does not send email.

## Analytics (13)

- `get_analytics_overview` — Read the website analytics overview (visitors, sessions, page views, signups, writes, errors and daily series) in the requested time zone. Defaults to Asia/Kolkata. Missing data is labelled, never invented.
- `get_analytics_report` — Read a named first-party analytics report (overview, traffic, pages, audience, funnels, student, adoption, retention, journeys, performance, errors, dataops, custom, alerts, health or realtime). Defaults to Asia/Kolkata.
- `get_analytics_timeseries` — Read daily traffic timeseries (sessions by day, channels and sources) in the requested time zone. Defaults to Asia/Kolkata.
- `get_account_analytics` — Read account-level analytics: registrations in the period and active-account / retention figures. Unavailable feeds are labelled rather than invented.
- `get_student_activity_analytics` — Read student activity analytics (tests logged, study writes, feature activity and daily historical series) in the requested time zone.
- `get_feature_usage` — Read most- and least-used product features (live feature_opened events and historical account adoption).
- `get_traffic_sources` — Read visitor sources, channels, referrer domains and UTM breakdowns. Full URLs and geography are not collected.
- `get_error_groups` — List application error groups (scrubbed messages) with optional status filter and paging.
- `update_error_group` — Mark an error group as open, resolved or ignored and attach an operational note. Historical event rows and audit records are not rewritten.
- `get_analytics_alerts` — Read analytics alert rules, current evaluations and recent alert events.
- `update_analytics_alert` — Update an analytics alert event (acknowledge, mute, resolve or reopen). Historical audit records are not deleted or rewritten.
- `update_analytics_configuration` — Update a supported analytics configuration document (overview widgets, funnels, custom reports or alert rules) using the existing schemas.
- `export_analytics_report` — Export a named analytics report as CSV in the requested time zone. The export never includes passwords or credentials and never deletes or rewrites historical audit records.

## Operational settings (5)

- `get_operational_settings` — Read permitted operational settings: maintenance notice, maintenance message and site-down state. Sign-up, sign-in, domain rules, authentication and security settings are not returned.
- `update_operational_settings` — Update the maintenance notice flag and/or message. Use set_maintenance_mode to take the site down. Sign-up, sign-in, domain, authentication and security settings are rejected.
- `set_maintenance_mode` — Turn the public site down or bring it back up. Always returns an impact preview and requires confirmation before the change is applied. Does not change sign-up or sign-in switches.
- `update_maintenance_message` — Update only the public maintenance message (up to 500 characters). This does not take the site down by itself.
- `get_operational_status` — Read whether the public site is live, showing a maintenance notice, or down, plus the current message. Sign-up and sign-in switches are not included.

Total: 118 tools.
