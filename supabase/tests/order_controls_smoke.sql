begin;

do $$
declare
  v_admin_email text;
  v_actor_id uuid;
  v_cod_order_id uuid;
  v_opay_order_id uuid;
  v_status text;
  v_payment_status text;
  v_carrier text;
  v_tracking text;
  v_updated_by text;
  v_transfer_reference text := 'SMOKE-TRANSFER-' || replace(gen_random_uuid()::text, '-', '');
begin
  select auth_user.id, lower(allowlist.email) into v_actor_id, v_admin_email
  from public.admin_allowlist as allowlist
  join auth.users as auth_user on lower(auth_user.email) = lower(allowlist.email)
  order by allowlist.email limit 1;
  if v_admin_email is null or v_actor_id is null then raise exception 'Smoke test requires an allowlisted administrator with an auth user.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_actor_id, 'email', v_admin_email)::text, true);

  insert into public.orders (
    reference, idempotency_key, customer_name, customer_phone, delivery_address,
    delivery_state, delivery_city, delivery_method, subtotal_ngn, delivery_fee_ngn,
    total_ngn, status, fulfilment_status, payment_status, payment_history, payment_method
  ) values (
    'SMOKE-COD-' || replace(gen_random_uuid()::text, '-', ''), gen_random_uuid(), 'Smoke Test',
    '+2348000000000', 'Test address', 'Lagos', 'Ikeja', 'Courier', 1000, 0,
    1000, 'Pending', 'Pending', 'Pending', '[]'::jsonb, 'cash_on_delivery'
  ) returning id into v_cod_order_id;

  perform public.admin_update_order_status(v_cod_order_id, 'Confirmed', v_admin_email);
  perform public.admin_update_order_status(v_cod_order_id, 'Processing', v_admin_email);
  perform public.admin_update_order_status(v_cod_order_id, 'Ready for Dispatch', v_admin_email);

  begin
    perform public.admin_update_order_status(v_cod_order_id, 'Shipped', v_admin_email);
    raise exception 'Expected a missing-carrier error.' using errcode = 'ZX001';
  exception
    when sqlstate 'P0001' then null;
    when sqlstate 'ZX001' then raise;
  end;

  perform public.admin_update_order_shipping(v_cod_order_id, 'Smoke Courier', 'SMOKE-TRACK', v_admin_email);
  perform public.admin_update_order_status(v_cod_order_id, 'Shipped', v_admin_email);
  perform public.admin_update_order_status(v_cod_order_id, 'Delivered', v_admin_email);
  perform public.admin_update_order_payment_status(v_cod_order_id, 'Paid', v_admin_email);

  select fulfilment_status, payment_status, shipping_carrier, tracking_number, shipping_updated_by_email
    into v_status, v_payment_status, v_carrier, v_tracking, v_updated_by
  from public.orders where id = v_cod_order_id;
  if v_status <> 'Delivered' or v_payment_status <> 'Paid' or v_carrier <> 'Smoke Courier'
    or v_tracking <> 'SMOKE-TRACK' or v_updated_by <> v_admin_email then
    raise exception 'COD fulfilment, payment, or shipping audit assertion failed.';
  end if;

  insert into public.orders (
    reference, idempotency_key, customer_user_id, customer_name, customer_phone, delivery_address,
    delivery_state, delivery_city, delivery_method, subtotal_ngn, delivery_fee_ngn,
    total_ngn, status, fulfilment_status, payment_status, payment_history,
    payment_method
  ) values (
    'SMOKE-OPAY-' || replace(gen_random_uuid()::text, '-', ''), gen_random_uuid(), v_actor_id, 'Smoke Test',
    '+2348000000000', 'Test address', 'Lagos', 'Ikeja', 'Courier', 1000, 0,
    1000, 'Pending', 'Pending', 'Pending', '[]'::jsonb,
    'opay_transfer'
  ) returning id into v_opay_order_id;

  perform public.submit_order_payment_confirmation(
    v_opay_order_id, v_actor_id, v_transfer_reference, 1000, 'opay_transfer'
  );
  select payment_status into v_payment_status from public.orders where id = v_opay_order_id;
  if v_payment_status <> 'Pending Verification' then
    raise exception 'Customer payment submission must only create a pending verification.';
  end if;

  begin
    perform public.admin_update_order_status(v_opay_order_id, 'Processing', v_admin_email);
    raise exception 'Expected an unpaid OPay fulfilment error.' using errcode = 'ZX001';
  exception
    when sqlstate 'P0001' then null;
    when sqlstate 'ZX001' then raise;
  end;

  perform public.admin_review_payment(v_opay_order_id, 'confirm', v_admin_email, null);
  select fulfilment_status, payment_status into v_status, v_payment_status
    from public.orders where id = v_opay_order_id;
  if v_status <> 'Pending' or v_payment_status <> 'Paid' then
    raise exception 'Payment confirmation changed fulfilment or failed to record Paid.';
  end if;

  raise notice 'Order control smoke test passed; all test changes will be rolled back.';
end;
$$;

rollback;