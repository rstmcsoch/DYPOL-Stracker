# Master MCP compatibility review

Reviewed for the close-out of the Master MCP stack (items 71–80). This work must not change
the shared web / PWA / Android contracts, student AI, student BYOK, RLS or Owner protections.

## Shared clients

- The Flutter Android app and the PWA still sync the same canonical Supabase student tables
  (`src/types/index.ts` / `src/lib/database.ts`). Master writes go to those tables through
  the existing validators. No Dexie / IndexedDB or mobile schema change is included.
- Public site publishing still goes through `site_content_commit_document`. Student layout
  publishing still goes through `student_layout_commit`. Required layout components cannot
  be hidden; data-bound values cannot be overwritten.
- Exam catalogue hide remains a soft hide. Catalogue rows are not physically deleted.

## Student AI and BYOK

- Student-facing Stracker AI tools in `api/_lib/tools.ts` are unchanged and remain scoped
  to the signed-in student.
- Master AI tools operate only on `site_ai_providers` and related global configuration.
  They never query `ai_provider_configs`. Raw admin keys are not returned.

## Security posture

- Existing RLS policies are not weakened.
- Owner protections, Control Center role-holder protections, passkey triggers and
  sign-up / sign-in switches remain Owner-controlled and are unreachable from Master tools.
- The `master_mcp` migration is additive. It does not rewrite `control_roles` or permission
  matrices.

## This close-out change set

Phase 8 adds Master tool modules and services under `api/_lib/mcp` and `api/_lib/services`,
tests, and documentation. It does not add a thirteenth Vercel function (the `/api/mcp`
rewrite to `/api/control/system?route=mcp` is unchanged). It does not modify Flutter,
student AI tool contracts, or client-facing TypeScript record types.
