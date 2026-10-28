alter table public.orders
  add column if not exists payment_reference text,
  add column if not exists opay_account_number text,
  add column if not exists opay_account_name text,
  add column if not exists payment_confirmation_submitted_at timestamptz,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_rejected_at timestamptz,
  add column if not exists payment_rejection_reason text,
  add column if not exists verifying_admin_id uuid,
  add column if not exists payment_verification_window_seconds integer not null default 900;

create index if not exists orders_payment_verification_idx
  on public.orders (payment_status, payment_confirmation_submitted_at)
  where payment_status in ('Pending Verification', 'Rejected');

create index if not exists orders_customer_payment_reference_idx
  on public.orders (customer_user_id, payment_reference)
  where payment_reference is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_payment_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders add constraint orders_payment_status_check
      check (payment_status in ('Pending', 'Pending Verification', 'Paid', 'Failed', 'Rejected', 'Refunded'));
  else
    alter table public.orders drop constraint if exists orders_payment_status_check;
    alter table public.orders add constraint orders_payment_status_check
      check (payment_status in ('Pending', 'Pending Verification', 'Paid', 'Failed', 'Rejected', 'Refunded'));
  end if;
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
  if p_status not in ('Pending', 'Pending Verification', 'Paid', 'Failed', 'Rejected', 'Refunded') then
    raise exception 'Choose a valid payment status.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return false; end if;
  if v_order.payment_status = p_status then return true; end if;
  if v_order.fulfilment_status = 'Cancelled' and p_status = 'Paid' then
    raise exception 'A cancelled order cannot be marked paid.' using errcode = 'P0001';
  end if;

  v_transition_allowed := case v_order.payment_status
    when 'Pending' then p_status in ('Pending Verification', 'Paid', 'Failed', 'Rejected')
    when 'Pending Verification' then p_status in ('Paid', 'Failed', 'Rejected')
    when 'Failed' then p_status in ('Pending', 'Paid', 'Rejected')
    when 'Rejected' then p_status in ('Pending', 'Paid')
    when 'Paid' then p_status = 'Refunded'
    else false
  end;

  if not v_transition_allowed then
    raise exception 'This payment status transition is not allowed.' using errcode = 'P0001';
  end if;

  update public.orders set
    payment_status = p_status,
    payment_confirmation_submitted_at = case when p_status = 'Pending Verification' then coalesce(payment_confirmation_submitted_at, v_now) else payment_confirmation_submitted_at end,
    payment_confirmed_at = case when p_status = 'Paid' then coalesce(payment_confirmed_at, v_now) else payment_confirmed_at end,
    payment_rejected_at = case when p_status = 'Rejected' then coalesce(payment_rejected_at, v_now) else payment_rejected_at end,
    verifying_admin_id = case when p_status in ('Paid', 'Rejected') then auth.uid() else verifying_admin_id end,
    updated_at = v_now,
    payment_history = payment_history || jsonb_build_array(jsonb_build_object(
      'status', p_status,
      'at', v_now,
      'changedBy', lower(btrim(p_actor_email))
    ))
  where id = v_order.id;

  if p_status = 'Paid' and v_order.fulfilment_status = 'Pending' then
    update public.orders set
      fulfilment_status = 'Confirmed',
      status = 'Confirmed',
      status_history = status_history || jsonb_build_array(jsonb_build_object(
        'status', 'Confirmed',
        'at', v_now,
        'changedBy', lower(btrim(p_actor_email))
      ))
    where id = v_order.id;
  end if;

  return true;
end;
$$;

revoke all on function public.admin_update_order_payment_status(uuid, text, text) from public, anon;
grant execute on function public.admin_update_order_payment_status(uuid, text, text) to authenticated;

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
begin
  if coalesce(p_payment_method, '') = '' then
    raise exception 'Choose a supported payment method.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if v_order.customer_user_id is null or v_order.customer_user_id <> p_customer_user_id then
    raise exception 'You can only confirm your own order payment.' using errcode = '42501';
  end if;

  if v_order.payment_method is not null and v_order.payment_method <> 'opay_transfer' then
    raise exception 'Only OPay orders can submit a payment verification request.' using errcode = '22023';
  end if;

  if p_payment_method <> 'opay_transfer' then
    raise exception 'Only OPay bank transfer is supported for manual payment verification.' using errcode = '22023';
  end if;

  if coalesce(v_order.total_ngn, 0) <> coalesce(p_payment_amount, 0) then
    raise exception 'The transfer amount must match the authoritative order total.' using errcode = '22023';
  end if;

  if v_order.payment_status in ('Paid', 'Pending Verification', 'Rejected') then
    raise exception 'This payment confirmation has already been submitted.' using errcode = '23505';
  end if;

  update public.orders set
    payment_status = 'Pending Verification',
    payment_reference = coalesce(p_payment_reference, payment_reference),
    payment_confirmation_submitted_at = v_now,
    opay_account_number = coalesce(opay_account_number, '9155556748'),
    opay_account_name = coalesce(opay_account_name, 'Mamigloexclusive'),
    payment_verification_window_seconds = 900,
    updated_at = v_now,
    payment_history = payment_history || jsonb_build_array(jsonb_build_object(
      'status', 'Pending Verification',
      'at', v_now,
      'changedBy', coalesce(p_customer_user_id::text, 'customer')
    ))
  where id = v_order.id;

  return jsonb_build_object(
    'orderId', v_order.id,
    'paymentStatus', 'Pending Verification',
    'submittedAt', v_now,
    'amount', v_order.total_ngn
  );
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
  v_actor_id uuid;
begin
  if lower(btrim(coalesce(p_admin_email, ''))) <> lower(coalesce(auth.jwt() ->> 'email', ''))
    or not private.is_store_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  if p_decision not in ('confirm', 'reject') then
    raise exception 'Choose a valid payment decision.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  v_actor_id := auth.uid();

  if p_decision = 'confirm' then
    update public.orders set
      payment_status = 'Paid',
      payment_confirmed_at = v_now,
      verifying_admin_id = v_actor_id,
      payment_rejected_at = null,
      payment_rejection_reason = null,
      status = 'Confirmed',
      fulfilment_status = 'Confirmed',
      updated_at = v_now,
      payment_history = payment_history || jsonb_build_array(jsonb_build_object(
        'status', 'Paid',
        'at', v_now,
        'changedBy', lower(btrim(p_admin_email))
      )),
      status_history = status_history || jsonb_build_array(jsonb_build_object(
        'status', 'Confirmed',
        'at', v_now,
        'changedBy', lower(btrim(p_admin_email))
      ))
    where id = v_order.id;
  else
    if btrim(coalesce(p_reason, '')) = '' then
      raise exception 'A rejection reason is required before rejecting the payment.' using errcode = '22023';
    end if;

    update public.orders set
      payment_status = 'Rejected',
      payment_rejected_at = v_now,
      verifying_admin_id = v_actor_id,
      payment_rejection_reason = p_reason,
      updated_at = v_now,
      payment_history = payment_history || jsonb_build_array(jsonb_build_object(
        'status', 'Rejected',
        'at', v_now,
        'changedBy', lower(btrim(p_admin_email))
      ))
    where id = v_order.id;
  end if;

  return jsonb_build_object(
    'orderId', v_order.id,
    'decision', p_decision,
    'paymentStatus', case when p_decision = 'confirm' then 'Paid' else 'Rejected' end,
    'updatedAt', v_now
  );
end;
$$;

revoke all on function public.submit_order_payment_confirmation(uuid, uuid, text, numeric, text) from public, anon;
grant execute on function public.submit_order_payment_confirmation(uuid, uuid, text, numeric, text) to authenticated;

revoke all on function public.admin_review_payment(uuid, text, text, text) from public, anon;
grant execute on function public.admin_review_payment(uuid, text, text, text) to authenticated;
