drop policy if exists hero_campaigns_admin_read on public.hero_campaigns;

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
