# AGENTS.md

## What this repo is

Personal finance tracker. Auto-extracts transactions from Gmail and uploaded documents using AI (xAI Grok for extraction, OpenRouter for chat). Multi-currency dashboard with monthly trends, category breakdowns, and a chat assistant. Real-time updates via Supabase Realtime broadcast channels.

Stack: TypeScript (strict, `noUncheckedIndexedAccess` on), React 19, React Router v7, TanStack Query v5, Tailwind CSS v4, Bun runtime (frontend), pnpm workspaces, Supabase (Postgres + Deno Edge Functions + Realtime + Vault), Hono (mastra-server), xAI Grok, OpenRouter, Langfuse.

## Workspace layout

```
receiptle/
├── packages/
│   ├── frontend/         # React 19 SPA served by Bun (Bun.serve, no Vite)
│   │   └── src/{components,hooks,pages,services,lib,routes,types,utils}
│   ├── landing/          # Astro static landing (SSG) served by the frontend at `/` and `/en/`
│   │   └── src/{components,i18n,layouts,mock,pages,styles}
│   ├── mastra-server/    # Standalone Hono + @mastra/hono AI server (port 4111)
│   │   └── src/{mastra/{agents,tools,routes},middleware,lib,services}
│   └── theme/            # theme.css — design tokens shared by frontend + landing
├── supabase/
│   ├── functions/        # 12 Deno Edge Functions
│   │   └── _shared/      # Shared code (auth, cors, gmail-auth, ai/, lib/)
│   ├── migrations/       # 95 SQL files, named <timestamp>_<name>.sql
│   └── seeds/            # Run on `db reset` per supabase/config.toml
├── bruno/                # Bruno API test collection (commit requests, NOT environments/)
├── docs/                 # Source-of-truth docs (e.g. docs/access-control.md)
├── docker-compose.yml    # Local dev stack (frontend + supabase-cli containers)
├── Dockerfile.frontend       # oven/bun:1.3.9
└── Dockerfile.supabase-cli  # wraps the Supabase CLI
```

The `supabase` local stack runs in a `network_mode: "host"` container with `docker.sock` mounted so `supabase start` can spin up Postgres/Auth/Studio. The frontend container is separate.

The marketing landing (`packages/landing`, Astro) is built into `packages/landing/dist` and served by `packages/frontend/src/index.tsx` at `/` (Spanish) and `/en/` (English); the SPA's `/` route only redirects to `/dashboard`. `packages/frontend`'s `build` script builds the landing first (`build:landing`), so Railway's single `bun run --filter=bun-react-template build` step still produces everything. In dev, `LANDING_DEV_URL` proxies those routes to `astro dev` (HMR); without it the server serves the last landing build.

## Build / dev commands

Local dev runs entirely in Docker. **Do not** install Bun or the Supabase CLI locally.

```bash
# Full stack (frontend + supabase). Requires PROJECT_ROOT so nested
# Docker volume mounts resolve correctly on macOS and Linux.
PROJECT_ROOT=$(pwd) docker compose up --build   # or: bun run docker:up

# Inside the supabase-cli container (for DB work, type gen, etc.):
bun run docker:shell                             # = docker compose exec supabase-cli sh
bun run docker:db:reset                          # migrate + seed (destructive)
bun run docker:db:migration:up                   # apply pending migrations only
bun run docker:db:types                          # regen packages/frontend/src/types/database.types.ts

# Stop
bun run docker:down                              # = docker compose down
```

Per-package dev (run inside Docker, or directly if you have Bun + Supabase CLI on host):

```bash
# Frontend: Bun.serve with HMR on :3000
bun --filter frontend dev          # or: cd packages/frontend && bun dev

# Landing: Astro dev server on :4321 (`astro dev stop` to stop the daemon)
bun --filter landing dev           # or: cd packages/landing && bun dev

# Mastra server: Hono on :4111 (MASTRA_PORT)
bun --filter mastra-server dev     # or: cd packages/mastra-server && bun dev
```

`bun dev` at the root runs `pnpm --parallel -r run dev`, so all three packages start in parallel.

The landing builds with the frontend (`bun run build` inside `packages/frontend` runs `build:landing` first). To build it alone:

```bash
cd packages/landing && bun run build      # -> packages/landing/dist/{index.html,en/index.html,_astro/*}
cd packages/landing && bun run icons:generate   # regenerate icon-paths.ts from lucide-react
```

Lint, format, typecheck, knip, tests:

```bash
bun run lint            # oxlint on packages/frontend/src (root .oxlintrc.json)
bun run lint:fix        # oxlint --fix
bun run format          # oxfmt on packages/frontend/src (root .oxfmtrc.json)
bun run format:check
bun run check           # lint + format:check  (run this before pushing)
bun run knip            # unused dep/file scanner
bun run prepare         # installs husky (lint-staged runs on pre-commit)

# Mastra-server typecheck
cd packages/mastra-server && bun run typecheck   # tsc --noEmit
```

The CI workflow (`.github/workflows/ci.yml`) only runs `bun install`, `bun run lint`, and `bun run build` (in `packages/frontend`). React Doctor runs on PRs in `react-doctor.yml`; the deploy workflow (`.github/workflows/deploy-production.yml`) only runs on push to `main` and applies migrations + deploys edge functions via the Supabase CLI.

## Tests

Two test surfaces; the rest of the repo has no unit tests.

1. **Grok transaction-agent integration test** (Deno, hits live xAI):

   ```bash
   bun run test:grok:transaction-agent
   # Internally: cd supabase && deno test --no-check --env-file=functions/.env \
   #   --allow-env --allow-sys=hostname --allow-net functions/_shared/ai/transaction-agent.integration.test.ts
   ```

   `unset OPENROUTER_API_KEY` is intentional — Grok-only path. Requires `XAI_API_KEY` in `supabase/functions/.env`.

2. **Frontend E2E tests** (`bun test`, Stagehand browser driver):

   ```bash
   cd packages/frontend && bun test tests/login.test.ts tests/register.test.ts
   ```

   Requires `XAI_API_KEY` in `packages/frontend/.env` and the Docker stack running (the tests hit `http://localhost:3000`).

3. **Guardrail comparison harness** (Deno, hits live OpenRouter — Gemini, JEV and gpt-6-luna-decisions):

   ```bash
   bun run test:guardrail:comparison
   # Internally: cd supabase && deno test --no-check --env-file=functions/.env \
   #   --allow-env --allow-sys=hostname --allow-net functions/_shared/ai/guardrail-comparison.test.ts
   ```

   Observational eval over the shared labeled corpus; fails only on guardrail call errors. Requires the local Supabase stack (calls go through the `http_post` RPC) and `OPENROUTER_API_KEY` in `supabase/functions/.env`. Decisions calls are paid. See `supabase/functions/_shared/ai/README.md`.

## Environment files

Three distinct env files, never consolidated:

| File                          | Read by                                               | Notes                                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/frontend/.env`      | `src/index.tsx` (Bun auto-loads .env)                 | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `PORT`, `VAPID_PUBLIC_KEY`, `CHAT_ENABLED`, `MASTRA_SERVER_URL`, `APP_URL`, `XAI_API_KEY` (E2E only), `MP_PUBLIC_KEY`, `LANDING_DEV_URL` (dev only: proxies `/` to `astro dev`)             |
| `supabase/functions/.env`     | All Deno edge functions (`--env-file=functions/.env`) | OAuth, `XAI_API_KEY`, `LANGFUSE_*`, `INTERNAL_FUNCTIONS_SECRET`, etc.                                                                                                                                                                   |
| `packages/mastra-server/.env` | `src/env-loader.ts`                                   | Loaded synchronously because **pnpm strips env vars before forking Bun** — `env-loader.ts` MUST be the first import in `src/server.ts`. Don't use `dotenv`; Bun already auto-loads, but the explicit loader makes the contract visible. |

`INTERNAL_FUNCTIONS_SECRET` must match in `supabase/functions/.env` and in Vault (`vault.decrypted_secrets`). The seed `supabase/seeds/005_internal_functions_secret_local.sql` populates it for local dev. For production, set both the env secret and the Vault secret — they are read by different layers.

Supabase API keys: use publishable/secret keys, not the legacy JWT-based keys. Railway services set `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` (mastra-server needs both). Edge Functions read the platform-injected `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` JSON dictionaries through `supabase/functions/_shared/lib/api-keys.ts`. The publishable key falls back to the legacy anon key for local dev; the secret key has no legacy fallback. Keys are selected by name (`PUBLISHABLE_KEY_NAME` / `SECRET_KEY_NAME`, default `default`).

Worktrees: fresh checkouts don't inherit gitignored env files. Run `bun run env:sync` (`scripts/sync-env-from-main.sh`) to copy the three files above from the primary checkout into the current worktree as `.env.local` (Bun auto-loads `.env.local` over `.env`; `env-loader.ts` reads both). Edge Functions don't auto-load `.env.local`; pass it explicitly: `supabase functions serve --env-file supabase/functions/.env.local`.

## Code style

- TypeScript strict, `noUncheckedIndexedAccess`. Use `import type` for type-only imports. Never `as any`.
- Never edit `packages/frontend/src/types/database.types.ts` by hand — it's regenerated by `bun run docker:db:types`. Oxlint/oxfmt ignore this file.
- Single component per file. Compose small. No emojis in code/UI unless asked.
- Tailwind v4 with global CSS file format. No hardcoded colors — use CSS vars (`var(--bg-primary)` etc.) or semantic tokens. Icons: `lucide-react`.
- Conventional Commits, max 72 chars, imperative mood, no period. Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`, `ci`.

### Frontend 4-layer data fetching

1. **`src/services/*.service.ts`** — Supabase client calls, throw on error. No React.
2. **`src/types/`** — types derived from `database.types.ts`.
3. **`src/hooks/`** — TanStack Query hooks (`useQuery` / `useMutation`). Use `queryKeys.*` factories in `lib/query-client.ts`. Always `invalidateQueries` after mutations. Never put Supabase queries in components.
4. **Components** — consume hooks, handle loading/error.

### Realtime

Per `.agents/skills/use-realtime`: use `broadcast` (not `postgres_changes`) for app events. Use private channels (`config: { private: true }`), topic shape `scope:entity` (e.g. `transactions:${user.id}`), snake_case event names. See `src/hooks/useTransactionsRealtime.tsx` for the canonical pattern.

### Supabase Edge Functions (Deno)

- Imports MUST use `jsr:` or `npm:` specifiers, never bare.
- Shared utilities go in `supabase/functions/_shared/`. **No cross-imports between functions** — only into `_shared/`.
- Use `Deno.serve` (never `https://deno.land/std/http/server.ts`).
- **Edge Functions** (Deno): all 12 functions have `verify_jwt = false` in `supabase/config.toml` and do their own auth. Public functions (webhooks, auth-callback, health) use `requireInternalAuth(req)` with `INTERNAL_FUNCTIONS_SECRET`. User functions use `requireUserAuth` then `requireMinRole` and `requireCapability` from `_shared/auth.ts` and `_shared/capabilities.ts`. Keys come from `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` via `_shared/lib/api-keys.ts`.
- `process.env` works (Node compat) — shared modules target both Deno edge functions and the Bun mastra-server.
- File writes only allowed in `/tmp`.

## Domain logic (Gmail + auth)

- OAuth tokens live in `user_oauth_tokens` (access + refresh tokens stored as `*_encrypted` BYTEA, encrypted via pgcrypto with a Vault key; plaintext columns were dropped in `20260708191139_drop_plaintext_oauth_token_columns.sql`).
- Token deactivation is the single point `deactivateTokenAndNotify` in `supabase/functions/_shared/lib/gmail-auth.ts` — it inserts into `token_deactivation_log` first, then flips `is_active`. Always route through this helper.
- Gmail watches live in `gmail_watches`. Renewed daily by the `renew-watches` edge function, called by `public.renew_gmail_watches()` SQL function via pg_cron at 02:00 UTC. Internal call uses `INTERNAL_FUNCTIONS_SECRET`.
- JWT claims: `custom_access_token_hook` injects `user_role` (`user`/`tester`/`admin`) and `user_capabilities` (string array of `payments.capability` enum values: `gmail_sync`, `ai_assistant`, `push_notifications`, `advanced_reports`, `process_documents`, ...). See `docs/access-control.md` for the full access-control matrix.
- The chat/assistant feature is gated by `CHAT_ENABLED` env var (default `true`). When `false`, `/assistant` and `/assistant/:threadId` redirect to `/dashboard` and the sidebar hides the link.
- AI providers: xAI Grok for transaction extraction (edge function pipeline via `transaction-agent.ts`), OpenRouter for the chat agent (`mastra-server/src/mastra/agents/financial-agent.ts`), the chat topic guardrail and the email guardrails. Email guardrails run fixed cascades via OpenRouter's alpha Decisions API: text-only emails go `typesafe/jev-1.13` → Gemini (only on JEV errors; rejections are final) → allow; image emails go `openai/gpt-6-luna-decisions` → allow (`EMAIL_IMAGE_GUARDRAIL_PROVIDER=none` disables the image guardrail). All guardrails fail open. Langfuse traces both.

## Frontend architecture (Bun.serve, not Vite)

- `packages/frontend/src/index.tsx` is the Bun.serve entrypoint. It does HMR + dev HTML serving, plus `/api/config`, `/sw.js`, `/manifest.webmanifest`, and the PWA icons in production. **No Vite, no Webpack.** See `packages/frontend/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc` for the rules.
- `index.html` lives in `src/` and imports `.tsx` directly. Bun handles transpilation and Tailwind via `bun-plugin-tailwind` (loaded in `build.ts`).
- Production build (`bun run build`) scans `src/**.html` as entrypoints, builds the app and a separate `sw.js` (iife, no Tailwind), and copies `public/` to `dist/`. Defines `process.env.NODE_ENV`, `process.env.CHAT_ENABLED`, `__APP_VERSION__`, `__BUILD_TIMESTAMP__` at build time.
- React Router v7 with lazy-loaded pages (`src/routes/index.tsx`). Protected routes wrap `<DashboardLayout />` and gate on `useAuth()`. `PublicOnlyRoute` redirects authenticated users to `/dashboard`.
- CSP is set in `index.tsx` and includes `MASTRA_SERVER_URL` (derived from env) and Cloudflare tunnel hosts for OAuth callbacks.

## Landing (Astro, same service and domain)

- `packages/landing` is a static Astro build (SSG, Tailwind v4 via `@tailwindcss/vite`) served by the frontend's Bun server: `/` (Spanish, canonical) and `/en/` (English), plus its hashed `/_astro/*` assets. `/es` and `/es/` are aliases of `/` (`LANDING_ALIASES` in `src/index.tsx`: same document, canonical pointing at `/`, and the dev proxy rewrites them because `astro dev` only knows the canonical routes). Astro's i18n config uses `prefixDefaultLocale: false`, so Spanish pages live at `src/pages/` and English ones under `src/pages/en/`.
- Landing copy lives in `packages/landing/src/i18n/{es,en}.json` — **not** in the SPA locales. `src/i18n/index.ts` enforces key parity at compile time (`strings` satisfies the Spanish shape).
- No client framework ships: hero/scroll animations are CSS (time-based for entrance, `animation-timeline: view()` for reveals), the app-mock crossfade is a pair of phase-shifted keyframes, and icons are inlined SVG paths generated from lucide (`bun run icons:generate`). The only scripts are two tiny inline ones in `BaseLayout.astro`: the signed-in redirect (mirrors the old `PublicOnlyRoute` behaviour by looking for `sb-*-auth-token` in localStorage) and the language memory (`localStorage.i18nextLng = <this page's locale>`).
- The landing never redirects on its own: `/` is always Spanish and `/en/` always English (a browser-language redirect used to hijack `/`; it was removed because a stored `i18nextLng` — written by the app itself — kept sending Spanish-speaking visitors to `/en/`). Language is a visible choice: the header links to the other locale (`a[hreflang]`), and the page the visitor lands on defines the app's language.
- `packages/theme/theme.css` holds the design tokens (`--primary`, `--accent`, …) imported by both the SPA's `index.css` and the landing's `global.css`. Keep them in sync there, not in two copies.
- `packages/landing/public/` (`logo.svg`, `robots.txt`, `sitemap.xml`, `llms.txt`) is copied to the build output. In production the catch-all serves any landing file automatically; in dev each new public path needs its own route (`/robots.txt`, `/sitemap.xml`, `/llms.txt`, …) in `src/index.tsx`.
- Agent-facing files: `llms.txt` follows the llmstxt.org shape (H1 + link sections). The SPA fallback returns a real 404 (not the shell) for `/.well-known/*`, dotfiles and paths whose extension is machine-readable (`json`, `txt`, `xml`, images, …) — without that, `/ai-catalog.json` answered `200 text/html` and Lighthouse scored the site as having a broken ARD catalog.
- Static responses carry `ETag` (weak: mtime+size) and `Last-Modified`, and answer `If-None-Match`/`If-Modified-Since` with `304` (`serveStaticFile` in `index.tsx`). Cache-Control: `immutable` for `/_astro/*`, `max-age=0, must-revalidate` for the landing HTML (a deploy is picked up immediately) and `max-age=86400, must-revalidate` for its other public files. Bun only does this automatically for a bare `Bun.file()` route value — wrapping the file in a `Response` to add the security headers disables it, which is why the validators are computed by hand.
- Lighthouse on the built landing: performance 100, best practices 100, SEO 100, Agentic Browsing 7/7 applicable audits (WebMCP + ARD are N/A), accessibility 92 — the only failing audit is the footer's `text-[var(--text-secondary)]/60` (2.3:1 contrast), inherited from the React landing.
- The SPA no longer renders a landing: its `/` route redirects to `/dashboard`, and `packages/frontend/public/manifest.webmanifest` opens the PWA at `/dashboard`.

## Mastra server (separate process)

- `packages/mastra-server/src/server.ts` — Hono app with `corsMiddleware`, `authMiddleware`, `GET /health`, `POST /api/seed-emails`, `POST /chat/:agentId`. The `@mastra/hono` adapter owns `/api/agents/*`.
- The Hono app owns the port (`MASTRA_PORT`, default 4111) and route-level CORS; Mastra's own server middleware is bypassed.
- Storage is `PostgresStore` against `SUPABASE_DB_URL`, schema `ai`.
- Tools live in `src/mastra/tools/` (one file per tool: `create-transaction.ts`, `get-spending-summary.ts`, etc.).
- Frontend → mastra-server: `MASTRA_SERVER_URL` in `packages/frontend/.env` (defaults to `http://localhost:4111`).

## Generated / vendored / ignored

- `packages/frontend/src/types/database.types.ts` — generated, ignored by oxlint/oxfmt.
- `packages/frontend/src/components/ai-elements/` — vendored via the `ai-elements` CLI (`pnpm dlx ai-elements@latest add <name>`). Currently used: `prompt-input`, `message`, `conversation`, `suggestion`, `attachments`. These are committed source, not runtime npm imports.
- `packages/frontend/src/components/ui/shadcn/` — vendored shadcn primitives, same model. Pinned by `components.json`.
- `bun.lock` is **gitignored** at the root — `pnpm-lock.yaml` is the lockfile of record. `packages/frontend/bun.lock` is also local-only.
- `*.heapsnapshot` and `.debug/` — debug artifacts, ignored.
- `bruno/**/environments/` and `environments.bru` — local-only, ignored (contain dev secrets and runtime JWTs).

## Production deploy

- GitHub Actions (`.github/workflows/deploy-production.yml`): on push to `main`, `supabase db push --include-all` then `supabase functions deploy`. Validate locally first with `supabase db push --dry-run` (run by `validate-migrations.yml`).
- Production secrets: set edge function secrets via `supabase secrets set --env-file supabase/functions/.env`. `INTERNAL_FUNCTIONS_SECRET` must also be in Vault (`vault.create_secret` / `vault.update_secret`) because `renew_gmail_watches()` reads it from there. See `README.md` "Production secrets checklist" for the full list.
- CORS in production is gated by `CORS_ALLOWED_ORIGINS` and `CORS_ALLOW_CREDENTIALS` env vars on the edge function side; the mastra-server uses `MASTRA_CORS_ORIGIN`.

## Skills

Load these with the `skill` tool when the task matches:

- **commit** — Conventional Commits.
- **create-migration** — `supabase migration new <name>`; new tables must enable RLS; lowercase SQL.
- **create-rls-policies** — granular policies per (role, operation).
- **create-db-functions** — Postgres function style.
- **writing-supabase-edge-functions** — Deno/JSR/npm rules.
- **postgres-sql-style-guide** — naming, casing, snake_case plurals.
- **use-realtime** — `broadcast` over `postgres_changes`; private channels.
- **mastra** — Mastra framework reference; check `ls node_modules/@mastra/` first.
- **supabase-safe-mcp** — restrict Supabase MCP to reads only (no `apply_migration`, no DDL).

## Things agents get wrong

- `package.json` says "npm workspace monorepo" in some legacy copy. It's a **pnpm** workspace (`pnpm-workspace.yaml`, `packageManager: pnpm@11.9.0`). Bun is the _runtime_, not the package manager.
- ESLint is NOT used. Lint/format is **oxlint + oxfmt** (root configs in `.oxlintrc.json`, `.oxfmtrc.json`).
- There are TWO frontend processes, not one: the React app on `:3000` and the mastra-server on `:4111`. They talk via `MASTRA_SERVER_URL`.
- With the landing there are THREE dev processes: the Astro dev server adds `:4321` (and `bun dev` at the root starts all of them).
- `bun run dev` at the root starts both packages in parallel via `pnpm --parallel -r run dev`.
- `docker compose up` is the recommended way to develop — don't try to run `bun dev` on the host without the Supabase CLI.
- The frontend has no Vite. `Bun.serve` + HTML imports + `bun-plugin-tailwind`. Don't suggest `vite.config.*`.
- `deactivateTokenAndNotify` is the only sanctioned way to deactivate OAuth tokens. Direct `UPDATE user_oauth_tokens SET is_active = false` will skip the audit log.
- JWT verification is OFF on all edge functions; the deploy script relies on `config.toml` settings. Don't re-enable `verify_jwt` per-function.
- Migrations are timestamped `YYYYMMDDhhmmss_<name>.sql`. Don't hand-number them.
- `bun.lock` is not tracked. `pnpm-lock.yaml` is.
- Bun only accepts a dev `HTMLBundle` (an imported `.html` module) as the **direct value** of a route — returning it from a sync _or_ async handler makes Bun fall back to "Welcome to Bun!". That's why the SPA shell is the `"/*"` value in dev and the landing paths are their own routes in `src/index.tsx`.
- The landing's `/` is not an SPA route anymore: don't add a React landing back, and use a plain `<a href="/">` (not `<Link to="/">`) when linking to it from the app.
- The landing is served from `packages/landing/dist`; if you edit landing source without rebuilding (and without `LANDING_DEV_URL`), the browser keeps showing the previous build.
