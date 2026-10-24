# Access control matrix

This document is the source of truth for what blocks what in the
app. Two orthogonal systems cooperate to gate features:

1. **Roles** (`public.app_role` enum: `user`, `tester`, `admin`) — staff /
   internal access. Lives in the JWT as the `user_role` claim (set by
   `public.custom_access_token_hook`).
2. **Capabilities** (`payments.capability` enum: `gmail_sync`,
   `ai_assistant`, `push_notifications`, `advanced_reports`,
   `process_documents`) — product features by subscription tier. Lives
   in `payments.plan_capabilities` and is mirrored into the JWT as the
   `user_capabilities` claim.

A user can be `admin` with no paid plan (staff) or a paid user with
`role: "user"` (product). Both gates can run in series on the same
request.

## How gating works

### Server (edge functions)

Every user-facing edge function calls both helpers right after
`requireUserAuth`:

```ts
const auth = await requireUserAuth(req, corsHeaders);
if (auth instanceof Response) return auth;

const roleCheck = requireMinRole(auth, "gmailConnect", corsHeaders);
if (roleCheck instanceof Response) return roleCheck;

const cap = await requireCapability(auth, "gmail_sync", corsHeaders);
if (cap instanceof Response) return cap;
```

`requireMinRole(auth, "<featureKey>", ...)` receives the feature key
(not the role literal) and looks up the required role from
`supabase/functions/_shared/features.ts#FEATURES`. That lookup is the
contract that keeps the backend in sync with the frontend: the
backend has its own copy of the `FEATURES` map (mirrored from
`packages/frontend/src/lib/features.ts`), and the helper compares
`auth.role` (read from the JWT) against the looked-up value. The
helper is synchronous — no DB hit.

`requireCapability` is async and re-queries
`payments.subscriptions` + `payments.plan_capabilities` so it reflects
subscription state changes immediately, without waiting for a JWT
refresh.

The 403 error messages are the contract that the frontend classifier
matches against:

- `requireMinRole` → `"Requires role '<required>'"` (where `<required>`
  is the value the helper looked up from `FEATURES`, not the key).
- `requireCapability` → `"Requires capability: <key>"`.

### Role bypass for capabilities

`requireCapability` short-circuits when the caller's role is
`admin` or `tester` (the same `ROLE_BYPASS` set lives in both
`supabase/functions/_shared/capabilities.ts` and
`packages/mastra-server/src/lib/capabilities.ts`). The bypass:

- Skips the DB roundtrip entirely.
- Logs an info-level entry so observers can distinguish
  subscription-granted access from staff-bypassed access:
  `[requireCapability] role bypass for <capability> by <role> (user <uuid>)`.
- Returns `allowed: true` for both `requireCapability` and
  `getUserCapabilities`. `getUserCapabilities` for a staff user
  returns the full `CAPABILITIES` enum (every capability), so a tool
  that branches on `hasCapability("advanced_reports")` keeps
  working even without a subscription row.

The hierarchy `user(0) < tester(1) < admin(2)` already makes staff
roles pass any `requireMinRole` minimum — the bypass is the
capability-side equivalent of the same "staff can do anything"
intent. Today both layers honor it; the only difference is that
the role middleware is synchronous (JWT-only) and the capability
bypass is also synchronous (constant-time set lookup).

### Frontend

The hook `useFeatureAccess(key)` reads from
`packages/frontend/src/lib/features.ts#FEATURES` (the role map). The
hook `useCapability(key)` reads the JWT claim directly. Both expose an
`allowed: boolean` for UI to branch on — currently no component
consumes them (Phase 2 will add per-feature banners).

When an edge function rejects with one of the two 403 messages above,
`packages/frontend/src/utils/edge-function-errors.ts#getEdgeFunctionErrorMessage`
substitutes the localized `"This is a premium feature"` toast instead
of the raw error. See `packages/frontend/src/i18n/locales/{en,es}.json#errors.premiumFeature`.

## Roles matrix

`FEATURES` source of truth:
`packages/frontend/src/lib/features.ts#FEATURES`.

| `FEATURES` key    | Current value | Connected edge function                      | Frontend page/action                    | Purpose                                                                                    |
| ----------------- | ------------- | -------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `seed`            | `user`        | (none — mastra-server `/api/seed-emails`)    | Settings → "Import emails" modal        | Bulk-import historical emails from Gmail. Likely candidate to flip to `tester` (dev tool). |
| `chat`            | `user`        | (none — chat runs in mastra-server)          | `/assistant` route                      | AI assistant chat surface.                                                                 |
| `metrics`         | `user`        | (none — direct supabase reads)               | `/metrics` route, sidebar link          | Spending analytics and reports.                                                            |
| `transactions`    | `user`        | (none — direct supabase reads)               | `/transactions` route, sidebar link     | Transaction list and CRUD.                                                                 |
| `subscriptions`   | `user`        | `create-subscription`, `cancel-subscription` | `/account/billing`, `/subscriptions`    | Subscription management.                                                                   |
| `settings`        | `user`        | (none — direct supabase reads)               | `/settings` route, sidebar link         | Account and integrations settings.                                                         |
| `processDocument` | `user`        | `process-document`                           | "Upload receipt" modal                  | Receipt/image OCR → transaction.                                                           |
| `gmailConnect`    | `user`        | `gmail-disconnect`                           | Settings → "Connect Gmail" / disconnect | Gmail OAuth lifecycle.                                                                     |

All values are `user` today, which means the middleware accepts every
caller. The wiring is in place so flipping any value to `tester` or
`admin` activates the gate end-to-end without further code changes.

### How to flip a value

1. Edit `FEATURES.<key>` in **both** `packages/frontend/src/lib/features.ts`
   and `supabase/functions/_shared/features.ts`. The two copies must
   stay in sync — there is no compiler-enforced link between them.
2. Done. The next deploy picks it up.

### How the gate surfaces to the user

Phase 1 (this PR):

- User triggers a gated edge function.
- Server returns 403 with `"Requires role 'X'"` or
  `"Requires capability: X"`.
- Frontend classifier substitutes the `"This is a premium feature"`
  toast.

Phase 2 (follow-up):

- Add `useFeatureAccess(key)` / `useCapability(key)` consumption in
  the relevant components.
- Render an inline banner above each gated surface with feature-specific
  upsell copy.

## Capabilities matrix

The capability grant has three layers. Each is a separate source
that contributes to the final set; the union is what `requireCapability`
sees and what `custom_access_token_hook` writes into the
`user_capabilities` JWT claim.

1. **Default grants** (`payments.default_capabilities`) — every
   authenticated user. The table starts empty; rows are inserted
   manually (e.g. `INSERT INTO payments.default_capabilities VALUES
   ('ai_assistant')`) to give a capability to all users without a
   subscription. Used for the free-tier surface.
2. **Plan grants** (`payments.plan_capabilities`) — each row ties a
   `plan_id` to a capability. Granted per plan in the seed
   (`supabase/seeds/006_payments_demo.sql` section 4) or via the
   bruno collection.
3. **Role bypass** (`ROLE_BYPASS = {admin, tester}`) — staff and
   developers get every capability regardless of subscription. See
   the "Role bypass for capabilities" subsection above.

The two data sources are combined by `payments.user_capabilities_v`
(a SQL `UNION` view). `null` `user_id` rows from the default branch
match every user; the active-subscription branch contributes
per-user grants. The view deduplicates. `requireCapability` queries
the view with `.or(user_id.eq.<uuid>, user_id.is.null)` so a single
roundtrip returns the union.

`payments.capability` enum is the vocabulary. The five values today:

| Capability           | Gated by                                        | Default (free)? | Paid plans (lite_monthly)? |
| -------------------- | ----------------------------------------------- | --------------- | -------------------------- |
| `gmail_sync`         | `gmail-disconnect`                              | —               | ✓                          |
| `ai_assistant`       | (mastra-server chat handler)                    | —               | ✓                          |
| `push_notifications` | (none yet — backend hook to be added)           | —               | ✓                          |
| `advanced_reports`   | (none yet — `/metrics` route guard to be added) | —               | ✓                          |
| `process_documents`  | `process-document`                              | —               | ✓                          |

The "Default" column is empty by default. To grant a capability to
all free users, insert it into `payments.default_capabilities`:

```sql
INSERT INTO payments.default_capabilities VALUES ('ai_assistant');
```

That single statement makes every authenticated user (with or
without a subscription) get `ai_assistant` in their JWT claim, and
the `process-document` / `gmail-disconnect` / chat endpoints stop
rejecting them on that capability. No code change needed.

## Adding a new capability

1. Add the value to the enum in
   `supabase/migrations/20260705031212_add_plan_capabilities.sql`.
2. Add it to `CAPABILITIES` in **all three** copies:
   `packages/frontend/src/lib/capabilities.ts`,
   `supabase/functions/_shared/capabilities.ts`, and
   `packages/mastra-server/src/lib/capabilities.ts`.
3. Call `requireCapability(auth, "<key>", corsHeaders)` in the
   relevant edge function (or `requireCapability({userId,
   supabaseToken, role}, "<key>")` in mastra-server routes).
4. Add the grant for the demo `lite_monthly` plan in the seed section
   4 of `006_payments_demo.sql`.
5. If the capability is AI-backed and should be usage-capped, add a
   row to `payments.usage_limits` (see "Usage limits" below) and a
   `check_and_increment_usage` call before the AI invocation.

## Modifying the role bypass

The bypass set lives as `ROLE_BYPASS` in both
`supabase/functions/_shared/capabilities.ts` and
`packages/mastra-server/src/lib/capabilities.ts`. To add or remove
roles:

1. Edit the `ROLE_BYPASS` set in both files (keep them in sync — the
   mastra-server can't import from the supabase one because they run
   in different runtimes).
2. Update `docs/access-control.md` to reflect the new policy.

The bypass applies to **all** capabilities uniformly; if you need
per-capability bypass (e.g. only admin bypasses `process_documents`
but tester doesn't), promote the check from a constant set to a
per-capability decision table and document it in
`docs/access-control.md`.

## Adding a new role-gated feature

1. Add the entry to `FEATURES` in **both**
   `packages/frontend/src/lib/features.ts` and
   `supabase/functions/_shared/features.ts` with value `"user"`.
2. Call `requireMinRole(auth, "<newKey>", corsHeaders)` in the
   relevant edge function (pass the feature key, not the role
   literal).
3. (Phase 2) Wire `useFeatureAccess("<newKey>")` in the consuming
   component for inline banners.

## Usage limits

The capability gate answers "is this user allowed to use this feature
at all?". Usage limits answer "how many times per period?". The two
cooperate: capability gate returns 403 when not allowed at all,
usage cap returns 429 when allowed but rate-limited. So a tester can
use `ai_assistant` (capability gate passes via role bypass) but
only 200 times per calendar month (usage cap enforces the budget).

### Data model

- `payments.usage_limits` — configuration. One row per
  `(capability, scope, period)`. `scope` is one of:
  - `role:<role>` (e.g. `role:tester`)
  - `plan:<plan_key>` (e.g. `plan:lite_monthly`)
  - `default` (fallback)
    Resolution order: role → plan → default. An absent default row
    means callers are rejected (count 0) for that capability — fail-
    closed for unknown capabilities is intentional (a deployment
    mistake, not a license to spam).
- `payments.usage_counters` — counter. One row per
  `(user_id, capability, period_start)`. `period_start` is
  `date_trunc('month', now())` for `'month'`,
  `date_trunc('day', now())` for `'day'`. Implicit reset each
  period boundary — no cron, no manual reset.

### Rpcs

- `payments.resolve_usage_limit(target_user_id uuid, cap text, period text default 'month') returns int`
  — SECURITY DEFINER. Looks up the role → plan → default chain.
- `payments.check_and_increment_usage(target_user_id uuid, cap text, period text default 'month') returns table(allowed boolean, remaining int, limit_value int)`
  — SECURITY DEFINER, volatile. Atomic upsert + check + rollback
  on over-limit. Both rps live in `payments`; consumers must call
  them with `supabase.schema('payments').rpc(...)` so postgrest
  sends the `Accept-Profile` / `Content-Profile` headers that let
  it resolve the schema (see https://docs.postgrest.org/en/v12/references/api/schemas.html).

### Wire-up (in the mastra-server chat handler and supabase edge

functions)

After the capability gate, the same call site does:

```ts
if (userRole !== "admin") {
  const { data: usage, error: usageError } = await supabase
    .schema("payments")
    .rpc("check_and_increment_usage", { target_user_id, cap: "ai_assistant" });
  if (usageError) {
    // fail-open: a counter bug should not break paying users
    console.error("usage check failed; failing open", usageError);
  } else if (!usage?.[0]?.allowed) {
    return c.text("Usage limit exceeded: ai_assistant", 429);
  }
}
```

- `admin` skips the cap (effectively unlimited). `tester` is
  counted — this matches the product decision: testers are dev
  staff who need to be able to test without hitting a wall, but
  the cap on `ai_assistant` at 200 messages is the whole point.
- Failure mode: rpc error → fail-open. We log the error and let
  the call through. Rationale: a counter bug should not break
  paying users.

### Frontend

The 429 body uses the prefix `Usage limit exceeded: <capability>`.
The `edge-function-errors` classifier already matches on that prefix
and substitutes `t("errors.usageLimitExceeded")` =
"You've hit the monthly limit for this feature. Upgrade your plan
to continue." The same 3 callers that surface the capability
toast (AccountBilling × 2, Settings, UploadTransactionModal) and
the chat's `getEdgeFunctionErrorMessage` path all surface the usage
toast without any per-caller change.

### Seeded matrix (from

`supabase/migrations/20260705163606_add_usage_limits_and_counters.sql`)

| capability          | scope         | period  | max_count |
| ------------------- | ------------- | ------- | --------- |
| `ai_assistant`      | `role:tester` | `month` | 200       |
| `ai_assistant`      | `default`     | `month` | 50        |
| `process_documents` | `role:tester` | `month` | 50        |
| `process_documents` | `default`     | `month` | 5         |
| `gmail_sync`        | `role:tester` | `month` | 1000      |
| `gmail_sync`        | `default`     | `month` | 100       |

To add a per-plan override (e.g. `lite_monthly` gets 1000 messages
on `ai_assistant`):

```sql
insert into payments.usage_limits (capability, scope, period, max_count)
values ('ai_assistant', 'plan:lite_monthly', 'month', 1000);
```

The plan row resolves before the default for users on `lite_monthly`.

### gmail_sync call sites

`gmail_sync` is in the matrix and the per-email counter wire-up
lives in `supabase/functions/_shared/lib/usage-counter.ts`
(`incrementGmailSyncUsage`). The helper is shared by both Gmail
processing pipelines:

- `packages/mastra-server/src/services/seed-emails/seed-emails.processor.ts`
  inside `processSingleMessage` — backfill path (3-month scan
  when the user first connects Gmail).
- `supabase/functions/gmail-webhook/index.ts` — real-time path
  (Pub/Sub push on every new INBOX message).

In both pipelines the increment fires AFTER the email produces a
persisted row (a `public.transactions` insert OR a
`public.discarded_emails` insert). SPAM/TRASH labels, AI failures,
and duplicate-messageId early-returns do NOT burn quota.

Multi-user semantics (webhook only): the webhook processes one
email for every active `user_oauth_tokens` row matching the Gmail
address. Each user in `validTokens` gets +1 on their counter
independently of the unique-`source_message_id` race that only
lets one transaction row land. The role lookup is a single
`select user_id, role from user_roles where user_id in (…)` round
trip and is fail-closed to `"user"` (no accidental admin bypass).

Failure mode: the helper fail-opens on RPC errors (matches
`process-document` and `chat`). Role bypass: only `admin`
short-circuits; `tester` is counted normally — this matches the
three other call sites and diverges from the broader ROLE_BYPASS
in `supabase/functions/_shared/capabilities.ts` which covers the
capability gate (a different concern). Integration coverage lives in
`supabase/functions/_shared/seed-emails-usage.integration.test.ts`
(runner: `bun run test:seed-emails-usage`).

### Follow-up: counter cleanup

`payments.usage_counters` accumulates one row per
(user, capability, period_start). Rows never get deleted. A cron
`delete from payments.usage_counters where period_start < now() - interval '3 months'`
keeps the table bounded. Out of scope for this PR.

## Route-level admin gating (`/admin/*`)

The admin panel lives inside the existing frontend SPA at `/admin/*` and
gates on the same `user_role` JWT claim as the rest of the access
control story. Implementation contract:

- **Route guard.** `<AdminRoute>` in
  `packages/frontend/src/routes/index.tsx` checks `useAuth().role` and
  redirects non-admins to `/dashboard` and unauthenticated users to
  `/login`. The guard is the only thing standing between a non-admin
  and an admin RPC — every RPC under the `payments.admin_*` family
  enforces the same check server-side (SECURITY DEFINER with an inline
  guard) so a stale token or a direct postgrest call cannot bypass it.
- **Sidebar link.** `Sidebar.tsx` only injects the `Admin` link when
  `role === "admin"`. The link is not in the static `links` array so
  it cannot leak via a stale translation file or a cache hit.
- **RPCs.** `payments.admin_list_users`, `payments.admin_get_user`,
  `payments.admin_set_user_role`, `payments.admin_list_subscriptions`,
  `payments.admin_cancel_subscription`, `payments.admin_list_payment_events`,
  `payments.admin_list_seeds`, `payments.admin_retry_seed`,
  `payments.admin_stats`, `payments.admin_usage_limits`,
  `payments.admin_user_usage_summary`, `payments.admin_usage_top_consumers`.
  Every one starts with the same admin guard — raise a `42501` if the
  caller does not have `role = 'admin'` in `public.user_roles`. The
  guard is intentionally duplicated per function (not extracted into a
  helper) so each function is self-contained and reviewable; the
  duplication is the security boundary.
- **Mutations.** `admin_set_user_role` blocks self-edits
  (`p_user_id = auth.uid()` raises `42501`). `admin_cancel_subscription`
  updates the local `payments.subscriptions.status` to
  `cancelled | paused | pending_cancellation`; `cancelled` also sets
  `access_until = now()` so the revoke is immediate and survives a
  webhook retry. The provider-side reconciliation is the
  `payments-webhook` job — this is best-effort UX for the panel, not a
  substitute for the webhook.
- **Seed retry.** `admin_retry_seed` resets a `failed`/`completed`
  seed row to `pending` and returns `(seed_id, connection_id, user_id)`.
  The frontend then calls `mastra-server /api/seed-emails` with the
  connection id to actually re-run the processor.

The `payments.admin_*` family is intentionally not added to
`FEATURES` — that map is for role-gated _edge functions_, and the admin
panel is a route-level concern (not an edge function call site). Keep
the FEATURES map focused on the back end.

## Related references

- `supabase/functions/_shared/auth.ts` — `requireMinRole`,
  `hasMinRole`, `UserRole`.
- `supabase/functions/_shared/features.ts` — backend mirror of the
  `FEATURES` map + `FeatureKey` type.
- `supabase/functions/_shared/capabilities.ts` — `requireCapability`,
  `CAPABILITIES`, `Capability`.
- `supabase/migrations/20260705163606_add_usage_limits_and_counters.sql`
  — `usage_limits`, `usage_counters`, `resolve_usage_limit`,
  `check_and_increment_usage`.
- `packages/frontend/src/lib/features.ts` — frontend `FEATURES`,
  `FeatureKey`, `canAccess`.
- `packages/frontend/src/lib/capabilities.ts` — `CAPABILITIES`,
  `Capability`.
- `packages/frontend/src/utils/edge-function-errors.ts` — classifier
  - premium-feature substitution.
- `supabase/migrations/20260625125528_add_user_roles_and_access_token_hook.sql`
  — `app_role` enum + JWT hook for `user_role`.
- `supabase/migrations/20260705031212_add_plan_capabilities.sql` —
  `payments.capability` enum + table.
- `supabase/migrations/20260705031217_add_user_capabilities_to_jwt.sql`
  — JWT hook extension for `user_capabilities`.
- `supabase/migrations/20260720234327_add_admin_rpcs.sql` — the
  `payments.admin_*` family + the route-level admin gating contract.
- `packages/frontend/src/services/admin.service.ts` — typed RPC
  wrappers for the `admin_*` family.
- `packages/frontend/src/components/admin/AdminShell.tsx` — tabs +
  page-header for every admin page.
- `packages/frontend/src/routes/index.tsx` — `<AdminRoute>` guard
  (reads `useAuth().role`, redirects non-admins).
