alter table public.hero_campaigns
  alter column primary_cta_text drop not null,
  alter column primary_cta_url drop not null,
  drop constraint if exists hero_campaigns_primary_cta_text_check,
  drop constraint if exists hero_campaigns_primary_cta_url_check,
  add constraint hero_campaigns_primary_cta_pair_check check (
    (primary_cta_text is null and primary_cta_url is null)
    or (
      primary_cta_text is not null
      and length(btrim(primary_cta_text)) between 1 and 48
      and primary_cta_url is not null
      and primary_cta_url like '/%'
      and primary_cta_url not like '//%'
    )
  );

alter table public.hero_campaign_drafts
  alter column primary_cta_text drop not null,
  alter column primary_cta_text drop default,
  alter column primary_cta_url drop not null,
  alter column primary_cta_url drop default,
  drop constraint if exists hero_campaign_drafts_primary_cta_text_check,
  drop constraint if exists hero_campaign_drafts_primary_cta_url_check,
  add constraint hero_campaign_drafts_primary_cta_pair_check check (
    (primary_cta_text is null and primary_cta_url is null)
    or (
      primary_cta_text is not null
      and length(btrim(primary_cta_text)) between 1 and 48
      and primary_cta_url is not null
      and primary_cta_url like '/%'
      and primary_cta_url not like '//%'
    )
  );