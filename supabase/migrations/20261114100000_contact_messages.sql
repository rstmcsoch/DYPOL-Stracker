-- Contact messages from the public /contact page, read by the owner in Control Center → Messages.
--
-- Additive and forward-only. Security model (same as the other owner-only console tables):
--   * RLS enabled and FORCED, with no policies: anon and authenticated can neither read nor
--     write this table directly. Every write goes through POST /api/contact, and every read or
--     change through the owner-only (aal2) /api/control/messages route, both server-side with
--     the service role after their own validation and authorization.
--   * The sender's network address is never stored; only a one-way hash used for spam limits.
--   * Attachments live in the PRIVATE `contact-attachments` bucket. There are no storage
--     policies for it, so browsers can neither list nor read it. Senders upload only through
--     short-lived signed upload URLs issued by /api/contact for their own pending message; the
--     owner reads through short-lived signed URLs issued by the owner-only API.
--   * A message stays `pending` (invisible to the owner) until the server has verified every
--     uploaded file (size, type, magic bytes) and finalised it.

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  name text not null,
  email text not null,
  reason text not null,
  subject text,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  links jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  user_id uuid references auth.users(id) on delete set null,
  client_hash text,
  upload_token_hash text,
  read_at timestamptz,
  constraint contact_messages_name_length check (char_length(name) between 1 and 80),
  constraint contact_messages_email_shape check (char_length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint contact_messages_reason check (reason in ('feature_request', 'bug_report', 'complaint', 'copyright', 'sponsorship', 'general_query')),
  constraint contact_messages_subject_length check (subject is null or char_length(subject) between 1 and 120),
  constraint contact_messages_message_length check (char_length(message) between 10 and 4000),
  constraint contact_messages_details_object check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 12000),
  constraint contact_messages_links_array check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 5),
  constraint contact_messages_attachments_array check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5),
  constraint contact_messages_status check (status in ('pending', 'new', 'read', 'archived')),
  constraint contact_messages_client_hash_length check (client_hash is null or char_length(client_hash) <= 64),
  constraint contact_messages_token_hash_length check (upload_token_hash is null or char_length(upload_token_hash) = 64)
);

create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_status_idx on public.contact_messages (status, created_at desc);
create index if not exists contact_messages_user_idx on public.contact_messages (user_id);

alter table public.contact_messages enable row level security;
alter table public.contact_messages force row level security;
revoke all on table public.contact_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.contact_messages to service_role;

-- Private attachment bucket: PDF, JPEG and PNG only, 10 MB per file (the 15 MB per-message
-- total is enforced by the API). No public read and no storage.objects policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contact-attachments', 'contact-attachments', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
