create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated, service_role;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

create table public.site_settings (
  singleton boolean primary key default true check (singleton),
  announcement text not null default 'Welcome to Mamigloexclusive — Elevate Your Style.' check (length(announcement) between 1 and 200),
  delivery_fee_ngn integer not null default 3000 check (delivery_fee_ngn >= 0),
  whatsapp_number text not null default '2348116098015',
  business_phone text not null default '+2349155556750',
  business_email text not null default 'justmamiglo@gmail.com',
  instagram_url text not null default 'https://instagram.com/mamigloexclusive',
  facebook_url text not null default 'https://facebook.com/mamigloexclusive',
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (length(btrim(sku)) between 1 and 64),
  name text not null check (length(btrim(name)) between 1 and 160),
  description text not null check (length(btrim(description)) between 1 and 3000),
  category_id uuid not null references public.categories(id) on update cascade on delete restrict,
  price_ngn bigint not null check (price_ngn between 0 and 100000000),
  sale_price_ngn bigint check (sale_price_ngn between 0 and price_ngn),
  colors text[] not null default '{}',
  sizes text[] not null default '{}',
  stock_quantity integer not null default 0 check (stock_quantity between 0 and 1000000),
  featured boolean not null default false,
  is_published boolean not null default false,
  image_url text not null default '/images/product-placeholder.svg'
    check (image_url like '/images/%' or image_url ~ '^https://'),
  image_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_allowlist (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  created_at timestamptz not null default now()
);

create table private.checkout_rate_limits (
  fingerprint text primary key check (fingerprint ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 2147483647)
);
revoke all on private.checkout_rate_limits from public, anon, authenticated, service_role;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  idempotency_key uuid not null unique,
  customer_user_id uuid references auth.users(id) on delete set null,
  customer_name text not null check (length(customer_name) between 1 and 120),
  customer_phone text not null check (length(customer_phone) between 8 and 20),
  customer_email text,
  delivery_address text not null check (length(delivery_address) between 1 and 400),
  delivery_state text not null check (length(delivery_state) between 1 and 100),
  delivery_city text not null check (length(delivery_city) between 1 and 100),
  delivery_method text not null check (length(delivery_method) between 1 and 100),
  instructions text check (instructions is null or length(instructions) <= 1000),
  subtotal_ngn bigint not null check (subtotal_ngn >= 0),
  delivery_fee_ngn bigint not null check (delivery_fee_ngn >= 0),
  total_ngn bigint not null check (total_ngn = subtotal_ngn + delivery_fee_ngn),
  status text not null default 'Pending' check (status in ('Pending', 'Awaiting Payment', 'Paid', 'Processing', 'Shipped', 'Delivered', 'Cancelled')),
  status_history jsonb not null default '[]'::jsonb check (jsonb_typeof(status_history) = 'array'),
  inventory_released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on update cascade on delete set null,
  product_name text not null,
  quantity integer not null check (quantity between 1 and 20),
  unit_price_ngn bigint not null check (unit_price_ngn >= 0),
  color text,
  size text,
  created_at timestamptz not null default now()
);

create index products_public_catalogue_idx on public.products (category_id, featured desc, name) where is_published;
create index orders_created_at_idx on public.orders (created_at desc);
create index orders_status_created_at_idx on public.orders (status, created_at desc);
create index orders_customer_phone_idx on public.orders (customer_phone);
create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger site_settings_set_updated_at before update on public.site_settings
  for each row execute function public.set_updated_at();
revoke all on function public.set_updated_at() from public, anon, authenticated;

insert into public.categories (name, slug) values
  ('Classic Ties', 'classic-ties'),
  ('Slim Ties', 'slim-ties'),
  ('Skinny Ties', 'skinny-ties'),
  ('Premium and Silk Ties', 'premium-and-silk-ties'),
  ('Patterned Ties', 'patterned-ties'),
  ('Plain Ties', 'plain-ties'),
  ('Wedding Ties', 'wedding-ties'),
  ('Bow Ties', 'bow-ties'),
  ('Self-Tie Bow Ties', 'self-tie-bow-ties'),
  ('Cufflinks', 'cufflinks'),
  ('Lapel Pins and Brooches', 'lapel-pins-and-brooches'),
  ('Pocket Squares', 'pocket-squares'),
  ('''Men''s Socks''', 'mens-socks'),
  ('Shirt Holders', 'shirt-holders'),
  ('Tie and Socks Combos', 'tie-and-socks-combos'),
  ('Flowers and Boutonnieres', 'flowers-and-boutonnieres'),
  ('Cummerbunds', 'cummerbunds'),
  ('Belts', 'belts'),
  ('Wristwatches', 'wristwatches'),
  ('Bags', 'bags'),
  ('Shoes', 'shoes'),
  ('Gift Sets', 'gift-sets')
on conflict (slug) do nothing;

insert into public.site_settings (singleton) values (true)
on conflict (singleton) do nothing;

create function private.is_store_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_allowlist as allowlist
    where allowlist.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function private.is_store_admin() from public;
grant execute on function private.is_store_admin() to anon, authenticated, service_role;

alter table public.categories enable row level security;
alter table public.site_settings enable row level security;
alter table public.products enable row level security;
alter table public.admin_allowlist enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on public.categories, public.site_settings, public.products,
  public.admin_allowlist, public.orders, public.order_items from anon, authenticated;
grant select on public.categories, public.site_settings, public.products to anon, authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;
grant update on public.site_settings to authenticated;
grant select on public.orders, public.order_items to authenticated;
grant all on public.categories, public.site_settings, public.products,
  public.admin_allowlist, public.orders, public.order_items to service_role;

create policy categories_public_read on public.categories
  for select to anon, authenticated using (true);
create policy categories_admin_insert on public.categories
  for insert to authenticated with check ((select private.is_store_admin()));
create policy categories_admin_update on public.categories
  for update to authenticated using ((select private.is_store_admin()))
  with check ((select private.is_store_admin()));
create policy categories_admin_delete on public.categories
  for delete to authenticated using ((select private.is_store_admin()));

create policy settings_public_read on public.site_settings
  for select to anon, authenticated using (singleton);
create policy settings_admin_update on public.site_settings
  for update to authenticated using ((select private.is_store_admin()))
  with check ((select private.is_store_admin()));

create policy products_public_read on public.products
  for select to anon, authenticated using (is_published or (select private.is_store_admin()));
create policy products_admin_insert on public.products
  for insert to authenticated with check ((select private.is_store_admin()));
create policy products_admin_update on public.products
  for update to authenticated using ((select private.is_store_admin()))
  with check ((select private.is_store_admin()));
create policy products_admin_delete on public.products
  for delete to authenticated using ((select private.is_store_admin()));

create policy orders_admin_read on public.orders
  for select to authenticated using ((select private.is_store_admin()));
create policy orders_customer_read on public.orders
  for select to authenticated using (customer_user_id = (select auth.uid()));
create policy order_items_admin_read on public.order_items
  for select to authenticated using ((select private.is_store_admin()));
create policy order_items_customer_read on public.order_items
  for select to authenticated using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.customer_user_id = (select auth.uid())
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy product_images_public_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'product-images');

create function public.create_order(
  p_customer jsonb,
  p_items jsonb,
  p_idempotency_key uuid,
  p_customer_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_reference text;
  v_product record;
  v_line jsonb;
  v_group record;
  v_color text;
  v_size text;
  v_subtotal bigint := 0;
  v_delivery_fee integer;
  v_now timestamptz := now();
  v_order public.orders%rowtype;
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'A valid idempotency key is required.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select id into v_order_id from public.orders where idempotency_key = p_idempotency_key;

  if v_order_id is null then
    if p_customer is null or jsonb_typeof(p_customer) <> 'object'
      or length(btrim(coalesce(p_customer ->> 'fullName', ''))) not between 1 and 120
      or coalesce(p_customer ->> 'phone', '') !~ '^\+?[0-9 ()-]{8,20}$'
      or length(btrim(coalesce(p_customer ->> 'address', ''))) not between 1 and 400
      or length(btrim(coalesce(p_customer ->> 'state', ''))) not between 1 and 100
      or length(btrim(coalesce(p_customer ->> 'city', ''))) not between 1 and 100
      or length(btrim(coalesce(p_customer ->> 'deliveryMethod', ''))) not between 1 and 100
      or length(coalesce(p_customer ->> 'instructions', '')) > 1000
      or (nullif(btrim(coalesce(p_customer ->> 'email', '')), '') is not null
        and (length(p_customer ->> 'email') > 254 or (p_customer ->> 'email') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) then
      raise exception 'Please check the customer and delivery details.' using errcode = '22023';
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
      raise exception 'An order must contain between 1 and 30 item lines.' using errcode = '22023';
    end if;

    for v_line in select entry.value from jsonb_array_elements(p_items) as entry(value)
    loop
      if jsonb_typeof(v_line) <> 'object'
        or coalesce(v_line ->> 'productId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or coalesce(v_line ->> 'quantity', '') !~ '^[0-9]+$'
        or (v_line ->> 'quantity')::integer not between 1 and 20 then
        raise exception 'An order item is invalid.' using errcode = '22023';
      end if;
    end loop;

    for v_group in
      select (entry.value ->> 'productId')::uuid as product_id,
        sum((entry.value ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) as entry(value)
      group by (entry.value ->> 'productId')::uuid
      order by (entry.value ->> 'productId')::uuid
    loop
      select * into v_product from public.products
        where id = v_group.product_id and is_published
        for update;
      if not found or v_product.stock_quantity < v_group.quantity then
        raise exception 'One or more selected items are unavailable or out of stock.' using errcode = 'P0001';
      end if;
      update public.products set stock_quantity = stock_quantity - v_group.quantity, updated_at = v_now
        where id = v_group.product_id;
    end loop;

    for v_line in select entry.value from jsonb_array_elements(p_items) as entry(value)
    loop
      select * into v_product from public.products
        where id = (v_line ->> 'productId')::uuid and is_published;
      v_color := nullif(btrim(coalesce(v_line ->> 'color', '')), '');
      v_size := nullif(btrim(coalesce(v_line ->> 'size', '')), '');
      if v_color is not null and not (v_color = any(v_product.colors)) then
        raise exception 'A selected product colour is unavailable.' using errcode = '22023';
      end if;
      if v_size is not null and not (v_size = any(v_product.sizes)) then
        raise exception 'A selected product size is unavailable.' using errcode = '22023';
      end if;
      v_subtotal := v_subtotal + coalesce(v_product.sale_price_ngn, v_product.price_ngn) * (v_line ->> 'quantity')::integer;
    end loop;

    select delivery_fee_ngn into v_delivery_fee from public.site_settings where singleton;
    v_delivery_fee := coalesce(v_delivery_fee, 3000);
    v_order_id := gen_random_uuid();
    v_reference := 'MG-' || to_char(v_now at time zone 'utc', 'YYYYMMDD') || '-' || upper(substr(replace(v_order_id::text, '-', ''), 1, 12));
    insert into public.orders (
      id, reference, idempotency_key, customer_user_id, customer_name, customer_phone, customer_email,
      delivery_address, delivery_state, delivery_city, delivery_method, instructions,
      subtotal_ngn, delivery_fee_ngn, total_ngn, status, status_history, created_at, updated_at
    ) values (
      v_order_id, v_reference, p_idempotency_key, p_customer_user_id,
      btrim(p_customer ->> 'fullName'), btrim(p_customer ->> 'phone'),
      nullif(btrim(coalesce(p_customer ->> 'email', '')), ''),
      btrim(p_customer ->> 'address'), btrim(p_customer ->> 'state'), btrim(p_customer ->> 'city'),
      btrim(p_customer ->> 'deliveryMethod'), nullif(btrim(coalesce(p_customer ->> 'instructions', '')), ''),
      v_subtotal, v_delivery_fee, v_subtotal + v_delivery_fee, 'Pending',
      jsonb_build_array(jsonb_build_object('status', 'Pending', 'at', v_now, 'changedBy', 'customer')),
      v_now, v_now
    );

    for v_line in select entry.value from jsonb_array_elements(p_items) as entry(value)
    loop
      select * into v_product from public.products where id = (v_line ->> 'productId')::uuid;
      v_color := nullif(btrim(coalesce(v_line ->> 'color', '')), '');
      v_size := nullif(btrim(coalesce(v_line ->> 'size', '')), '');
      insert into public.order_items (order_id, product_id, product_name, quantity, unit_price_ngn, color, size)
      values (
        v_order_id, v_product.id, v_product.name, (v_line ->> 'quantity')::integer,
        coalesce(v_product.sale_price_ngn, v_product.price_ngn), v_color, v_size
      );
    end loop;
  end if;

  select * into v_order from public.orders where id = v_order_id;
  select jsonb_build_object(
    'id', v_order.id,
    'reference', v_order.reference,
    'customer', jsonb_build_object(
      'fullName', v_order.customer_name, 'phone', v_order.customer_phone,
      'email', v_order.customer_email, 'address', v_order.delivery_address,
      'state', v_order.delivery_state, 'city', v_order.delivery_city,
      'deliveryMethod', v_order.delivery_method, 'instructions', v_order.instructions
    ),
    'lines', coalesce(jsonb_agg(jsonb_build_object(
      'productId', i.product_id, 'name', i.product_name, 'quantity', i.quantity,
      'unitPriceNGN', i.unit_price_ngn, 'color', i.color, 'size', i.size
    ) order by i.created_at, i.id) filter (where i.id is not null), '[]'::jsonb),
    'subtotalNGN', v_order.subtotal_ngn,
    'deliveryFeeNGN', v_order.delivery_fee_ngn,
    'totalNGN', v_order.total_ngn,
    'status', v_order.status,
    'statusHistory', v_order.status_history,
    'createdAt', v_order.created_at,
    'updatedAt', v_order.updated_at,
    'inventoryReleasedAt', v_order.inventory_released_at
  ) into v_result
  from public.order_items as i
  where i.order_id = v_order.id;
  return v_result;
end;
$$;

create function public.admin_update_order_status(
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
  if p_status not in ('Pending', 'Awaiting Payment', 'Paid', 'Processing', 'Shipped', 'Delivered', 'Cancelled') then
    raise exception 'Choose a valid order status.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return false; end if;
  if v_order.status = p_status then return true; end if;
  v_transition_allowed := case v_order.status
    when 'Pending' then p_status in ('Awaiting Payment', 'Paid', 'Processing', 'Cancelled')
    when 'Awaiting Payment' then p_status in ('Paid', 'Processing', 'Cancelled')
    when 'Paid' then p_status in ('Processing', 'Cancelled')
    when 'Processing' then p_status in ('Shipped', 'Cancelled')
    when 'Shipped' then p_status = 'Delivered'
    else false
  end;
  if not v_transition_allowed then
    raise exception 'This order status transition is not allowed.' using errcode = 'P0001';
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
    updated_at = v_now,
    inventory_released_at = case when p_status = 'Cancelled' then coalesce(inventory_released_at, v_now) else inventory_released_at end,
    status_history = status_history || jsonb_build_array(jsonb_build_object(
      'status', p_status, 'at', v_now, 'changedBy', lower(btrim(p_actor_email))
    ))
  where id = v_order.id;
  return true;
end;
$$;

create function public.consume_checkout_rate_limit(p_fingerprint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_count integer;
  v_now timestamptz := now();
begin
  if coalesce(p_fingerprint, '') !~ '^[a-f0-9]{64}$' then return false; end if;
  insert into private.checkout_rate_limits (fingerprint, window_started_at, request_count)
  values (p_fingerprint, v_now, 1)
  on conflict (fingerprint) do update set
    window_started_at = case
      when private.checkout_rate_limits.window_started_at <= v_now - interval '1 minute' then v_now
      else private.checkout_rate_limits.window_started_at
    end,
    request_count = case

    create function public.create_order_with_customer(
      p_customer jsonb,
      p_items jsonb,
      p_idempotency_key uuid,
      p_customer_user_id uuid default null
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $$
      when private.checkout_rate_limits.window_started_at <= v_now - interval '1 minute' then 1
      return public.create_order(p_customer, p_items, p_idempotency_key, p_customer_user_id);
    end;
    $$;
      else least(private.checkout_rate_limits.request_count + 1, 2147483647)
    end
  returning request_count into v_request_count;
  return v_request_count <= 5;
end;
$$;

revoke all on function public.create_order(jsonb, jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_order_with_customer(jsonb, jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_update_order_status(uuid, text, text) from public, anon, authenticated;
revoke all on function public.consume_checkout_rate_limit(text) from public, anon, authenticated;
grant execute on function public.create_order(jsonb, jsonb, uuid, uuid) to service_role;
grant execute on function public.create_order_with_customer(jsonb, jsonb, uuid, uuid) to service_role;
grant execute on function public.admin_update_order_status(uuid, text, text) to authenticated;
grant execute on function public.consume_checkout_rate_limit(text) to service_role;
