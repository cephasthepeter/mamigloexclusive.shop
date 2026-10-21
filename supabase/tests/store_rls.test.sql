begin;
select plan(25);

select ok(
  not has_table_privilege('anon', 'public.orders', 'select'),
  'anonymous visitors cannot read customer orders'
);
select ok(
  not has_table_privilege('anon', 'public.order_items', 'select'),
  'anonymous visitors cannot read order items'
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

insert into public.admin_allowlist (email) values ('admin@example.com'), ('second-admin@example.com') on conflict do nothing;

set local role anon;
select ok((select count(*) > 0 from public.categories), 'public visitors can read categories');
select throws_ok($$select id from public.orders limit 1$$, '42501', null, 'public visitors cannot query customer orders');
select throws_ok($$insert into public.products (sku, name, description, category_id, price_ngn) values ('PUBLIC', 'No', 'No', gen_random_uuid(), 1)$$, '42501', null, 'public visitors cannot create products');
select throws_ok($$select public.admin_update_order_status(gen_random_uuid(), 'Cancelled', 'admin@example.com')$$, '42501', null, 'public visitors cannot update order status');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","email":"unauthorised@example.com"}';
select is((select public.is_current_user_store_admin()), false, 'a non-admin cannot pass the administrator check');
select throws_ok($$select * from public.list_store_admins()$$, '42501', 'Administrator access is required.', 'a non-admin cannot list administrators');
select throws_ok($$select public.remove_store_admin('second-admin@example.com')$$, '42501', 'Administrator access is required.', 'a non-admin cannot remove an administrator');
select is_empty($$select id from public.orders$$, 'signed-in non-admins cannot read customer orders');
select is_empty($$update public.products set price_ngn = 1 returning id$$, 'signed-in non-admins cannot modify product rows');
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","email":"admin@example.com"}';
select is((select public.is_current_user_store_admin()), true, 'an allowlisted admin passes the administrator check');
select is((select count(*) from public.list_store_admins()), 2::bigint, 'an admin sees the allowlist entries and no other users');
select throws_ok($$select public.remove_store_admin('admin@example.com')$$, '22023', 'You cannot remove your own administrator access.', 'an admin cannot remove their own access');
select is((select public.remove_store_admin('second-admin@example.com')), true, 'an admin can remove another allowlisted administrator');
select throws_ok($$select public.remove_store_admin('admin@example.com')$$, '23514', 'The last administrator cannot be removed.', 'the last administrator cannot be removed');

rollback;
