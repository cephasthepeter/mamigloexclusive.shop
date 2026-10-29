begin;
select plan(60);

select ok(
  position('where id is not null' in lower(pg_get_functiondef('public.admin_publish_hero_content()'::regprocedure))) > 0,
  'homepage hero publication uses a filtered campaign delete'
);

select ok(
  not has_table_privilege('anon', 'public.orders', 'select'),
  'anonymous visitors cannot read customer orders'
);
select ok(
  not has_table_privilege('anon', 'public.order_items', 'select'),
  'anonymous visitors cannot read order items'
);
select ok(
  position('auth.uid' in coalesce((select qual from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_customer_read'), '')) > 0,
  'customers can read only their own orders'
);
select ok(
  position('auth.uid' in coalesce((select qual from pg_policies where schemaname = 'public' and tablename = 'order_items' and policyname = 'order_items_customer_read'), '')) > 0,
  'customers can read order items only through their own orders'
);
select ok(
  position('email_confirmed_at' in lower(pg_get_functiondef('private.is_store_admin()'::regprocedure))) > 0,
  'administrator database policies require a confirmed email'
);
select ok(
  not has_table_privilege('anon', 'public.admin_allowlist', 'select'),
  'the administrator allowlist is not exposed'
);
select ok(
  not has_function_privilege('anon', 'public.create_order(jsonb,jsonb,uuid)', 'execute'),
  'anonymous visitors cannot bypass the rate-limited checkout function'
);
select ok(
  not has_function_privilege('anon', 'public.consume_checkout_rate_limit(text)', 'execute'),
  'anonymous visitors cannot access the rate limiter directly'
);
select ok(
  not has_function_privilege('anon', 'public.is_current_user_store_admin()', 'execute'),
  'anonymous visitors cannot check administrator access'
);
select ok(
  has_function_privilege('authenticated', 'public.is_current_user_store_admin()', 'execute'),
  'signed-in users can check their own administrator access'
);
select ok(
  not has_function_privilege('anon', 'public.list_store_admins()', 'execute'),
  'anonymous visitors cannot list administrators'
);
select ok(
  has_function_privilege('authenticated', 'public.list_store_admins()', 'execute'),
  'signed-in administrators can list allowlisted administrators'
);
select ok(
  not has_function_privilege('anon', 'public.remove_store_admin(text)', 'execute'),
  'anonymous visitors cannot remove administrators'
);
select ok(
  has_function_privilege('authenticated', 'public.remove_store_admin(text)', 'execute'),
  'signed-in administrators can request administrator removal'
);
select ok(
  not has_function_privilege('anon', 'public.admin_update_order_payment_status(uuid,text,text)', 'execute'),
  'anonymous visitors cannot update payment status'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_update_order_payment_status(uuid,text,text)', 'execute'),
  'signed-in users can call the payment updater, which enforces administrator authorization'
);
select ok(
  not has_function_privilege('anon', 'public.admin_update_order_shipping(uuid,text,text,text)', 'execute'),
  'anonymous visitors cannot update shipping details'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_update_order_shipping(uuid,text,text,text)', 'execute'),
  'signed-in users can call shipping updates, which enforce administrator authorization'
);
select ok(
  not has_function_privilege('anon', 'public.admin_review_payment(uuid,text,text,text)', 'execute'),
  'anonymous visitors cannot review manual payments'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_review_payment(uuid,text,text,text)', 'execute'),
  'signed-in users can call payment review, which enforces administrator authorization'
);
select ok(
  not has_function_privilege('anon', 'public.submit_order_payment_confirmation(uuid,uuid,text,numeric,text)', 'execute'),
  'anonymous visitors cannot submit payment confirmations'
);
select ok(
  has_function_privilege('authenticated', 'public.submit_order_payment_confirmation(uuid,uuid,text,numeric,text)', 'execute'),
  'signed-in customers can submit owner-checked payment confirmations'
);
select ok(
  not has_function_privilege('anon', 'public.create_order_with_payment_method(jsonb,jsonb,uuid,uuid,text)', 'execute'),
  'anonymous visitors cannot call the payment-method checkout wrapper directly'
);
select ok(
  has_function_privilege('service_role', 'public.create_order_with_payment_method(jsonb,jsonb,uuid,uuid,text)', 'execute'),
  'trusted checkout can create orders with a selected payment method'
);
select ok(
  position('p_customer_user_id is null' in lower(pg_get_functiondef('public.create_order_with_payment_method(jsonb,jsonb,uuid,uuid,text)'::regprocedure))) > 0,
  'trusted checkout cannot create an order without an authenticated customer identity'
);
select ok(
  position('ready for dispatch' in lower(pg_get_constraintdef((select oid from pg_constraint where conname = 'orders_fulfilment_status_check' and conrelid = 'public.orders'::regclass)))) > 0,
  'fulfilment constraints allow the ready-for-dispatch stage'
);
select ok(
  position('pending verification' in lower(pg_get_functiondef('public.admin_review_payment(uuid,text,text,text)'::regprocedure))) > 0,
  'manual payment review is restricted to pending verification requests'
);
select ok(
  position('fulfilment_status' in lower(pg_get_functiondef('public.admin_update_order_payment_status(uuid,text,text)'::regprocedure))) = 0
    and position('fulfilment_status' in lower(pg_get_functiondef('public.admin_review_payment(uuid,text,text,text)'::regprocedure))) = 0,
  'payment changes do not mutate fulfilment status'
);
select ok(
  not has_function_privilege('anon', 'public.create_order_with_payment_method(jsonb,jsonb,uuid,uuid,text)', 'execute'),
  'anonymous visitors cannot call the payment-method order function directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.create_order_with_payment_method(jsonb,jsonb,uuid,uuid,text)', 'execute'),
  'customers cannot call the payment-method order function directly'
);
select ok(
  has_function_privilege('service_role', 'public.create_order_with_payment_method(jsonb,jsonb,uuid,uuid,text)', 'execute'),
  'the trusted checkout function can create orders with a selected payment method'
);
select ok(not has_table_privilege('anon', 'public.customer_addresses', 'select'), 'anonymous visitors cannot read customer addresses');
select ok(not has_table_privilege('anon', 'public.customer_wishlist', 'select'), 'anonymous visitors cannot read customer wishlists');
select ok(has_table_privilege('authenticated', 'public.customer_addresses', 'select'), 'authenticated users can query addresses subject to owner RLS');
select ok(has_table_privilege('authenticated', 'public.customer_wishlist', 'select'), 'authenticated users can query wishlists subject to owner RLS');
select ok(not has_function_privilege('anon', 'public.set_customer_default_address(uuid)', 'execute'), 'anonymous visitors cannot change default addresses');
select ok(has_function_privilege('authenticated', 'public.set_customer_default_address(uuid)', 'execute'), 'authenticated users can request their own default address change');
select ok((select position('auth.uid' in coalesce(qual, '')) > 0 from pg_policies where schemaname = 'public' and tablename = 'customer_addresses' and policyname = 'customer_addresses_owner_all'), 'customer address reads and deletes are owner-scoped');
select ok((select position('auth.uid' in coalesce(with_check, '')) > 0 from pg_policies where schemaname = 'public' and tablename = 'customer_addresses' and policyname = 'customer_addresses_owner_all'), 'customer address inserts and updates are owner-scoped');
select ok((select position('auth.uid' in coalesce(qual, '')) > 0 from pg_policies where schemaname = 'public' and tablename = 'customer_wishlist' and policyname = 'customer_wishlist_owner_all'), 'wishlist reads and deletes are owner-scoped');
select ok((select position('auth.uid' in coalesce(with_check, '')) > 0 from pg_policies where schemaname = 'public' and tablename = 'customer_wishlist' and policyname = 'customer_wishlist_owner_all'), 'wishlist inserts and updates are owner-scoped');

insert into public.admin_allowlist (email) values ('admin@example.com'), ('second-admin@example.com'), ('unconfirmed@example.com') on conflict do nothing;
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'unauthorised@example.com', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'admin@example.com', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'unconfirmed@example.com', null, '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do update set email = excluded.email, email_confirmed_at = excluded.email_confirmed_at;

set local role anon;
select ok((select count(*) > 0 from public.categories), 'public visitors can read categories');
select throws_ok($$select id from public.orders limit 1$$, '42501', null, 'public visitors cannot query customer orders');
select throws_ok($$select id from public.customer_addresses limit 1$$, '42501', null, 'public visitors cannot query customer addresses');
select throws_ok($$select id from public.customer_wishlist limit 1$$, '42501', null, 'public visitors cannot query customer wishlists');
select throws_ok($$insert into public.products (sku, name, description, category_id, price_ngn) values ('PUBLIC', 'No', 'No', gen_random_uuid(), 1)$$, '42501', null, 'public visitors cannot create products');
select throws_ok($$select public.admin_update_order_status(gen_random_uuid(), 'Cancelled', 'admin@example.com')$$, '42501', null, 'public visitors cannot update order status');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","email":"unauthorised@example.com"}';
select is((select public.is_current_user_store_admin()), false, 'a non-admin cannot pass the administrator check');
select throws_ok($$select * from public.list_store_admins()$$, '42501', 'Administrator access is required.', 'a non-admin cannot list administrators');
select throws_ok($$select public.remove_store_admin('second-admin@example.com')$$, '42501', 'Administrator access is required.', 'a non-admin cannot remove an administrator');
select throws_ok($$select public.admin_update_order_payment_status(gen_random_uuid(), 'Paid', 'unauthorised@example.com')$$, '42501', 'Administrator access is required.', 'a non-admin cannot mark an order paid');
select is_empty($$select id from public.orders$$, 'signed-in non-admins cannot read customer orders');
select is_empty($$update public.products set price_ngn = 1 returning id$$, 'signed-in non-admins cannot modify product rows');
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","email":"unconfirmed@example.com"}';
select is((select public.is_current_user_store_admin()), false, 'an allowlisted administrator must confirm their email first');
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","email":"admin@example.com"}';
select is((select public.is_current_user_store_admin()), true, 'an allowlisted admin passes the administrator check');
select is((select count(*) from public.list_store_admins()), 3::bigint, 'an admin sees the allowlist entries and no other users');
select throws_ok($$select public.remove_store_admin('admin@example.com')$$, '22023', 'You cannot remove your own administrator access.', 'an admin cannot remove their own access');
select is((select public.remove_store_admin('second-admin@example.com')), true, 'an admin can remove another allowlisted administrator');
select throws_ok($$select public.remove_store_admin('admin@example.com')$$, '23514', 'The last administrator cannot be removed.', 'the last administrator cannot be removed');

rollback;
