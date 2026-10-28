alter table public.orders
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists orders_archived_created_at_idx
  on public.orders (archived_at, created_at desc);

create or replace function public.admin_set_order_archived(
  p_order_id uuid,
  p_archived boolean,
  p_actor_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null
    or lower(btrim(coalesce(p_actor_email, ''))) <> lower(coalesce(auth.jwt() ->> 'email', ''))
    or not private.is_store_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_archived is null then
    raise exception 'Choose whether to archive or restore the order.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return false; end if;
  if (v_order.archived_at is not null) = p_archived then return true; end if;

  update public.orders set
    archived_at = case when p_archived then now() else null end,
    archived_by = case when p_archived then auth.uid() else null end,
    updated_at = now()
  where id = p_order_id;
  return true;
end;
$$;

revoke all on function public.admin_set_order_archived(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_order_archived(uuid, boolean, text) to authenticated;