create or replace function public.is_current_user_store_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and private.is_store_admin();
$$;

revoke all on function public.is_current_user_store_admin() from public, anon;
grant execute on function public.is_current_user_store_admin() to authenticated;