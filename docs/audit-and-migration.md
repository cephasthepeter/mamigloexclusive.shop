# Mamigloexclusive Audit and Supabase Migration

## Audit

The project already had a React 19/Vite storefront and Azure Functions v4 API backed by Cosmos DB. Useful behavior preserved in the Supabase frontend includes product/category browsing, search and price filters, product details, a persistent shopping bag, server-priced pending orders, stock reservation/release, WhatsApp order drafts, contact-form fallback, and product/category/order admin screens. The existing responsive black/white/warm-neutral/gold design has been retained and extended with multi-image galleries and dashboard metrics.

The old Azure backend uses Entra allowlisting, Cosmos document storage, and private Azure Blob uploads. Those components are still present under `api/` and `infra/` for rollback and data reference, but the root storefront no longer installs or calls them. The former `.env.example` included an administrator email and mixed public and server-only settings; it has been replaced with browser-safe public settings only. The admin is now Supabase Auth email/password, with database allowlisting and RLS.

The ignored local file `api/.local/store.json` has four demo products and two pending orders. No product descriptions, order/customer information, keys, or file contents were copied into this report. No migration or deployment has been applied to Supabase, and the local JSON file is unchanged. The backup archive created before migration work is at `%TEMP%/mamigloexclusive-pre-supabase-20261020.zip`; it excludes environment secrets and local store data.

The signed-in Supabase dashboard identified project `mamigloexclusive` (`vltjvixjjahrlwmnhvzn`) on the Free plan, reporting Healthy, nano compute, no recorded migrations or backups, and no GitHub repository connection. The shared Table Editor, API settings, and SQL Editor subsequently rendered with an undefined project reference and aborted requests. The hosted project has therefore not been modified.

## Migration Plan

1. Apply `supabase/migrations/202610200001_initial_store.sql` to the confirmed Supabase project only after the dashboard SQL Editor or Supabase CLI reliably identifies that project. This creates categories, products, settings, an administrator allowlist, orders, order items, explicit grants/RLS, a public read-only product-photo bucket, atomic checkout/status functions, and a database-backed rate limiter.
2. Disable public Auth sign-up in the hosted project's Auth settings. Create the administrator directly in Supabase Auth and add that verified email to `private` admin allowlisting using the SQL Editor. Never put a service-role key in Vite variables.
3. Deploy `create-order` and `upload-product-image` Edge Functions. Set server-side `SUPABASE_SERVICE_ROLE_KEY` and a strong random `CHECKOUT_RATE_LIMIT_SECRET` in Supabase function secrets. These are not frontend variables.
4. Configure the local `.env` with the real project URL and publishable key from Supabase Settings > API Keys. Configure the same public values as Vercel environment variables only after choosing an eligible hosting plan.
5. Run the RLS SQL tests against a local or non-production Supabase database. Then exercise admin authentication, products, image uploads, checkout pricing/stock concurrency, idempotent retries, cancellation restocking, and unauthorized access.
6. Do not import local records automatically. All four products are explicitly demo data, and the two local pending orders may contain customer information. Export/backup first; import only after the business owner confirms what is real and should be retained. Keep the original Azure/local data until the imported records have been reconciled.
7. Add genuine product and brand photography, approved delivery/returns/privacy/terms content, and confirm the destination pricing rule. The configured default is NGN 3,000; the database is authoritative. Do not describe pending WhatsApp requests as paid orders.
8. Deploy only after the hosting cost decision, Supabase policies/tests, auth allowlist, production environment variables, and end-to-end acceptance checks are complete.

## Cost and Deployment Decision

Supabase currently offers a $0 Free plan with 500 MB database, 1 GB storage, 5 GB egress, 50,000 monthly active users, and up to 500,000 Edge Function invocations. The dashboard reports that this project is on Free. Supabase Free projects pause after one week of inactivity, have no automatic backups, and are limited to two active projects; this is a meaningful reliability/data-protection tradeoff for a live shop.

Vercel currently lists Hobby at $0 but restricts it to personal, non-commercial use. Vercel Pro starts at $20/month. This business site must not be deployed under Hobby. No paid service or resource has been created. Either explicitly approve Vercel Pro or choose a hosting provider whose current terms allow commercial use on its free tier. A custom domain is not included in this migration and should not be purchased without approval.

Supabase pricing: https://supabase.com/pricing
Vercel pricing and Hobby restrictions: https://vercel.com/pricing
Supabase RLS guidance: https://supabase.com/docs/guides/database/postgres/row-level-security
Supabase Edge Functions: https://supabase.com/docs/guides/functions

## Local Setup

1. Copy `.env.example` to `.env` and set `VITE_SUPABASE_PUBLISHABLE_KEY` from the signed-in Supabase dashboard. `VITE_SUPABASE_URL` is the confirmed project URL.
2. Set `CHECKOUT_RATE_LIMIT_SECRET` in Supabase Function Secrets to a generated random value. Never add it to `.env` or any `VITE_*` variable.
3. Run `npm.cmd install`, `npm.cmd run dev`, and open `http://localhost:5173`.
4. Run `npm.cmd test` and `npm.cmd run build` before deployment.

The Supabase CLI, Deno, PostgreSQL client, and working Docker daemon were not available during this session. Therefore the SQL migration, Edge Functions, RLS tests, and hosted runtime are not yet executed or verified. Use the SQL Editor or install the Supabase CLI and Docker to finish those checks.

## Vercel Deployment

1. Connect the existing Git repository to Vercel; the current signed-in Supabase project has no repository connection, and Git is unavailable in this workspace terminal.
2. Set the project root to this repository and add `VITE_STORE_NAME`, `VITE_WHATSAPP_NUMBER`, `VITE_BUSINESS_PHONE`, `VITE_BUSINESS_EMAIL`, `VITE_INSTAGRAM_URL`, `VITE_FACEBOOK_URL`, `VITE_ANNOUNCEMENT`, `VITE_DELIVERY_FEE_NGN`, `VITE_SITE_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` as frontend build variables.
3. Run a production build. The build generates `public/sitemap.xml` from the real production URL and published Supabase products; without the URL and public key it deliberately emits no placeholder URLs.
4. Set the deployed origin in Supabase Auth's allowed redirect URLs. Disable public sign-up and verify only the allowlisted administrator can use `/admin`.
5. Verify public product reads, RLS denials, checkout totals, delivery fee, order persistence, duplicate-submit protection, stock restoration on cancellation, image type/size enforcement, mobile layout, and production console/network errors before accepting orders.
