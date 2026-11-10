<!--
Sync Impact Report
==================
Version change: (none) -> 1.0.0 (initial ratification)
Modified principles: n/a (no prior constitution)
Added sections:
  - Core Principles I-VI
  - Technical Constraints
  - Development Workflow and Quality Gates
  - Governance
Removed sections: none
Follow-up TODOs: none
Notes:
  - The scaffold's five generic principle slots were expanded to six named
    principles derived from AGENTS.md, README.md and docs/access-control.md.
  - All bracketed template tokens were replaced; no unresolved placeholders.
-->

# Receiptle Constitution

## Core Principles

### I. Layered Data Access (NON-NEGOTIABLE)

Every client data path MUST follow the four layers in order:

1. `src/services/*.service.ts` — Supabase calls only, throw on error, no React.
2. `src/types/` — types derived from the generated `database.types.ts`.
3. `src/hooks/` — TanStack Query hooks, using `queryKeys.*` factories from
   `src/lib/query-client.ts`; every mutation MUST invalidate the queries it
   affects.
4. Components — consume hooks, handle loading and error states.

Components MUST NOT call Supabase directly, and ad-hoc Supabase queries MUST
NOT appear outside a service module. Application events MUST use private
Supabase `broadcast` channels with topic shape `scope:entity`
(e.g. `transactions:${user.id}`); `postgres_changes` MUST NOT be used for app
events.

Rationale: a single seam per data concern keeps query evolution, caching and
invalidation reviewable in one place, and keeps components testable.

### II. Security and Access Control by Default (NON-NEGOTIABLE)

- Every new table MUST enable Row Level Security in the migration that creates
  it, with granular policies per (role, operation). A table MUST NOT ship
  without policies.
- Every user-facing Edge Function MUST run `requireUserAuth`, then
  `requireMinRole` and `requireCapability` where the feature is gated. Public
  functions MUST use `requireInternalAuth`. `verify_jwt` MUST remain `false`;
  each function performs its own authentication.
- Authorization behavior MUST match `docs/access-control.md`. The frontend
  `FEATURES` map and its backend mirror MUST change in the same commit.
- OAuth access and refresh tokens MUST be persisted only in the encrypted
  `*_encrypted` columns (pgcrypto with a Vault key). Token deactivation MUST
  go through `deactivateTokenAndNotify` so `token_deactivation_log` is written
  before `is_active` is flipped.
- Secrets MUST NOT be committed, logged, or returned in responses.
  `INTERNAL_FUNCTIONS_SECRET` MUST match between the functions environment and
  Vault.

Rationale: financial data and inbox access make a missing check a data breach,
not a bug.

### III. Type Safety and Static Verification (NON-NEGOTIABLE)

- TypeScript MUST stay `strict` with `noUncheckedIndexedAccess` enabled.
  `as any` MUST NOT appear in source; type-only imports MUST use `import type`.
- `packages/frontend/src/types/database.types.ts` MUST be regenerated with
  `bun run docker:db:types` and MUST NOT be edited by hand.
- oxlint and oxfmt are the only lint and format toolchain. ESLint, Prettier and
  competing formatters MUST NOT be introduced.
- `bun run check` and `bun run typecheck` MUST pass before a branch is pushed.
  `packages/mastra-server` MUST pass its own `bun run typecheck`.

Rationale: the generated schema is the contract between Postgres, the Edge
Functions and the UI; drift there produces silent runtime failures.

### IV. AI Outputs Are Contracts

- Every AI boundary that writes data MUST validate the model response with a
  Zod schema before persistence. Unvalidated output MUST NOT reach the database.
- Provider roles are fixed: xAI Grok for transaction extraction, OpenRouter for
  chat and guardrails. Model calls MUST live inside the existing agent and tool
  modules, never in components or route handlers.
- Guardrails MUST fail open. The documented cascade order MUST be preserved:
  text emails `typesafe/jev-1.13` then Gemini only on JEV provider errors
  (rejections are final); image emails `openai/gpt-6-luna-decisions`.
- Prompt or model changes MUST be run against the labeled corpus with
  `bun run test:guardrail:comparison` and the result recorded in the PR.
- Every AI operation MUST be traced in Langfuse.

Rationale: model output is untrusted input. Schemas, fixed cascades and traces
are what make extraction debuggable and safe to leave running unattended.

### V. Observability and Auditability

- User-visible AI and integration failures MUST be reported with context
  (function, stage, error type); the frontend reports through `src/lib/sentry.ts`.
- Irreversible state changes MUST leave an audit trail. Silent `UPDATE`
  statements against integration state are prohibited.
- Logs MUST be structured and MUST NOT contain tokens, secrets, full email
  bodies, or other personal data beyond what the operation requires.

Rationale: background pipelines fail without a user watching. The audit trail
is the only way to explain why a connection stopped working.

### VI. Reuse the Existing Stack

- The runtime, package manager, bundler, test runner and UI primitives already
  in the repository MUST be used. Introducing a new one requires a constitution
  amendment.
- Bun is the runtime and pnpm is the package manager. The frontend is served by
  `Bun.serve`; Vite, Webpack and equivalent bundlers MUST NOT be added.
- Vendored code (`src/components/ai-elements/`, `src/components/ui/shadcn/`) is
  committed source and MUST be modified in place rather than replaced by a new
  dependency.
- New abstractions MUST be justified by a present requirement. Speculative
  layers, configuration and indirection MUST NOT be added.

Rationale: the stack is unusual by design (Bun + pnpm + Supabase); a second
tool for the same job doubles maintenance and breaks the documented workflow.

## Technical Constraints

- **Workspace**: pnpm workspace with `packages/frontend` (React 19 SPA served by
  Bun), `packages/landing` (Astro SSG served by the frontend at `/` and `/en/`),
  `packages/mastra-server` (Hono on port 4111) and `packages/theme` (shared
  design tokens).
- **Backend**: Supabase Postgres, Auth, Realtime and Deno Edge Functions.
  Deno imports MUST use `jsr:` or `npm:` specifiers. Shared code lives in
  `supabase/functions/_shared/`; Edge Functions MUST NOT import from each other.
- **Styling**: Tailwind CSS v4 with design tokens from `packages/theme/theme.css`.
  Hardcoded colors MUST NOT be used; use CSS variables or semantic tokens.
- **Migrations**: files are `supabase/migrations/<YYYYMMDDhhmmss>_<name>.sql`,
  created with `supabase migration new`. Timestamps MUST NOT be hand-numbered.
  SQL MUST be lowercase snake_case.
- **Environment files**: the three env files (`packages/frontend/.env`,
  `supabase/functions/.env`, `packages/mastra-server/.env`) MUST stay separate.
  They MUST NOT be consolidated, and none may be committed.
- **Local development**: runs through Docker Compose. Bun and the Supabase CLI
  MUST NOT be required on the host.
- **Production**: deploys from `main` via GitHub Actions, applying migrations
  with `supabase db push --include-all --remote --yes` and deploying all Edge
  Functions. Migrations MUST be validated locally with
  `db push --dry-run --remote` first. The Supabase CLI is pinned to `3.1.0`;
  under v3 `db push` defaults to the local stack, so `--remote` is mandatory.

## Development Workflow and Quality Gates

- **Before push**: `bun run check` (lint + format check), `bun run typecheck`,
  and the relevant test suite MUST pass. CI runs `bun install`, `bun run lint`
  and the frontend build; a red pipeline blocks merge.
- **Tests**: changes to transaction extraction MUST run
  `bun run test:grok:transaction-agent`. Changes to guardrails MUST run
  `bun run test:guardrail:comparison`. Auth flows MUST be covered by the
  Stagehand E2E tests in `packages/frontend/tests/`.
- **Commits**: Conventional Commits, imperative mood, maximum 72 characters,
  no trailing period. Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`,
  `chore`, `ci`.
- **Schema changes**: a new migration MUST be accompanied by regenerated
  `database.types.ts` and by RLS policies in the same migration.
- **Review**: a reviewer MUST verify that the change respects the principles
  above; any deviation MUST be called out in the PR description with its
  justification. Complexity that cannot be justified MUST be removed.
- **Agent guidance**: `AGENTS.md` is the operational handbook. When it
  conflicts with this constitution, the constitution prevails and `AGENTS.md`
  MUST be corrected.

## Governance

This constitution supersedes other development practices in the repository.
Where a convention in `AGENTS.md`, a README, or a package script disagrees, the
constitution wins until it is amended.

- **Amendments**: proposed as a pull request that modifies only
  `.specify/memory/constitution.md`, states the motivation, and includes a Sync
  Impact Report. Approval requires maintainer review and a passing CI run.
- **Versioning**: semantic versioning. MAJOR for removed or redefined
  principles and backward-incompatible governance changes. MINOR for a new
  principle or section, or materially expanded guidance. PATCH for wording,
  clarification and typo fixes that do not change obligations.
- **Compliance review**: every PR review MUST check the change against these
  principles. Repeated or unaddressed violations MUST be raised as an amendment
  or fixed; they MUST NOT be normalized by precedent.
- **Guidance files**: `docs/access-control.md` is the source of truth for the
  role and capability matrix, and MUST be updated with any authorization change.

**Version**: 1.0.0 | **Ratified**: 2026-11-09 | **Last Amended**: 2026-11-09
