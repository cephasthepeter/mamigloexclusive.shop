alter table public.orders
  add column if not exists fulfilment_status text,
  add column if not exists payment_status text,
  add column if not exists payment_history jsonb;

update public.orders
set fulfilment_status = case
      when status in ('Awaiting Payment', 'Paid') then 'Pending'
      else status
    end,
    payment_status = case
      when status = 'Paid' or status_history @> '[{"status":"Paid"}]'::jsonb then 'Paid'
      else 'Pending'
    end,
    payment_history = case
      when status = 'Paid' or status_history @> '[{"status":"Paid"}]'::jsonb then
        jsonb_build_array(jsonb_build_object(
          'status', 'Paid', 'at', updated_at, 'changedBy', 'migration: legacy admin status'
        ))
      else '[]'::jsonb
    end
where fulfilment_status is null or payment_status is null or payment_history is null;

alter table public.orders
  alter column fulfilment_status set default 'Pending',
  alter column fulfilment_status set not null,
  alter column payment_status set default 'Pending',
  alter column payment_status set not null,
  alter column payment_history set default '[]'::jsonb,
  alter column payment_history set not null;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('Pending', 'Awaiting Payment', 'Paid', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_fulfilment_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders add constraint orders_fulfilment_status_check
      check (fulfilment_status in ('Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_payment_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders add constraint orders_payment_status_check
      check (payment_status in ('Pending', 'Paid', 'Failed', 'Refunded'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_payment_history_array_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders add constraint orders_payment_history_array_check
      check (jsonb_typeof(payment_history) = 'array');
  end if;
end;
$$;

create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_status text,
  p_actor_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_transition_allowed boolean := false;
  v_item record;
  v_now timestamptz := now();
begin
  if lower(btrim(coalesce(p_actor_email, ''))) <> lower(coalesce(auth.jwt() ->> 'email', ''))
    or not private.is_store_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_status not in ('Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled') then
    raise exception 'Choose a valid fulfilment status.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return false; end if;
  if v_order.fulfilment_status = p_status then return true; end if;
  v_transition_allowed := case v_order.fulfilment_status
    when 'Pending' then p_status in ('Confirmed', 'Processing', 'Cancelled')
    when 'Confirmed' then p_status in ('Processing', 'Cancelled')
    when 'Processing' then p_status in ('Shipped', 'Cancelled')
    when 'Shipped' then p_status = 'Delivered'
    else false
  end;
  if not v_transition_allowed then
    raise exception 'This fulfilment status transition is not allowed.' using errcode = 'P0001';
  end if;

  if p_status = 'Cancelled' and v_order.inventory_released_at is null then
    for v_item in
      select product_id, sum(quantity)::integer as quantity
      from public.order_items where order_id = v_order.id and product_id is not null
      group by product_id order by product_id
    loop
      update public.products set stock_quantity = stock_quantity + v_item.quantity, updated_at = v_now
        where id = v_item.product_id;
    end loop;
  end if;

  update public.orders set
    status = p_status,
    fulfilment_status = p_status,
    updated_at = v_now,
    inventory_released_at = case when p_status = 'Cancelled' then coalesce(inventory_released_at, v_now) else inventory_released_at end,
    status_history = status_history || jsonb_build_array(jsonb_build_object(
      'status', p_status, 'at', v_now, 'changedBy', lower(btrim(p_actor_email))
    ))
  where id = v_order.id;
  return true;
end;
$$;

create or replace function public.admin_update_order_payment_status(
  p_order_id uuid,
  p_status text,
  p_actor_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_transition_allowed boolean := false;
  v_now timestamptz := now();
begin
  if lower(btrim(coalesce(p_actor_email, ''))) <> lower(coalesce(auth.jwt() ->> 'email', ''))
    or not private.is_store_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_status not in ('Pending', 'Paid', 'Failed', 'Refunded') then
    raise exception 'Choose a valid payment status.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return false; end if;
  if v_order.payment_status = p_status then return true; end if;
  if v_order.fulfilment_status = 'Cancelled' and p_status = 'Paid' then
    raise exception 'A cancelled order cannot be marked paid.' using errcode = 'P0001';
  end if;
  v_transition_allowed := case v_order.payment_status
    when 'Pending' then p_status in ('Paid', 'Failed')
    when 'Failed' then p_status in ('Pending', 'Paid')
    when 'Paid' then p_status = 'Refunded'
    else false
  end;
  if not v_transition_allowed then
    raise exception 'This payment status transition is not allowed.' using errcode = 'P0001';
  end if;

  update public.orders set
    payment_status = p_status,
    updated_at = v_now,
    payment_history = payment_history || jsonb_build_array(jsonb_build_object(
      'status', p_status, 'at', v_now, 'changedBy', lower(btrim(p_actor_email))
    ))
  where id = v_order.id;
  return true;
end;
$$;

revoke all on function public.admin_update_order_payment_status(uuid, text, text) from public, anon;
grant execute on function public.admin_update_order_payment_status(uuid, text, text) to authenticated;