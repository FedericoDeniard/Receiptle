# Receiptle

A personal finance app that automatically extracts transactions from your Gmail inbox and uploaded documents using AI. It tracks income and expenses, categorizes them, and provides financial insights across multiple currencies.

## Highlights

- Automatic transaction extraction from Gmail emails using AI (xAI Grok).
- Real-time processing of new emails via Gmail Watch and Pub/Sub.
- Upload receipts and invoices (PDF/images) for AI-powered extraction.
- Multi-currency support with comparative analytics.
- Monthly trends, category breakdowns, and savings insights.
- Multi-language interface (English / Spanish).

## How it works

1. Sign up and connect your Gmail account via OAuth.
2. Receiptle imports your last 3 months of transaction emails automatically.
3. New emails are processed in real time as they arrive.
4. AI extracts amount, currency, merchant, category, date, and transaction type.
5. View your finances in the dashboard with filters, charts, and metrics.

You can also add transactions manually or upload documents (PDFs, images) for AI extraction.

## Tech stack

- **Frontend**: React, React Router, TanStack Query, Tailwind CSS, Framer Motion
- **Backend**: Supabase (Auth, PostgreSQL, Edge Functions, Realtime)
- **AI**: xAI Grok with structured output (Zod schemas)
- **Integrations**: Gmail API, Google OAuth, Google Pub/Sub
- **Observability**: Langfuse for AI operation tracing

## Getting started

### Prerequisites

- Docker and Docker Compose

### Setup

Create environment files from the provided examples:

```bash
cp packages/frontend/.env.example packages/frontend/.env
cp supabase/functions/.env.example supabase/functions/.env
```

Edit each `.env` file with your actual credentials (Supabase keys, Google OAuth, xAI API key, etc.).

For local internal edge-function auth, keep this value in `supabase/functions/.env`:

```bash
INTERNAL_FUNCTIONS_SECRET=local-dev-internal-secret
```

On local `db reset`, seeds populate Vault with the same value under `INTERNAL_FUNCTIONS_SECRET`.

### Run the app

```bash
PROJECT_ROOT=$(pwd) docker compose up --build
```

This starts:

- The frontend with hot reload at `http://localhost:3000`
- The landing (Astro) dev server at `http://localhost:4321`, proxied through the frontend at `/`
- A Supabase local stack (database, auth, edge functions, studio)

No local installation of Bun or Supabase CLI is required.

### Stop the app

```bash
PROJECT_ROOT=$(pwd) docker compose down
```

## Database commands

Reset the database (applies all migrations and seeds):

```bash
PROJECT_ROOT=$(pwd) docker compose run --rm supabase-cli sh -lc "supabase start && supabase db reset --local"
```

Apply pending migrations:

```bash
PROJECT_ROOT=$(pwd) docker compose run --rm supabase-cli sh -lc "supabase start && supabase migration up --include-all --local"
```

Generate TypeScript types from the database schema:

```bash
PROJECT_ROOT=$(pwd) docker compose run --rm supabase-cli sh -lc "supabase start && supabase gen types typescript --local > packages/frontend/src/types/database.types.ts"
```

NPM/Bun wrappers are also available:

```bash
bun run docker:db:reset
bun run docker:db:migration:up
bun run docker:db:types
```

## Seed data

Seeds are configured in `supabase/config.toml` as `sql_paths = ["./seeds/*.sql"]` and run automatically on `db reset`.

| File                                      | Description                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `001_auth_test_user.sql`                  | Creates test account `user@test.com` / `password123`                             |
| `002_transactions_test_user.sql`          | Inserts 132 demo transactions for the test account                               |
| `005_internal_functions_secret_local.sql` | Upserts local Vault secret `INTERNAL_FUNCTIONS_SECRET=local-dev-internal-secret` |

## Environment variables

| Location                  | Purpose                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `packages/frontend/.env`  | Frontend (Supabase URL, publishable key, port, `LANDING_DEV_URL` in dev) |
| `supabase/functions/.env` | Edge Functions (OAuth, AI keys, Langfuse, etc.)                          |

See each `.env.example` for the full list of required variables.

Local `.env` keys must come from `supabase status` (Authentication Keys) for the
local stack. Production keys only go in Railway variables or Supabase Edge
Function secrets; hosted Edge Functions receive `SUPABASE_*` variables from the
platform.

## Production secrets checklist

### Supabase-provided variables (do not set manually)

Edge Functions get these injected by the platform. Secret names starting with
`SUPABASE_` are reserved and rejected by the Dashboard/Management API:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEYS` (JSON dictionary of publishable keys)
- `SUPABASE_SECRET_KEYS` (JSON dictionary of secret keys)
- `SUPABASE_JWKS`

The Edge Functions read the publishable/secret keys through
`_shared/lib/api-keys.ts`. The publishable key falls back to the legacy anon key
for local development; the secret key has no legacy fallback and must be set
before deploying. Keys are selected by name from the injected dictionaries:
`PUBLISHABLE_KEY_NAME` and `SECRET_KEY_NAME` default to `default`. If the named
key is missing, the function fails with a clear error instead of picking an
arbitrary key. If your only secret key is not named `default` (for example
`railway_brod`), set `SECRET_KEY_NAME` as an Edge Function secret before
deploying, or create a `default` secret key.

### Railway services

Set these on the Railway services:

- Frontend: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
- Mastra server: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SECRET_KEY`

### Edge Functions secrets (remote)

Set these in your remote project (Dashboard or CLI):

- `FRONTEND_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OAUTH_REDIRECT_URI`
- `GOOGLE_PROJECT_ID`
- `PUBSUB_TOPIC`
- `PUBSUB_OIDC_AUDIENCE`
- `PUBSUB_OIDC_SERVICE_ACCOUNT_EMAIL`
- `PUBSUB_OIDC_SERVICE_ACCOUNT_SUB`
- `PUBSUB_EXPECTED_SUBSCRIPTION`
- `XAI_API_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_BASE_URL`
- `CORS_ALLOWED_ORIGINS`
- `CORS_ALLOW_CREDENTIALS`
- `INTERNAL_FUNCTIONS_SECRET`
- `PUBLISHABLE_KEY_NAME` / `SECRET_KEY_NAME` (optional; only if your keys are
  not named `default`)

Example with CLI:

```bash
supabase secrets set \
  FRONTEND_URL=... \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  OAUTH_REDIRECT_URI=... \
  GOOGLE_PROJECT_ID=... \
  PUBSUB_TOPIC=... \
  PUBSUB_OIDC_AUDIENCE=... \
  PUBSUB_OIDC_SERVICE_ACCOUNT_EMAIL=... \
  PUBSUB_OIDC_SERVICE_ACCOUNT_SUB=... \
  PUBSUB_EXPECTED_SUBSCRIPTION=... \
  XAI_API_KEY=... \
  LANGFUSE_SECRET_KEY=... \
  LANGFUSE_PUBLIC_KEY=... \
  LANGFUSE_BASE_URL=... \
  CORS_ALLOWED_ORIGINS=https://bun-react-template-production.up.railway.app \
  CORS_ALLOW_CREDENTIALS=false \
  INTERNAL_FUNCTIONS_SECRET=...
```

### Vault secret (remote database)

`renew_gmail_watches()` reads `INTERNAL_FUNCTIONS_SECRET` from Vault, so this value must also exist in `vault.decrypted_secrets` with the same name.

Create:

```sql
select vault.create_secret(
  'YOUR_INTERNAL_FUNCTIONS_SECRET',
  'INTERNAL_FUNCTIONS_SECRET',
  'Internal token used by renew_gmail_watches()'
);
```

Update:

```sql
select vault.update_secret(
  (
    select id
    from vault.decrypted_secrets
    where name = 'INTERNAL_FUNCTIONS_SECRET'
    limit 1
  ),
  'YOUR_INTERNAL_FUNCTIONS_SECRET',
  'INTERNAL_FUNCTIONS_SECRET',
  'Internal token used by renew_gmail_watches()'
);
```

Verify:

```sql
select name, length(decrypted_secret) as secret_len, updated_at
from vault.decrypted_secrets
where name = 'INTERNAL_FUNCTIONS_SECRET';
```

### Gmail Pub/Sub push subscription

Gmail watches publish to a shared Pub/Sub topic. Provision one authenticated push subscription per GCP environment, not one per Gmail account. The provisioning script creates or updates the dedicated push service account, grants the Pub/Sub service agent token-creation permission on that account, ensures Gmail can publish to the topic, and creates or updates a non-expiring push subscription:

```bash
GOOGLE_PROJECT_ID=gen-lang-client-0320504047 \
SUPABASE_URL=https://nswqfbakcbfaxuoguqhe.supabase.co \
bash scripts/gcp/provision-gmail-pubsub-subscription.sh
```

The script prints the four `PUBSUB_OIDC_*` / `PUBSUB_EXPECTED_SUBSCRIPTION` values to set as Supabase Edge Function secrets. It does not create or export service-account keys. `gmail-webhook` verifies the Google-signed OIDC token, expected service-account identity, audience, and subscription envelope before reading the payload. Do not create an unauthenticated push subscription.

## Toolbox container

You can enter the Supabase CLI container to run any command manually:

```bash
PROJECT_ROOT=$(pwd) docker compose exec supabase-cli sh
```

Inside the container you have full access to the Supabase CLI without installing it locally.

## Troubleshooting

- Use **service names** with `docker compose exec` (e.g. `frontend`, `supabase-cli`), not container names.
- Run compose commands with `PROJECT_ROOT=$(pwd)` (already included in `bun run docker:*` scripts). This keeps host and in-container paths identical so Supabase nested Docker mounts work on both macOS and Linux.
- If the frontend fails to load config, verify that `packages/frontend/.env` exists and has valid `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
- Stream frontend logs with `docker compose logs -f frontend`.
- The frontend Docker image is pinned to `oven/bun:1.3.9` for runtime parity with local development.
