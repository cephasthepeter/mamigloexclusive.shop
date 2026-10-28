create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on update cascade on delete set null,
  hero_campaign_id uuid references public.hero_campaign_drafts(id) on update cascade on delete set null,
  journal_article_id uuid references public.journal_articles(id) on update cascade on delete set null,
  media_type text not null check (media_type in ('image', 'video')),
  cloudinary_public_id text not null unique check (length(btrim(cloudinary_public_id)) between 1 and 255),
  secure_url text not null check (secure_url like 'https://res.cloudinary.com/%'),
  folder text not null check (folder in ('mamiglo/products', 'mamiglo/hero', 'mamiglo/journal', 'mamiglo/profiles')),
  resource_type text not null check (resource_type in ('image', 'video')),
  format text not null check (length(format) between 1 and 16),
  width integer check (width is null or width between 1 and 100000),
  height integer check (height is null or height between 1 and 100000),
  duration_seconds numeric(10, 3) check (duration_seconds is null or duration_seconds >= 0),
  alt_text text not null default '' check (length(alt_text) <= 250),
  display_order integer not null default 0 check (display_order between 0 and 1000),
  is_active boolean not null default true,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint media_assets_owner_check check (num_nonnulls(product_id, hero_campaign_id, journal_article_id) <= 1),
  constraint media_assets_type_check check (media_type = resource_type)
);

create index if not exists media_assets_product_order_idx
  on public.media_assets (product_id, display_order, created_at)
  where product_id is not null;
create index if not exists media_assets_hero_order_idx
  on public.media_assets (hero_campaign_id, display_order, created_at)
  where hero_campaign_id is not null;
create index if not exists media_assets_uploader_idx
  on public.media_assets (uploaded_by, created_at desc);
create index if not exists media_assets_journal_order_idx
  on public.media_assets (journal_article_id, display_order, created_at)
  where journal_article_id is not null;

alter table public.media_assets enable row level security;
revoke all on public.media_assets from public, anon, authenticated;
grant select, insert, update, delete on public.media_assets to authenticated;
grant select on public.media_assets to anon;
grant all on public.media_assets to service_role;

drop policy if exists media_assets_admin_select on public.media_assets;
drop policy if exists media_assets_admin_insert on public.media_assets;
drop policy if exists media_assets_admin_update on public.media_assets;
drop policy if exists media_assets_admin_delete on public.media_assets;
drop policy if exists media_assets_public_product_read on public.media_assets;
create policy media_assets_admin_select on public.media_assets
  for select to authenticated using ((select private.is_store_admin()));
create policy media_assets_admin_insert on public.media_assets
  for insert to authenticated with check ((select private.is_store_admin()));
create policy media_assets_admin_update on public.media_assets
  for update to authenticated using ((select private.is_store_admin()))
  with check ((select private.is_store_admin()));
create policy media_assets_admin_delete on public.media_assets
  for delete to authenticated using ((select private.is_store_admin()));
create policy media_assets_public_product_read on public.media_assets
  for select to anon, authenticated using (
    is_active and exists (
      select 1 from public.products
      where products.id = media_assets.product_id and products.is_published
    )
  );

alter table public.hero_campaigns alter column video_path drop not null;
alter table public.hero_campaign_drafts alter column video_path drop not null;

alter table public.hero_campaigns
  add column if not exists video_public_id text,
  add column if not exists video_url text,
  add column if not exists poster_public_id text,
  add column if not exists poster_url text,
  add column if not exists poster_alt_text text not null default '',
  add column if not exists mobile_video_public_id text,
  add column if not exists mobile_video_url text;
alter table public.hero_campaign_drafts
  add column if not exists video_public_id text,
  add column if not exists video_url text,
  add column if not exists poster_public_id text,
  add column if not exists poster_url text,
  add column if not exists poster_alt_text text not null default '',
  add column if not exists mobile_video_public_id text,
  add column if not exists mobile_video_url text;
alter table public.hero_settings
  add column if not exists fallback_poster_public_id text,
  add column if not exists fallback_poster_url text,
  add column if not exists fallback_poster_alt_text text not null default '';
alter table public.hero_settings_drafts
  add column if not exists fallback_poster_public_id text,
  add column if not exists fallback_poster_url text,
  add column if not exists fallback_poster_alt_text text not null default '';

create or replace function public.admin_publish_hero_content()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_store_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  delete from public.hero_campaigns;
  insert into public.hero_campaigns (
    id, name, title, description, video_path, poster_path, mobile_video_path,
    video_public_id, video_url, poster_public_id, poster_url, poster_alt_text,
    mobile_video_public_id, mobile_video_url,
    primary_cta_text, primary_cta_url, secondary_cta_text, secondary_cta_url,
    display_order, duration_seconds, starts_at, ends_at
  )
  select id, name, title, description, video_path, poster_path, mobile_video_path,
    video_public_id, video_url, poster_public_id, poster_url, poster_alt_text,
    mobile_video_public_id, mobile_video_url,
    primary_cta_text, primary_cta_url, secondary_cta_text, secondary_cta_url,
    display_order, duration_seconds, starts_at, ends_at
  from public.hero_campaign_drafts
  where is_published and is_active
  order by display_order, created_at;

  update public.hero_settings as published
  set slideshow_enabled = draft.slideshow_enabled,
      default_duration_seconds = draft.default_duration_seconds,
      crossfade_ms = draft.crossfade_ms,
      default_heading = draft.default_heading,
      default_description = draft.default_description,
      primary_cta_text = draft.primary_cta_text,
      primary_cta_url = draft.primary_cta_url,
      secondary_cta_text = draft.secondary_cta_text,
      secondary_cta_url = draft.secondary_cta_url,
      fallback_poster_path = draft.fallback_poster_path,
      fallback_poster_public_id = draft.fallback_poster_public_id,
      fallback_poster_url = draft.fallback_poster_url,
      fallback_poster_alt_text = draft.fallback_poster_alt_text
  from public.hero_settings_drafts as draft
  where published.singleton and draft.singleton;

  return true;
end;
$$;

revoke all on function public.admin_publish_hero_content() from public, anon;
grant execute on function public.admin_publish_hero_content() to authenticated;