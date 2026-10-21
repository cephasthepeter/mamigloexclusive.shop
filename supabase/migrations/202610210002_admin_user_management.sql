create or replace function public.list_store_admins()
returns table(email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_store_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  return query
    select allowlist.email, allowlist.created_at
    from public.admin_allowlist as allowlist
    order by allowlist.email;
end;
$$;

create or replace function public.remove_store_admin(p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  remaining_admins integer;
begin
  if auth.uid() is null or not private.is_store_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  if length(normalized_email) = 0 or position('@' in normalized_email) < 2 then
    raise exception 'Enter a valid administrator email address.' using errcode = '22023';
  end if;

  lock table public.admin_allowlist in share row exclusive mode;
  select count(*) into remaining_admins from public.admin_allowlist;
  if remaining_admins <= 1 then
    raise exception 'The last administrator cannot be removed.' using errcode = '23514';
  end if;

  if normalized_email = current_email then
    raise exception 'You cannot remove your own administrator access.' using errcode = '22023';
  end if;

  delete from public.admin_allowlist as allowlist where allowlist.email = normalized_email;
  if not found then
    raise exception 'Administrator not found.' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

revoke all on function public.list_store_admins() from public, anon;
revoke all on function public.remove_store_admin(text) from public, anon;
grant execute on function public.list_store_admins() to authenticated;
grant execute on function public.remove_store_admin(text) to authenticated;