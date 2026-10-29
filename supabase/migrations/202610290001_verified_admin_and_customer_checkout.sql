create or replace function private.is_store_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.admin_allowlist as allowlist
      join auth.users as auth_user on auth_user.id = auth.uid()
      where allowlist.email = lower(coalesce(auth.jwt() ->> 'email', ''))
        and allowlist.email = lower(auth_user.email)
        and auth_user.email_confirmed_at is not null
    );
$$;

revoke all on function private.is_store_admin() from public;
grant execute on function private.is_store_admin() to anon, authenticated, service_role;

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
  if p_customer_user_id is null then
    raise exception 'A signed-in customer is required to place an order.' using errcode = '42501';
  end if;
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

revoke all on function public.create_order_with_payment_method(jsonb, jsonb, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_order_with_payment_method(jsonb, jsonb, uuid, uuid, text) to service_role;