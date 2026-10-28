begin;
select plan(23);

select ok((select relrowsecurity from pg_class where oid = 'public.journal_categories'::regclass), 'journal categories have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.journal_articles'::regclass), 'journal articles have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.journal_subscribers'::regclass), 'journal subscribers have RLS enabled');
select ok(has_table_privilege('anon', 'public.journal_categories', 'select'), 'anonymous visitors can read journal categories');
select ok(has_table_privilege('anon', 'public.journal_articles', 'select'), 'anonymous visitors can query articles subject to publication RLS');
select ok(not has_table_privilege('anon', 'public.journal_articles', 'insert'), 'anonymous visitors cannot create articles');
select ok(has_table_privilege('authenticated', 'public.journal_articles', 'insert'), 'authenticated article writes remain subject to admin RLS');
select ok(has_table_privilege('authenticated', 'public.journal_articles', 'update'), 'authenticated article edits remain subject to admin RLS');
select ok(has_table_privilege('authenticated', 'public.journal_articles', 'delete'), 'authenticated article deletion remains subject to admin RLS');
select ok((select position('status' in coalesce(qual, '')) > 0 from pg_policies where schemaname = 'public' and tablename = 'journal_articles' and policyname = 'journal_articles_public_read'), 'public article policy filters on publication status');
select ok((select position('is_store_admin' in coalesce(with_check, '')) > 0 from pg_policies where schemaname = 'public' and tablename = 'journal_articles' and policyname = 'journal_articles_admin_insert'), 'article creation policy checks the store admin allowlist');
select ok(not has_table_privilege('anon', 'public.journal_subscribers', 'select'), 'anonymous visitors cannot read subscriber email addresses');
select ok(not has_table_privilege('authenticated', 'public.journal_subscribers', 'select'), 'authenticated users cannot read subscriber email addresses');
select ok(has_function_privilege('anon', 'public.subscribe_to_journal(text)', 'execute'), 'public visitors can request newsletter subscription through the constrained RPC');

insert into public.admin_allowlist (email) values ('journal-test-admin@example.com') on conflict do nothing;
insert into public.journal_articles (title, slug, excerpt, content, category_id, status, published_at)
select 'Journal RLS published test', 'journal-rls-published-test', 'RLS test excerpt', 'Test content', id, 'published', now()
from public.journal_categories where slug = 'style-grooming'
on conflict (slug) do nothing;
insert into public.journal_articles (title, slug, excerpt, content, category_id, status)
select 'Journal RLS draft test', 'journal-rls-draft-test', 'RLS test excerpt', 'Test content', id, 'draft'
from public.journal_categories where slug = 'style-grooming'
on conflict (slug) do nothing;

set local role anon;
select is((select count(*)::integer from public.journal_articles where slug in ('journal-rls-published-test', 'journal-rls-draft-test')), 1, 'anonymous visitors can see published rows but not drafts');
select is_empty($$select id from public.journal_articles where slug = 'journal-rls-draft-test'$$, 'anonymous visitors cannot read draft content');
select throws_ok($$insert into public.journal_articles (title, slug, excerpt, category_id) select 'Unauthorised', 'unauthorised-journal-test', 'No', id from public.journal_categories limit 1$$, '42501', null, 'anonymous visitors cannot write articles');
select is(public.subscribe_to_journal('Journal.Test@Example.com'), 'subscribed', 'the newsletter RPC confirms a new normalized email');
select is(public.subscribe_to_journal('journal.test@example.com'), 'already_subscribed', 'the newsletter RPC prevents duplicate subscriptions');
select throws_ok($$select public.subscribe_to_journal('invalid-email')$$, '22023', 'Enter a valid email address.', 'the newsletter RPC rejects malformed email addresses');

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","email":"journal-customer@example.com"}';
select is_empty($$select id from public.journal_articles where slug = 'journal-rls-draft-test'$$, 'signed-in non-admins cannot read drafts');
select throws_ok($$insert into public.journal_articles (title, slug, excerpt, category_id) select 'Unauthorised customer', 'unauthorised-customer-journal-test', 'No', id from public.journal_categories limit 1$$, '42501', null, 'signed-in non-admins cannot create articles');
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","email":"journal-test-admin@example.com"}';
select is((select count(*)::integer from public.journal_articles where slug = 'journal-rls-draft-test'), 1, 'allowlisted administrators can read draft content');

rollback;