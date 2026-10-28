create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient_name text not null check (length(btrim(recipient_name)) between 1 and 120),
  phone text not null check (phone ~ '^\+?[0-9 ()-]{8,20}$'),
  country text not null default 'Nigeria' check (length(btrim(country)) between 1 and 100),
  state text not null check (length(btrim(state)) between 1 and 100),
  city text not null check (length(btrim(city)) between 1 and 100),
  street_address text not null check (length(btrim(street_address)) between 1 and 400),
  additional_directions text not null default '' check (length(additional_directions) <= 400),
  postal_code text not null default '' check (length(postal_code) <= 20),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customer_addresses_one_default_per_user_idx
  on public.customer_addresses (user_id) where is_default;
create index customer_addresses_user_created_at_idx
  on public.customer_addresses (user_id, created_at desc);
create trigger customer_addresses_set_updated_at before update on public.customer_addresses
  for each row execute function public.set_updated_at();

create table public.customer_wishlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);
create index customer_wishlist_user_created_at_idx
  on public.customer_wishlist (user_id, created_at desc);

alter table public.customer_addresses enable row level security;
alter table public.customer_wishlist enable row level security;
revoke all on public.customer_addresses, public.customer_wishlist from anon, authenticated;
grant select, insert, update, delete on public.customer_addresses, public.customer_wishlist to authenticated;

create policy customer_addresses_owner_all on public.customer_addresses
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy customer_wishlist_owner_all on public.customer_wishlist
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create function public.set_customer_default_address(p_address_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  update public.customer_addresses
  set is_default = false
  where user_id = v_user_id and is_default;

  update public.customer_addresses
  set is_default = true
  where id = p_address_id and user_id = v_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Address not found.';
  end if;

  return true;
end;
$$;

revoke all on function public.set_customer_default_address(uuid) from public, anon;
grant execute on function public.set_customer_default_address(uuid) to authenticated;