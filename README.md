# Mamigloexclusive

A responsive men's-accessories storefront for Nigeria. The active frontend is React + Vite, with Supabase Auth, PostgreSQL/RLS, Storage, and Edge Functions planned for privileged checkout and image uploads. The former Azure Functions/Cosmos implementation remains under `api/` and `infra/` as a rollback and data-reference source; the root storefront no longer calls it.

## Current Status

The existing storefront and admin experience have been adapted to Supabase. It includes product and category browsing, product detail galleries, persistent cart, server-priced order requests, WhatsApp handoff, admin sign-in, product/category/order management, configurable delivery fee, and metrics based on recorded orders. Card payments are not enabled; orders remain pending until confirmed through WhatsApp.

The local Supabase schema and Edge Functions are in `supabase/`. They have not yet been applied/deployed. The signed-in project is `mamigloexclusive` (`vltjvixjjahrlwmnhvzn`), currently on Supabase Free. Dashboard SQL Editor and API settings pages failed to identify the project during setup, so no hosted database changes have been made. See [the audit and migration guide](docs/audit-and-migration.md) for findings, migration order, and deployment requirements.

Local data is not production data: `api/.local/store.json` currently contains four demo products and two pending orders. It has not been imported, modified, or deleted. Do not treat demo inventory as real stock.

## Requirements

- Node.js 22.12 or later and npm.
- A Supabase project for the database, Auth, Storage, and Edge Functions.
- Supabase CLI and Docker for local database/function testing (not currently installed/available in this workspace).

## Local Development

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env` using the signed-in Supabase project's public settings. The project URL is `https://vltjvixjjahrlwmnhvzn.supabase.co`. The publishable key is safe to use in the browser only because RLS is enabled; never use a Supabase secret/service-role key in a `VITE_*` variable.

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

The build creates `public/sitemap.xml` using `VITE_SITE_URL` and published products. It emits no placeholder-domain URLs when production settings are missing.

## Supabase Migration

1. Confirm the target project reference is `vltjvixjjahrlwmnhvzn` before running any SQL. Apply the files in `supabase/migrations/` in timestamp order only after the SQL Editor or CLI clearly targets this project. The latest migration adds the authenticated administrator eligibility check used by the admin sign-in screen.
2. Disable public Auth signup in the hosted Auth settings. Create the administrator directly in Supabase Auth, then add the verified email to the private allowlist using the SQL Editor.
3. Deploy the `create-order` and `upload-product-image` functions. Add `SUPABASE_SERVICE_ROLE_KEY` and a generated `CHECKOUT_RATE_LIMIT_SECRET` to Supabase Function Secrets only.
4. Run `supabase/tests/store_rls.test.sql` against a local or non-production Supabase database before relying on production policies.
5. Verify order pricing, delivery, inventory conflicts, idempotent retries, cancellation/restock, admin authorization, and image upload validation.

The SQL Editor, Table Editor, and API settings pages reported an undefined project reference during this setup session. The migration and Edge Functions have not been run against the hosted project.

## Data and Images

Do not automatically import local records. The four local catalogue products are marked demo, and the two pending orders may contain customer information. Export and review any data before import; preserve the old source until counts and values reconcile. Use real, business-approved product photographs only. Admin uploads accept JPG, PNG, or WebP up to 5 MB per file; public product photos are intentionally readable from the public bucket.

## Hosting and Cost

Supabase Free is currently $0 and includes 500 MB database, 1 GB file storage, 5 GB egress, 50,000 monthly active users, and 500,000 Edge Function invocations. Free projects can pause after a week of inactivity, have no automatic backups, and allow two active projects. Review current limits before launch.

Vercel Hobby is $0 but is restricted to personal, non-commercial use; it is not appropriate for this business storefront. Vercel Pro currently starts at $20/month. No paid resources have been created. Choose/approve a commercial hosting plan before deployment; do not purchase a custom domain without approval.

## Previous Azure Implementation

The Azure Functions/Cosmos backend, Bicep, Entra authentication, and local JSON store remain in `api/` and `infra/` for reference and rollback. They are not part of the root storefront install or deployment. Preserve them until the Supabase data and end-to-end migration are verified.
