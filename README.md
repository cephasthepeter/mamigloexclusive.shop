# Mamigloexclusive

A responsive men's-accessories storefront for Nigeria. The active frontend is React + Vite, with Supabase Auth, PostgreSQL/RLS, Storage, and Edge Functions planned for privileged checkout and image uploads. The former Azure Functions/Cosmos implementation remains under `api/` and `infra/` as a rollback and data-reference source; the root storefront no longer calls it.

## Current Status

The existing storefront and admin experience have been adapted to Supabase. It includes product and category browsing, product detail galleries, persistent cart, server-priced order requests, OPay bank-transfer and cash-on-delivery selections, WhatsApp handoff, admin sign-in, product/category/order management, configurable delivery fee, and metrics based on recorded orders. The Journal adds published editorial pages, allowlist-protected article management, draft seed stories, newsletter subscription storage, and production sitemap/prerender support. Newsletter addresses are stored only after the database confirms a valid, unique subscription; no email delivery provider is configured. OPay transfers are manually verified by an administrator; the site does not claim to confirm bank payments automatically. The 30-minute confirmation timer is informational and never changes order/payment status or releases stock.

The local Supabase schema and Edge Functions are in `supabase/`. They have not yet been applied/deployed. The signed-in project is `mamigloexclusive` (`vltjvixjjahrlwmnhvzn`), currently on Supabase Free. Dashboard SQL Editor and API settings pages failed to identify the project during setup, so no hosted database changes have been made. The latest migrations add OPay review and Journal content while preserving existing order data. See [the audit and migration guide](docs/audit-and-migration.md) for findings, migration order, and deployment requirements.

Local data is not production data: `api/.local/store.json` currently contains four demo products and two pending orders. It has not been imported, modified, or deleted. Do not treat demo inventory as real stock.

## Requirements

- Node.js 22.12 or later and npm.
- A Supabase project for the database, Auth, Storage, and Edge Functions.
- Supabase CLI and Docker Desktop for local database/function testing. The CLI is available through `npx`, but Docker Desktop must be running before local SQL tests can connect.

## Local Development

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env` using the signed-in Supabase project's public settings. The project URL is `https://vltjvixjjahrlwmnhvzn.supabase.co`. The publishable key is safe to use in the browser only because RLS is enabled; never use a Supabase secret/service-role key in a `VITE_*` variable.

To enable Google sign-in and signup, create a Google OAuth web client and add its client ID and secret under Supabase Auth → Providers → Google. Register Supabase's callback URL shown on that provider page with Google, and add the local and production account URLs to Supabase Auth's allowed redirect URLs. Set `VITE_ENABLE_GOOGLE_AUTH=true` in the local environment and the Vercel project after the provider is configured. The customer auth page shows the Google option in both sign-in and account-creation modes; Google OAuth is not enabled by default.

## Cloudinary Media

New product, journal-cover, administrator-profile, and homepage hero media uploads go directly from the browser to Cloudinary using short-lived signatures from the authenticated `cloudinary-media` Supabase Edge Function. Supabase stores media URLs, public IDs, dimensions, format, alt text, owner references, and ordering. Existing Supabase Storage media remains readable; existing assets are not copied or deleted automatically.

Set `VITE_CLOUDINARY_CLOUD_NAME` in `.env` and the Vercel project to the Cloudinary cloud name. It is public configuration used to verify that the browser is uploading to the same cloud as the trusted signing function. Do not set `CLOUDINARY_API_SECRET`, `CLOUDINARY_API_KEY`, or any Supabase service-role key in Vercel's `VITE_*` variables or in browser code.

In Cloudinary, create two **signed** upload presets named `mamiglo-images` and `mamiglo-videos`. Configure `mamiglo-images` to allow only JPG/JPEG, PNG, and WebP with a 10 MB maximum; configure `mamiglo-videos` to allow only MP4 and WebM with a 100 MB maximum. Keep overwrite disabled and formats restricted. The app recommends compressed hero videos around 5–15 MB; the account's separate 40 MB transformation limit must also be respected when choosing video duration and encoding.

The Cloudinary media schema is defined in `supabase/migrations/202610270006_cloudinary_media.sql`. The incremental hero and order controls migrations are `202610280001_optional_hero_campaign_ctas.sql`, `202610280002_fix_hero_publish_delete.sql`, and `202610280003_order_fulfilment_payment_controls.sql`. Review the linked project's migration history before applying these migrations, and do not run `db push` against projects with unresolved migration-history gaps. Set these server-side Supabase Function secrets (never in `.env` or Vercel):

```powershell
supabase secrets set --project-ref <project-ref> CLOUDINARY_CLOUD_NAME=<cloud-name> CLOUDINARY_API_KEY=<api-key> CLOUDINARY_API_SECRET=<api-secret> CLOUDINARY_IMAGE_UPLOAD_PRESET=<image-preset> CLOUDINARY_VIDEO_UPLOAD_PRESET=<video-preset>
```

Deploy `cloudinary-media` with `supabase functions deploy cloudinary-media --project-ref <project-ref>`. The function checks the Supabase access token and admin allowlist on every signature or deletion request. Its Cloudinary secret is used only server-side. The existing `upload-product-image` function and Supabase buckets are retained for rollback and older clients; the current dashboard uses Cloudinary for new media.

For local use, start Docker Desktop, start Supabase with `supabase start`, and apply migrations only to a disposable local database. Create the ignored file `supabase/functions/.env` with these server-side values:

```powershell
CLOUDINARY_CLOUD_NAME=<cloud-name>
CLOUDINARY_API_KEY=<api-key>
CLOUDINARY_API_SECRET=<api-secret>
CLOUDINARY_IMAGE_UPLOAD_PRESET=<image-preset>
CLOUDINARY_VIDEO_UPLOAD_PRESET=<video-preset>
```

Run `supabase functions serve cloudinary-media --env-file supabase/functions/.env`. Set only the public `VITE_CLOUDINARY_CLOUD_NAME` in the root `.env`. Do not test destructive Cloudinary deletion against production media. Local upload, authorization, deletion, and Vercel deployment still need verification with a configured Cloudinary account and Supabase project.

For Vercel, keep the existing Vite build/output settings, set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_CLOUDINARY_CLOUD_NAME` in the project environment, and deploy the frontend normally. Apply the migration and deploy `cloudinary-media` separately to Supabase before enabling the new dashboard uploads. No Vercel serverless function or Cloudinary secret is required.

Then start the storefront:

```powershell
npm.cmd run dev
```

Open `http://localhost:5173`. Until the publishable key is configured and the migration is applied, the app will report that the database is not configured/available.

## Tests and Build

```powershell
npm.cmd test
npm.cmd run build
```

The build creates `public/sitemap.xml` using `VITE_SITE_URL`, published products, and published journal stories. When `VITE_SITE_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` are configured and the journal migration is applied, it also writes static HTML and metadata for `/journal` and each published `/journal/:slug` article into `dist/`. Without those production settings, prerendering skips and the Vite SPA remains available.

## Supabase Migration

1. Confirm the target project reference is `vltjvixjjahrlwmnhvzn` before running any SQL. Apply the files in `supabase/migrations/` in timestamp order only after the SQL Editor or CLI clearly targets this project. The Journal migration is `202610270002_journal.sql`; it creates article/category/subscriber tables, allowlist-backed RLS, a duplicate-safe newsletter RPC, and ten unpublished starter drafts.
2. Disable public Auth signup in the hosted Auth settings. Create the administrator directly in Supabase Auth, then add the verified email to the private allowlist using the SQL Editor.
3. Deploy the `create-order` and `cloudinary-media` functions. Add `SUPABASE_SERVICE_ROLE_KEY`, a generated `CHECKOUT_RATE_LIMIT_SECRET`, and the Cloudinary server-side secrets described above to Supabase Function Secrets only. Keep the existing `upload-product-image` function available while old clients may still use it.
4. Run `supabase/tests/store_rls.test.sql` and `supabase/tests/journal_rls.test.sql` against a local or non-production Supabase database before relying on production policies.
5. Verify order pricing, delivery, inventory conflicts, idempotent retries, cancellation/restock, payment-method persistence, admin authorization, payment-status authorization, and image upload validation. Mark OPay orders paid only after verifying the transfer in the business account; card payments are not configured.

The SQL Editor, Table Editor, and API settings pages reported an undefined project reference during this setup session. The migration and Edge Functions have not been run against the hosted project.

## Data and Images

Do not automatically import local records. The four local catalogue products are marked demo, and the two pending orders may contain customer information. Export and review any data before import; preserve the old source until counts and values reconcile. Use real, business-approved product photographs only. Admin uploads accept JPG, PNG, or WebP up to 5 MB per file; public product photos are intentionally readable from the public bucket.

## Hosting and Cost

Supabase Free is currently $0 and includes 500 MB database, 1 GB file storage, 5 GB egress, 50,000 monthly active users, and 500,000 Edge Function invocations. Free projects can pause after a week of inactivity, have no automatic backups, and allow two active projects. Review current limits before launch.

Vercel Hobby is $0 but is restricted to personal, non-commercial use; it is not appropriate for this business storefront. Vercel Pro currently starts at $20/month. No paid resources have been created. Choose/approve a commercial hosting plan before deployment; do not purchase a custom domain without approval.

## Previous Azure Implementation

The Azure Functions/Cosmos backend, Bicep, Entra authentication, and local JSON store remain in `api/` and `infra/` for reference and rollback. They are not part of the root storefront install or deployment. Preserve them until the Supabase data and end-to-end migration are verified.
