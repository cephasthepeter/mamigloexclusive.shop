create table public.journal_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

create table public.journal_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 180),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  excerpt text not null check (length(btrim(excerpt)) between 1 and 500),
  content text not null default '' check (length(content) <= 50000),
  cover_image_url text not null default '/images/product-placeholder.svg'
    check (cover_image_url like '/images/%' or cover_image_url ~ '^https://'),
  cover_image_alt text not null default '' check (length(cover_image_alt) <= 250),
  category_id uuid not null references public.journal_categories(id) on update cascade on delete restrict,
  author text not null default 'Mamigloexclusive Editorial' check (length(btrim(author)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  is_featured boolean not null default false,
  seo_title text check (seo_title is null or length(seo_title) <= 180),
  seo_description text check (seo_description is null or length(seo_description) <= 320),
  recommended_product_ids uuid[] not null default '{}'
    check (cardinality(recommended_product_ids) <= 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_article_publication_date_check check (
    (status = 'published' and published_at is not null)
    or (status = 'draft' and published_at is null)
  )
);

create table public.journal_subscribers (
  email text primary key check (
    email = lower(btrim(email))
    and length(email) between 6 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  created_at timestamptz not null default now()
);

create index journal_articles_publication_idx
  on public.journal_articles (published_at desc, created_at desc)
  where status = 'published';
create index journal_articles_category_idx
  on public.journal_articles (category_id, published_at desc)
  where status = 'published';

create trigger journal_articles_set_updated_at before update on public.journal_articles
  for each row execute function public.set_updated_at();

alter table public.journal_categories enable row level security;
alter table public.journal_articles enable row level security;
alter table public.journal_subscribers enable row level security;

revoke all on public.journal_categories, public.journal_articles, public.journal_subscribers from anon, authenticated;
grant select on public.journal_categories, public.journal_articles to anon, authenticated;
grant insert, update, delete on public.journal_categories, public.journal_articles to authenticated;
grant all on public.journal_categories, public.journal_articles, public.journal_subscribers to service_role;

create policy journal_categories_public_read on public.journal_categories
  for select to anon, authenticated using (true);
create policy journal_categories_admin_insert on public.journal_categories
  for insert to authenticated with check ((select private.is_store_admin()));
create policy journal_categories_admin_update on public.journal_categories
  for update to authenticated using ((select private.is_store_admin()))
  with check ((select private.is_store_admin()));
create policy journal_categories_admin_delete on public.journal_categories
  for delete to authenticated using ((select private.is_store_admin()));

create policy journal_articles_public_read on public.journal_articles
  for select to anon, authenticated
  using (status = 'published' or (select private.is_store_admin()));
create policy journal_articles_admin_insert on public.journal_articles
  for insert to authenticated with check ((select private.is_store_admin()));
create policy journal_articles_admin_update on public.journal_articles
  for update to authenticated using ((select private.is_store_admin()))
  with check ((select private.is_store_admin()));
create policy journal_articles_admin_delete on public.journal_articles
  for delete to authenticated using ((select private.is_store_admin()));

revoke all on public.journal_subscribers from public, anon, authenticated;

create or replace function public.subscribe_to_journal(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
begin
  if length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  insert into public.journal_subscribers (email)
  values (normalized_email)
  on conflict (email) do nothing;

  if found then
    return 'subscribed';
  end if;
  return 'already_subscribed';
end;
$$;

revoke all on function public.subscribe_to_journal(text) from public;
grant execute on function public.subscribe_to_journal(text) to anon, authenticated;

insert into public.journal_categories (name, slug) values
  ('Style & Grooming', 'style-grooming'),
  ('The Gentleman''s Guide', 'the-gentlemans-guide'),
  ('Wedding & Groom', 'wedding-groom'),
  ('Accessories & Details', 'accessories-details'),
  ('Gift Guides', 'gift-guides'),
  ('Fashion & Trends', 'fashion-trends')
on conflict (slug) do nothing;

insert into public.journal_articles (
  title, slug, excerpt, content, cover_image_url, cover_image_alt, category_id,
  author, status, seo_title, seo_description
)
select seed.title, seed.slug, seed.excerpt, seed.content, seed.cover_image_url,
  seed.cover_image_alt, category.id, 'Mamigloexclusive Editorial', 'draft', seed.seo_title, seed.seo_description
from (values
  (
    'How to Choose the Perfect Tie for Every Occasion',
    'choose-the-perfect-tie-for-every-occasion',
    'A considered tie begins with the occasion, then finds its place beside your shirt, suit and own sense of style.',
    $$## Start with the occasion

A tie for a weekday meeting does not need the same presence as one for a wedding. For the office, a restrained solid or small pattern is easy to wear and works with the suits already in your wardrobe. For celebrations, richer colour and more expressive pattern can feel right, provided the rest of the outfit gives it room.

## Bring the outfit together

Begin with the shirt and suit, not the tie alone. A plain shirt gives a patterned tie space to speak; a patterned shirt is usually easier with a solid tie or a quiet texture. Keep the scale of patterns varied so they complement rather than compete.

## Finish with proportion

The tie should sit comfortably against your lapels, and its tip should meet the top of your belt buckle. Choose a fabric and knot that suit the collar. When in doubt, a well-made silk tie in a colour you wear often will earn its place through versatility.$$,
    '/images/product-placeholder.svg', 'A refined tie chosen to complement a tailored outfit', 'style-grooming',
    'Choose a Tie for Every Occasion | The Mamigloexclusive Journal',
    'Learn how to choose a tie by occasion, colour, pattern, fabric and proportion.'
  ),
  (
    'Seven Accessories Every Gentleman Should Own',
    'seven-accessories-every-gentleman-should-own',
    'Build a useful accessories wardrobe around pieces that solve real dressing needs and work with what you already own.',
    $$## Build from the pieces you wear

A thoughtful accessories wardrobe is not a checklist of things to buy. It is a small collection of useful details that help your existing clothes work harder. Start with the occasions you dress for most often and choose quality, comfort and versatility over quantity.

## Seven useful starting points

A classic tie, a bow tie for formal celebrations, a pocket square, a pair of cufflinks, a restrained lapel pin, well-chosen socks and a reliable belt cover many everyday and special-occasion needs. Choose colours that connect naturally with your shirts, suits and shoes rather than buying each piece in isolation.

## Let personal style lead

These are starting points, not rules. If your work is relaxed, a pocket square may be more useful than cufflinks. If weddings fill your calendar, a versatile formal tie deserves extra attention. Keep a short list of gaps in your wardrobe and fill them deliberately.$$,
    '/images/product-placeholder.svg', 'A collection of considered men''s accessories', 'the-gentlemans-guide',
    'Seven Accessories to Build a Useful Wardrobe',
    'A practical guide to seven versatile men''s accessories and how to choose them.'
  ),
  (
    'How to Coordinate Ties and Pocket Squares Without Overdoing It',
    'coordinate-ties-and-pocket-squares',
    'A pocket square and tie should feel related, not identical. Use colour, scale and texture to create a balanced pairing.',
    $$## Avoid the matching set effect

A tie and pocket square bought in an identical fabric can make an outfit feel assembled rather than considered. Instead, choose one shared colour and let the pattern or texture differ. A navy tie can sit comfortably beside a pocket square with a small navy detail, even when the rest of the square uses other colours.

## Balance scale and texture

Pair a large tie pattern with a smaller pocket-square motif, or choose a solid square when the tie already carries strong pattern. Smooth silk and textured linen can work well together because their finishes create contrast without adding another competing print.

## Fold with the occasion in mind

A simple straight fold is composed for business and formal settings. A softer puff can feel relaxed at a celebration. Let the pocket square show naturally from the pocket; it should complement the outfit, not dominate it.$$,
    '/images/product-placeholder.svg', 'A tie and pocket square coordinated through colour and texture', 'accessories-details',
    'How to Coordinate a Tie and Pocket Square',
    'Coordinate a tie and pocket square through shared colour, varied pattern and thoughtful texture.'
  ),
  (
    'The Complete Groom''s Guide to Wedding Accessories',
    'grooms-guide-to-wedding-accessories',
    'Plan the finishing details around the suit, setting and wedding party so the whole look feels cohesive and personal.',
    $$## Begin with the suit and setting

Choose accessories after the suit, shirt and venue direction are clear. A garden celebration may invite softer colour and texture; an evening ceremony can call for a more formal finish. The goal is not to make every detail match, but to give each choice a reason to belong.

## Choose a small, connected palette

Select one or two colours from the wedding palette and use them with restraint. A tie or bow tie can carry the principal colour, while the pocket square, boutonniere or socks add quieter echoes. Keep metals consistent when selecting cufflinks and other hardware.

## Coordinate the wedding party

The groom can share a colour story with the groomsmen without wearing an identical combination. Give the group one common element, such as a tie colour, then allow shirt, pocket-square or boutonniere details to vary subtly. Confirm comfort and fit before the day so no accessory becomes a last-minute distraction.$$,
    '/images/product-placeholder.svg', 'Wedding accessories arranged for a groom''s outfit', 'wedding-groom',
    'The Groom''s Guide to Wedding Accessories',
    'Plan wedding ties, pocket squares, cufflinks and boutonniere details around your suit and setting.'
  ),
  (
    'Bow Ties vs Neckties: Which Should You Choose?',
    'bow-ties-vs-neckties',
    'Both have a place in a modern wardrobe. Let the dress code, collar and mood of the occasion guide your choice.',
    $$## Read the dress code first

Black tie traditionally calls for a black bow tie, while many other formal invitations leave room for a necktie. For work and everyday tailoring, a necktie is often the familiar choice. A bow tie can be equally polished when it suits the setting and feels natural to you.

## Consider your collar and proportions

A bow tie works best when its width feels balanced with your face and collar. A necktie should sit comfortably within the lapels and reach the belt line. Try each option with the complete outfit rather than judging it alone.

## Choose the one you will wear with ease

Personal comfort matters. If you enjoy a bow tie, wear it with confidence; if a necktie feels more like you, choose one with a considered colour and fabric. Neither choice needs to be a costume. Fit, condition and a well-tied knot will make more difference than following a trend.$$,
    '/images/product-placeholder.svg', 'Bow ties and neckties styled for different occasions', 'style-grooming',
    'Bow Ties vs Neckties: A Guide to Choosing',
    'Compare bow ties and neckties by dress code, collar, proportion and personal style.'
  ),
  (
    'How to Match Cufflinks with Your Outfit',
    'match-cufflinks-with-your-outfit',
    'Cufflinks are a small detail with a clear role: bring the shirt, suit and other metal accents into quiet agreement.',
    $$## Start with the shirt

Cufflinks are made for shirts with French or double cuffs. Make sure the cuff fits comfortably and that the link passes through its openings without pulling. The shirt is the foundation; the cufflink is the finishing detail.

## Coordinate metals thoughtfully

Silver-tone links sit naturally with cool-toned watches and belt hardware, while gold-tone details can warm a navy or brown palette. Metals do not have to be identical, but repeating one finish helps the outfit feel intentional. For a first pair, a simple shape in a neutral metal is easy to wear.

## Let the occasion set the tone

Plain or understated links work well for formal and business settings. A personal motif can be welcome at a celebration, as long as it remains in scale with the rest of the outfit. Keep other accessories quiet when the cufflinks are the focal point.$$,
    '/images/product-placeholder.svg', 'Cufflinks selected to complement a formal shirt and suit', 'accessories-details',
    'How to Match Cufflinks with Your Outfit',
    'Learn how to choose cufflinks for your shirt, metals, suit and occasion.'
  ),
  (
    'The Gentleman''s Guide to Wearing Lapel Pins',
    'gentlemans-guide-to-lapel-pins',
    'A lapel pin should sit neatly, feel appropriate to the occasion and add one considered note to a tailored jacket.',
    $$## Find the lapel buttonhole

Most tailored jackets have a buttonhole on the left lapel. A lapel pin belongs near this point, sitting securely without bending the fabric or pulling the lapel out of shape. If your jacket has no buttonhole, use a pin designed to fasten safely and discreetly.

## Keep the scale in proportion

Choose a size that reads as a detail rather than a statement competing with the jacket. A small floral pin can soften a formal look; a restrained metal design can add interest to a plain blazer. Consider the event before choosing a motif.

## Give it space

Wear a lapel pin as the single focal accessory on that side of the jacket. If you also wear a boutonniere, let the occasion decide which is appropriate rather than crowding the lapel. Check the fastening before leaving and remove the pin carefully to protect the cloth.$$,
    '/images/product-placeholder.svg', 'A lapel pin placed neatly on a tailored jacket', 'accessories-details',
    'How to Wear a Lapel Pin with Confidence',
    'A practical guide to lapel-pin placement, proportion and occasion.'
  ),
  (
    'How to Build a Timeless Collection of Men''s Accessories',
    'build-a-timeless-mens-accessories-collection',
    'A lasting collection grows from your real wardrobe: versatile colours, dependable quality and pieces you enjoy wearing.',
    $$## Take stock before you shop

Look at the clothes and occasions already in your week. Note which accessories you reach for, which pieces are worn out and where one versatile addition could help. This makes it easier to avoid buying duplicates that do not work with your wardrobe.

## Choose a foundation

Build around colours that already appear in your suits, shirts and shoes. A classic tie, pocket square, belt and socks in useful tones create a dependable base. Add formal pieces such as cufflinks or a bow tie when your calendar calls for them.

## Buy with care and maintain what you own

Check construction, fabric and finishing, then choose pieces you can see yourself wearing repeatedly. Store ties without sharp folds, keep metal accessories dry and clean, and mend small issues early. A collection becomes timeless through use and care, not simply through a label or price.$$,
    '/images/product-placeholder.svg', 'A curated selection of versatile men''s accessories', 'the-gentlemans-guide',
    'Build a Timeless Men''s Accessories Collection',
    'Build a considered accessories wardrobe with versatile colours and pieces you will wear often.'
  ),
  (
    'Choosing the Perfect Accessories for Your Groomsmen',
    'choose-accessories-for-your-groomsmen',
    'Create a coordinated wedding-party look that respects the dress code, the people wearing it and the couple''s style.',
    $$## Choose one shared detail

Start with the wedding palette and formality, then decide on one common detail for the group. A tie or bow-tie colour is easy to coordinate, while pocket squares or boutonnieres can provide a softer accent. A single shared element is often enough to make photographs feel cohesive.

## Make room for individual fit

Groomsmen may have different preferences and shirt collars. Confirm sizing, comfort and tying instructions early. If the group wears the same colour, small differences in shirt or suit styling can still make each person feel at ease.

## Plan the practical details

Set a clear budget, choose accessories that can be worn again and order with enough time to check every piece. Keep a spare tie or fastening for the day, and share a simple note about when and how each accessory should be worn.$$,
    '/images/product-placeholder.svg', 'Coordinated accessories prepared for a wedding party', 'wedding-groom',
    'Groomsmen Accessories: A Practical Planning Guide',
    'Coordinate groomsmen accessories with a shared detail, comfortable fits and a clear plan.'
  ),
  (
    'Thoughtful Gift Ideas for the Well-Dressed Gentleman',
    'gift-ideas-for-the-well-dressed-gentleman',
    'The best style gift reflects the recipient''s habits. Choose a useful detail, a considered colour and a presentation that feels personal.',
    $$## Begin with what he wears

Notice whether he reaches for ties, dresses formally for work or saves accessories for celebrations. A gift that complements his existing wardrobe is more likely to be used than one chosen only because it is currently fashionable. If you are unsure, look for colours and patterns already present in his favourite outfits.

## Consider useful, versatile pieces

A classic tie, pocket square, cufflinks or a coordinated accessory set can make a thoughtful present when it suits the recipient. Choose restrained designs for someone whose style is simple, and more expressive details for someone who enjoys colour and pattern.

## Make the choice personal

Think about the occasion, how often the piece can be worn and whether the recipient already owns something similar. A short handwritten note explaining why you chose the colour or design can make a practical gift feel considered without relying on grand claims.$$,
    '/images/product-placeholder.svg', 'A considered accessories gift for a well-dressed gentleman', 'gift-guides',
    'Thoughtful Gift Ideas for a Well-Dressed Gentleman',
    'Choose a thoughtful men''s accessories gift by considering personal style, use and versatility.'
  )
) as seed(title, slug, excerpt, content, cover_image_url, cover_image_alt, category_slug, seo_title, seo_description)
join public.journal_categories as category on category.slug = seed.category_slug
on conflict (slug) do nothing;