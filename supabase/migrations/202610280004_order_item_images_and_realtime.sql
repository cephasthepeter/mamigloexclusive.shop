alter table public.order_items
  add column if not exists product_image_url text;

update public.order_items as item
set product_image_url = product.image_url
from public.products as product
where item.product_id = product.id
  and item.product_image_url is null;

create or replace function private.snapshot_order_item_product_image()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.product_image_url is null and new.product_id is not null then
    select product.image_url into new.product_image_url
    from public.products as product
    where product.id = new.product_id;
  end if;
  return new;
end;
$$;

revoke all on function private.snapshot_order_item_product_image() from public, anon, authenticated, service_role;

drop trigger if exists order_items_snapshot_product_image on public.order_items;
create trigger order_items_snapshot_product_image
  before insert on public.order_items
  for each row execute function private.snapshot_order_item_product_image();

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