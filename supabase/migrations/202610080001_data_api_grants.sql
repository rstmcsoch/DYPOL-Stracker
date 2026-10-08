-- Stracker: explicitly grant Data API privileges to the signed-in app role.
-- Supabase projects created under the 2026 Data API changes may not expose
-- newly-created public tables through implicit grants. RLS still restricts
-- every row to auth.uid() = user_id.

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Keep future Stracker public tables reachable by the authenticated Data API role.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  grant usage, select on sequences to authenticated;

notify pgrst, 'reload schema';
