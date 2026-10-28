create table public.hero_campaigns (
  id uuid primary key,
  name text not null check (length(btrim(name)) between 1 and 120),
  title text not null check (length(title) <= 180),
  description text not null default '' check (length(description) <= 700),
  video_path text not null check (video_path ~ '^[0-9a-f-]+\.(mp4|webm)$'),
  poster_path text check (poster_path is null or poster_path ~ '^[0-9a-f-]+\.(jpg|jpeg|png|webp)$'),
  mobile_video_path text check (mobile_video_path is null or mobile_video_path ~ '^[0-9a-f-]+\.(mp4|webm)$'),
  primary_cta_text text not null check (length(primary_cta_text) between 1 and 48),
  primary_cta_url text not null check (primary_cta_url like '/%' and primary_cta_url not like '//%'),
  secondary_cta_text text check (secondary_cta_text is null or length(secondary_cta_text) <= 48),
  secondary_cta_url text check (secondary_cta_url is null or (secondary_cta_url like '/%' and secondary_cta_url not like '//%')),
  display_order integer not null check (display_order between 0 and 1000),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 5 and 120),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.hero_campaign_drafts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  title text not null default '' check (length(title) <= 180),
  description text not null default '' check (length(description) <= 700),
  video_path text not null check (video_path ~ '^[0-9a-f-]+\.(mp4|webm)$'),
  poster_path text check (poster_path is null or poster_path ~ '^[0-9a-f-]+\.(jpg|jpeg|png|webp)$'),
  mobile_video_path text check (mobile_video_path is null or mobile_video_path ~ '^[0-9a-f-]+\.(mp4|webm)$'),
  primary_cta_text text not null default 'Explore the Collection' check (length(primary_cta_text) between 1 and 48),
  primary_cta_url text not null default '/shop' check (primary_cta_url like '/%' and primary_cta_url not like '//%'),
  secondary_cta_text text check (secondary_cta_text is null or length(secondary_cta_text) <= 48),
  secondary_cta_url text check (secondary_cta_url is null or (secondary_cta_url like '/%' and secondary_cta_url not like '//%')),
  display_order integer not null default 0 check (display_order between 0 and 1000),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 5 and 120),
  is_active boolean not null default true,
  is_published boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.hero_settings (
  singleton boolean primary key default true check (singleton),
  slideshow_enabled boolean not null default true,
  default_duration_seconds integer not null default 12 check (default_duration_seconds between 5 and 120),
  crossfade_ms integer not null default 1000 check (crossfade_ms between 800 and 1200),
  default_heading text not null default 'Elevate Your Style. Define Your Presence.' check (length(default_heading) between 1 and 180),
  default_description text not null default 'Discover refined men''s accessories designed to complete your look, from everyday elegance to unforgettable occasions.' check (length(default_description) <= 700),
  primary_cta_text text not null default 'Shop Collection' check (length(primary_cta_text) between 1 and 48),
  primary_cta_url text not null default '/shop' check (primary_cta_url like '/%' and primary_cta_url not like '//%'),
  secondary_cta_text text not null default 'Explore New Arrivals' check (length(secondary_cta_text) between 1 and 48),
  secondary_cta_url text not null default '/shop' check (secondary_cta_url like '/%' and secondary_cta_url not like '//%'),
  fallback_poster_path text check (fallback_poster_path is null or fallback_poster_path ~ '^[0-9a-f-]+\.(jpg|jpeg|png|webp)$'),
  updated_at timestamptz not null default now()
);

create table public.hero_settings_drafts (
  singleton boolean primary key default true check (singleton),
  slideshow_enabled boolean not null default true,
  default_duration_seconds integer not null default 12 check (default_duration_seconds between 5 and 120),
  crossfade_ms integer not null default 1000 check (crossfade_ms between 800 and 1200),
  default_heading text not null default 'Elevate Your Style. Define Your Presence.' check (length(default_heading) between 1 and 180),
  default_description text not null default 'Discover refined men''s accessories designed to complete your look, from everyday elegance to unforgettable occasions.' check (length(default_description) <= 700),
  primary_cta_text text not null default 'Shop Collection' check (length(primary_cta_text) between 1 and 48),
  primary_cta_url text not null default '/shop' check (primary_cta_url like '/%' and primary_cta_url not like '//%'),
  secondary_cta_text text not null default 'Explore New Arrivals' check (length(secondary_cta_text) between 1 and 48),
  secondary_cta_url text not null default '/shop' check (secondary_cta_url like '/%' and secondary_cta_url not like '//%'),
  fallback_poster_path text check (fallback_poster_path is null or fallback_poster_path ~ '^[0-9a-f-]+\.(jpg|jpeg|png|webp)$'),
  updated_at timestamptz not null default now()
);

create index hero_campaigns_order_idx on public.hero_campaigns (display_order, starts_at, ends_at);
create index hero_campaign_drafts_order_idx on public.hero_campaign_drafts (display_order, created_at);

create trigger hero_campaigns_set_updated_at before update on public.hero_campaigns
  for each row execute function public.set_updated_at();
create trigger hero_campaign_drafts_set_updated_at before update on public.hero_campaign_drafts
  for each row execute function public.set_updated_at();
create trigger hero_settings_set_updated_at before update on public.hero_settings
  for each row execute function public.set_updated_at();
create trigger hero_settings_drafts_set_updated_at before update on public.hero_settings_drafts
  for each row execute function public.set_updated_at();

alter table public.hero_campaigns enable row level security;
alter table public.hero_campaign_drafts enable row level security;
alter table public.hero_settings enable row level security;
alter table public.hero_settings_drafts enable row level security;

revoke all on public.hero_campaigns, public.hero_campaign_drafts, public.hero_settings, public.hero_settings_drafts from anon, authenticated;
grant select on public.hero_campaigns, public.hero_settings to anon, authenticated;
grant select, insert, update, delete on public.hero_campaign_drafts, public.hero_settings_drafts to authenticated;
grant all on public.hero_campaigns, public.hero_campaign_drafts, public.hero_settings, public.hero_settings_drafts to service_role;

create policy hero_campaigns_public_read on public.hero_campaigns
  for select to anon, authenticated using (
    coalesce(starts_at <= now(), true) and coalesce(ends_at > now(), true)
  );
create policy hero_campaigns_admin_read on public.hero_campaigns
  for select to authenticated using ((select private.is_store_admin()));
create policy hero_campaign_drafts_admin_all on public.hero_campaign_drafts
  for all to authenticated using ((select private.is_store_admin()))
  with check ((select private.is_store_admin()));
create policy hero_settings_public_read on public.hero_settings
  for select to anon, authenticated using (singleton);
create policy hero_settings_admin_read on public.hero_settings
  for select to authenticated using ((select private.is_store_admin()));
create policy hero_settings_drafts_admin_all on public.hero_settings_drafts
  for all to authenticated using ((select private.is_store_admin()))
  with check ((select private.is_store_admin()));

insert into public.hero_settings (singleton) values (true) on conflict (singleton) do nothing;
insert into public.hero_settings_drafts (singleton) values (true) on conflict (singleton) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hero-media', 'hero-media', false, 52428800, array['video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = excluded.allowed_mime_types;

create policy hero_media_admin_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'hero-media' and (select private.is_store_admin())
  );
create policy hero_media_admin_update on storage.objects
  for update to authenticated using (
    bucket_id = 'hero-media' and (select private.is_store_admin())
  ) with check (
    bucket_id = 'hero-media' and (select private.is_store_admin())
  );
create policy hero_media_admin_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'hero-media' and (select private.is_store_admin())
  );
create policy hero_media_admin_read on storage.objects
  for select to authenticated using (
    bucket_id = 'hero-media' and (select private.is_store_admin())
  );
create policy hero_media_public_read_published on storage.objects
  for select to anon, authenticated using (
    bucket_id = 'hero-media' and exists (
      select 1 from public.hero_campaigns as campaign
      where coalesce(campaign.starts_at <= now(), true)
        and coalesce(campaign.ends_at > now(), true)
        and storage.objects.name in (campaign.video_path, campaign.poster_path, campaign.mobile_video_path)
      union all
      select 1 from public.hero_settings as settings
      where settings.fallback_poster_path = storage.objects.name
    )
  );

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
    primary_cta_text, primary_cta_url, secondary_cta_text, secondary_cta_url,
    display_order, duration_seconds, starts_at, ends_at
  )
  select id, name, title, description, video_path, poster_path, mobile_video_path,
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
      fallback_poster_path = draft.fallback_poster_path
  from public.hero_settings_drafts as draft
  where published.singleton and draft.singleton;

  return true;
end;
$$;

revoke all on function public.admin_publish_hero_content() from public, anon;
grant execute on function public.admin_publish_hero_content() to authenticated;
