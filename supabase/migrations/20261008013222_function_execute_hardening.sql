-- Remove the remaining explicit API EXECUTE grants.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.set_updated_at() from anon, authenticated, public;

notify pgrst, 'reload schema';
