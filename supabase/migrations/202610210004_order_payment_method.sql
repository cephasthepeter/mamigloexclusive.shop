alter table public.orders
  add column if not exists payment_method text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_payment_method_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders add constraint orders_payment_method_check
      check (payment_method is null or payment_method in ('opay_transfer', 'cash_on_delivery'));
  end if;
end;
$$;

create function public.create_order_with_payment_method(
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
  v_stored_method text;
begin
  if p_payment_method is null or p_payment_method not in ('opay_transfer', 'cash_on_delivery') then
    raise exception 'Choose a supported payment method.' using errcode = '22023';
  end if;

  v_order := public.create_order_with_customer(
    p_customer, p_items, p_idempotency_key, p_customer_user_id
  );
  v_order_id := (v_order ->> 'id')::uuid;

  select payment_method into v_stored_method from public.orders where id = v_order_id for update;
  if v_stored_method is null then
    update public.orders set payment_method = p_payment_method
    where id = v_order_id
    returning payment_method into v_stored_method;
  end if;

  return v_order || jsonb_build_object('paymentMethod', v_stored_method);
end;
$$;

revoke all on function public.create_order_with_payment_method(jsonb, jsonb, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_order_with_payment_method(jsonb, jsonb, uuid, uuid, text) to service_role;