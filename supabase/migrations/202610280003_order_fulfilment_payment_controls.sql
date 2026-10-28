alter table public.orders
  add column if not exists fulfilment_status text,
  add column if not exists payment_status text,
  add column if not exists payment_history jsonb,
  add column if not exists payment_method text,
  add column if not exists payment_reference text,
  add column if not exists opay_account_number text,
  add column if not exists opay_account_name text,
  add column if not exists payment_confirmation_submitted_at timestamptz,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_rejected_at timestamptz,
  add column if not exists payment_rejection_reason text,
  add column if not exists verifying_admin_id uuid references auth.users(id) on delete set null,
  add column if not exists payment_verification_window_seconds integer not null default 900,
  add column if not exists shipping_carrier text,
  add column if not exists tracking_number text,
  add column if not exists shipping_updated_at timestamptz,
  add column if not exists shipping_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists shipping_updated_by_email text;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
grant select on public.orders, public.order_items to authenticated;

drop policy if exists orders_customer_read on public.orders;
create policy orders_customer_read on public.orders
  for select to authenticated using (customer_user_id = (select auth.uid()));

drop policy if exists order_items_customer_read on public.order_items;
create policy order_items_customer_read on public.order_items
  for select to authenticated using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.customer_user_id = (select auth.uid())
    )
  );

update public.orders
set fulfilment_status = case when status in ('Awaiting Payment', 'Paid') then 'Pending' else status end,
    payment_status = case when status = 'Paid' or status_history @> '[{"status":"Paid"}]'::jsonb then 'Paid' else 'Pending' end,
    payment_history = case
      when status = 'Paid' or status_history @> '[{"status":"Paid"}]'::jsonb then
        jsonb_build_array(jsonb_build_object('status', 'Paid', 'at', updated_at, 'changedBy', 'migration: legacy order status'))
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

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_method_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_payment_method_check
      check (payment_method is null or payment_method in ('opay_transfer', 'cash_on_delivery'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_history_array_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_payment_history_array_check check (jsonb_typeof(payment_history) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_status_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_payment_status_check
      check (payment_status in ('Pending', 'Pending Verification', 'Paid', 'Failed', 'Rejected', 'Refunded'));
  else
    alter table public.orders drop constraint orders_payment_status_check;
    alter table public.orders add constraint orders_payment_status_check
      check (payment_status in ('Pending', 'Pending Verification', 'Paid', 'Failed', 'Rejected', 'Refunded'));
  end if;
end;
$$;

create index if not exists orders_payment_verification_idx
  on public.orders (payment_status, payment_confirmation_submitted_at)
  where payment_status in ('Pending Verification', 'Rejected');

create or replace function public.create_order_with_payment_method(
  p_customer jsonb,
  p_items jsonb,
  p_idempotency_key uuid,
  p_customer_user_id uuid,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order jsonb;
  v_order_id uuid;
  v_existing_method text;
  v_existing_customer_id uuid;
begin
  if p_payment_method is null or p_payment_method not in ('opay_transfer', 'cash_on_delivery') then
    raise exception 'Choose a supported payment method.' using errcode = '22023';
  end if;
  v_order := public.create_order(p_customer, p_items, p_idempotency_key);
  v_order_id := (v_order ->> 'id')::uuid;
  select payment_method, customer_user_id into v_existing_method, v_existing_customer_id
  from public.orders where id = v_order_id for update;
  if v_existing_method is not null and v_existing_method <> p_payment_method then
    raise exception 'This order was already submitted with a different payment method.' using errcode = 'P0001';
  end if;
  if v_existing_customer_id is not null and v_existing_customer_id is distinct from p_customer_user_id then
    raise exception 'This order is already associated with another customer.' using errcode = '42501';
  end if;
  update public.orders set
    payment_method = p_payment_method,
    customer_user_id = coalesce(customer_user_id, p_customer_user_id)
  where id = v_order_id;
  return v_order || jsonb_build_object(
    'paymentMethod', p_payment_method,
    'customerUserId', coalesce(v_existing_customer_id, p_customer_user_id)
  );
end;
$$;

create or replace function public.submit_order_payment_confirmation(
  p_order_id uuid,
  p_customer_user_id uuid,
  p_payment_reference text,
  p_payment_amount numeric,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_now timestamptz := now();
  v_actor uuid := auth.uid();
begin
  if v_actor is null or p_customer_user_id is distinct from v_actor then
    raise exception 'You can only confirm your own order payment.' using errcode = '42501';
  end if;
  if p_payment_method is distinct from 'opay_transfer' then
    raise exception 'Only OPay bank transfer is supported for manual payment verification.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_payment_reference, ''))) not between 1 and 160 then
    raise exception 'Enter the transfer reference shown by your payment provider.' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_order.customer_user_id is distinct from v_actor or v_order.payment_method is distinct from 'opay_transfer' then
    raise exception 'You can only submit payment details for your own OPay order.' using errcode = '42501';
  end if;
  if p_payment_amount is null or v_order.total_ngn <> p_payment_amount then
    raise exception 'The transfer amount must match the order total.' using errcode = '22023';
  end if;
  if v_order.payment_status not in ('Pending', 'Rejected') then
    raise exception 'This order is not awaiting a new payment confirmation.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.orders
    where id <> v_order.id
      and lower(btrim(coalesce(payment_reference, ''))) = lower(btrim(p_payment_reference))
  ) then
    raise exception 'This transfer reference has already been used.' using errcode = '23505';
  end if;
  update public.orders set
    payment_status = 'Pending Verification',
    payment_reference = btrim(p_payment_reference),
    payment_confirmation_submitted_at = v_now,
    payment_rejected_at = null,
    payment_rejection_reason = null,
    opay_account_number = coalesce(opay_account_number, '9155556748'),
    opay_account_name = coalesce(opay_account_name, 'Mamigloexclusive'),
    updated_at = v_now,
    payment_history = payment_history || jsonb_build_array(jsonb_build_object(
      'status', 'Pending Verification', 'at', v_now, 'changedBy', v_actor::text
    ))
  where id = v_order.id;
  return jsonb_build_object('orderId', v_order.id, 'paymentStatus', 'Pending Verification', 'submittedAt', v_now, 'amount', v_order.total_ngn);
end;
$$;

create index if not exists orders_customer_payment_reference_idx
  on public.orders (customer_user_id, payment_reference) where payment_reference is not null;
create unique index if not exists orders_payment_reference_unique_idx
  on public.orders (lower(btrim(payment_reference))) where payment_reference is not null;

revoke all on function public.create_order_with_payment_method(jsonb,jsonb,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.submit_order_payment_confirmation(uuid,uuid,text,numeric,text) from public, anon;
grant execute on function public.create_order_with_payment_method(jsonb,jsonb,uuid,uuid,text) to service_role;
grant execute on function public.submit_order_payment_confirmation(uuid,uuid,text,numeric,text) to authenticated;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('Pending', 'Awaiting Payment', 'Paid', 'Confirmed', 'Processing', 'Ready for Dispatch', 'Shipped', 'Delivered', 'Completed', 'Cancelled'));

alter table public.orders drop constraint if exists orders_fulfilment_status_check;
alter table public.orders add constraint orders_fulfilment_status_check
  check (fulfilment_status in ('Pending', 'Confirmed', 'Processing', 'Ready for Dispatch', 'Shipped', 'Delivered', 'Completed', 'Cancelled'));

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
  if auth.uid() is null
    or lower(btrim(coalesce(p_actor_email, ''))) <> lower(coalesce(auth.jwt() ->> 'email', ''))
    or not private.is_store_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_status not in ('Pending', 'Confirmed', 'Processing', 'Ready for Dispatch', 'Shipped', 'Delivered', 'Completed', 'Cancelled') then
    raise exception 'Choose a valid fulfilment status.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return false; end if;
  if v_order.fulfilment_status = p_status then return true; end if;

  v_transition_allowed := case v_order.fulfilment_status
    when 'Pending' then p_status in ('Confirmed', 'Cancelled')
    when 'Confirmed' then p_status in ('Processing', 'Cancelled')
    when 'Processing' then p_status in ('Ready for Dispatch', 'Cancelled')
    when 'Ready for Dispatch' then p_status in ('Shipped', 'Cancelled')
    when 'Shipped' then p_status = 'Delivered'
    when 'Delivered' then p_status = 'Completed'
    else false
  end;
  if not v_transition_allowed then
    raise exception 'This fulfilment status transition is not allowed.' using errcode = 'P0001';
  end if;
  if p_status in ('Processing', 'Ready for Dispatch', 'Shipped', 'Delivered')
    and v_order.payment_method = 'opay_transfer'
    and v_order.payment_status <> 'Paid' then
    raise exception 'Verify the OPay transfer before processing or dispatching this order.' using errcode = 'P0001';
  end if;
  if p_status = 'Shipped' and nullif(btrim(coalesce(v_order.shipping_carrier, '')), '') is null then
    raise exception 'Save the shipping carrier before marking this order as shipped.' using errcode = 'P0001';
  end if;
  if p_status = 'Completed' and v_order.payment_status <> 'Paid' then
    raise exception 'Payment must be recorded before completing the order.' using errcode = 'P0001';
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
      'status', p_status,
      'at', v_now,
      'changedBy', lower(btrim(p_actor_email))
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
  if auth.uid() is null
    or lower(btrim(coalesce(p_actor_email, ''))) <> lower(coalesce(auth.jwt() ->> 'email', ''))
    or not private.is_store_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_status not in ('Pending', 'Paid', 'Failed', 'Refunded') then
    raise exception 'Use the payment verification workflow for this status.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return false; end if;
  if v_order.payment_status = p_status then return true; end if;
  if v_order.payment_method = 'opay_transfer' and p_status = 'Paid' then
    raise exception 'OPay payments must be confirmed from a pending verification request.' using errcode = 'P0001';
  end if;
  if p_status = 'Paid' and v_order.payment_method is distinct from 'cash_on_delivery' then
    raise exception 'Only a manually verified cash-on-delivery payment can be recorded here.' using errcode = 'P0001';
  end if;
  if p_status = 'Paid' and v_order.fulfilment_status <> 'Delivered' then
    raise exception 'Cash-on-delivery payment can only be marked paid after delivery.' using errcode = 'P0001';
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
    payment_confirmed_at = case when p_status = 'Paid' then v_now else payment_confirmed_at end,
    verifying_admin_id = case when p_status = 'Paid' then auth.uid() else verifying_admin_id end,
    updated_at = v_now,
    payment_history = payment_history || jsonb_build_array(jsonb_build_object(
      'status', p_status,
      'at', v_now,
      'changedBy', lower(btrim(p_actor_email))
    ))
  where id = v_order.id;
  return true;
end;
$$;

create or replace function public.admin_review_payment(
  p_order_id uuid,
  p_decision text,
  p_admin_email text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_now timestamptz := now();
begin
  if auth.uid() is null
    or lower(btrim(coalesce(p_admin_email, ''))) <> lower(coalesce(auth.jwt() ->> 'email', ''))
    or not private.is_store_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('confirm', 'reject') then
    raise exception 'Choose a valid payment decision.' using errcode = '22023';
  end if;
  if p_decision = 'reject' and length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A rejection reason is required before rejecting a payment.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_order.payment_method is distinct from 'opay_transfer' or v_order.payment_status <> 'Pending Verification' then
    raise exception 'Only a submitted OPay transfer awaiting review can be confirmed or rejected.' using errcode = 'P0001';
  end if;
  if p_decision = 'confirm' and v_order.fulfilment_status = 'Cancelled' then
    raise exception 'A cancelled order cannot be marked paid.' using errcode = 'P0001';
  end if;

  update public.orders set
    payment_status = case when p_decision = 'confirm' then 'Paid' else 'Rejected' end,
    payment_confirmed_at = case when p_decision = 'confirm' then v_now else payment_confirmed_at end,
    payment_rejected_at = case when p_decision = 'reject' then v_now else null end,
    payment_rejection_reason = case when p_decision = 'reject' then btrim(p_reason) else null end,
    verifying_admin_id = auth.uid(),
    updated_at = v_now,
    payment_history = payment_history || jsonb_build_array(jsonb_build_object(
      'status', case when p_decision = 'confirm' then 'Paid' else 'Rejected' end,
      'at', v_now,
      'changedBy', lower(btrim(p_admin_email)),
      'reason', case when p_decision = 'reject' then btrim(p_reason) else null end
    ))
  where id = v_order.id;

  return jsonb_build_object(
    'orderId', v_order.id,
    'decision', p_decision,
    'paymentStatus', case when p_decision = 'confirm' then 'Paid' else 'Rejected' end,
    'updatedAt', v_now
  );
end;
$$;

create or replace function public.admin_update_order_shipping(
  p_order_id uuid,
  p_carrier text,
  p_tracking_number text,
  p_actor_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_now timestamptz := now();
begin
  if auth.uid() is null
    or lower(btrim(coalesce(p_actor_email, ''))) <> lower(coalesce(auth.jwt() ->> 'email', ''))
    or not private.is_store_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_carrier, ''))) > 120 or length(btrim(coalesce(p_tracking_number, ''))) > 160 then
    raise exception 'Shipping details exceed the allowed length.' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return false; end if;
  if v_order.fulfilment_status not in ('Ready for Dispatch', 'Shipped', 'Delivered') then
    raise exception 'Shipping details can be saved when the order is ready for dispatch.' using errcode = 'P0001';
  end if;

  update public.orders set
    shipping_carrier = nullif(btrim(coalesce(p_carrier, '')), ''),
    tracking_number = nullif(btrim(coalesce(p_tracking_number, '')), ''),
    shipping_updated_at = v_now,
    shipping_updated_by = auth.uid(),
    shipping_updated_by_email = lower(btrim(p_actor_email)),
    updated_at = v_now
  where id = v_order.id;
  return true;
end;
$$;

revoke all on function public.admin_update_order_status(uuid, text, text) from public, anon;
revoke all on function public.admin_update_order_payment_status(uuid, text, text) from public, anon;
revoke all on function public.admin_review_payment(uuid, text, text, text) from public, anon;
revoke all on function public.admin_update_order_shipping(uuid, text, text, text) from public, anon;
grant execute on function public.admin_update_order_status(uuid, text, text) to authenticated;
grant execute on function public.admin_update_order_payment_status(uuid, text, text) to authenticated;
grant execute on function public.admin_review_payment(uuid, text, text, text) to authenticated;
grant execute on function public.admin_update_order_shipping(uuid, text, text, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
    ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;