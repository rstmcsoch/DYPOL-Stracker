-- Interface font preference for the Stracker web UI.
-- Only the four supported families are accepted; existing rows keep the default cut.
-- Exports (JSON, CSV, PDF, DOCX) are unaffected: they render with their own typography.

alter table public.app_settings
  add column if not exists interface_font text not null default 'default';

alter table public.app_settings
  drop constraint if exists app_settings_interface_font_valid;

alter table public.app_settings
  add constraint app_settings_interface_font_valid
  check (interface_font in ('default', 'poppins', 'sora', 'open-sans'));
