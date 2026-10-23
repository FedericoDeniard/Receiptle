# bruno/payments

provider-agnostic billing webhooks. the only provider registered today is
`mercadopago`; the collection covers the contract that any new provider
(e.g. `stripe`) must satisfy to slot in:

- `payments-webhook/<provider>` accepts POST webhooks with a
  provider-specific signature header. the router dispatches to the
  provider implementation, persists the raw event in
  `subscription_events`, and upserts normalized state in `subscriptions`.
- `create-subscription` is a privileged internal endpoint (auth via
  `INTERNAL_FUNCTIONS_SECRET`) that creates a subscription through the
  provider and returns an `init_point` for the buyer to complete checkout.
- `cancel-subscription` is a user-authenticated endpoint that cancels
  the calling user's active subscription.

## data model

billing state is split into two related tables so a single plan can be
enabled on multiple providers at different prices:

- `payments.plans` (provider-agnostic) — one row per logical plan
  concept. carries `plan_key`, `display_name`, `internal_tier`, and
  the recurrence definition (`frequency`, `frequency_type`, `trial_days`).
  no price, no currency, no provider.
- `payments.plan_provider_variants` (relational) — one row per
  `(plan_id, provider)` pair. carries the `provider_plan_id` (the
  remote id in the provider's system) plus the `amount` and `currency`
  in the provider's representation. presence of a row means the plan is
  enabled on that provider. a `unique (plan_id, provider)` constraint
  guarantees one price per plan per provider.
- `payments.subscriptions` — one row per (user, provider, plan)
  instance, referencing the plan via `plan_id` and the provider via
  `provider_subscription_id`.
- `payments.plan_capabilities` (capability grants) — one row per
  `(plan_id, capability)` pair. capabilities are a fixed vocabulary
  (check constraint over `gmail_sync`, `ai_assistant`,
  `push_notifications`, `advanced_reports`) that the codebase uses to
  gate features: `requireCapability` in edge functions joins this
  table to `subscriptions` and rejects callers whose plan does not
  include the requested capability. plans are decoupled from this
  list — adding a capability is a deliberate product decision that
  ships with a migration.

## running locally

1. `supabase start` (supabase + edge functions)
2. fill in `bruno/payments/environments/local.bru`:
   - `mpAccessToken`: your APP_USR- test token from
     https://www.mercadopago.com.ar/developers/panel/app
   - `webhookSecret`: the secret from
     Tus Integraciones → Webhooks → Configurar notificaciones
   - `supabasePublishableKey`: the publishable key (`sb_publishable_...`)
     printed by `supabase status` under **Authentication Keys**. If your local
     stack still uses legacy keys, the local `anon` key also works, but prefer
     the publishable one.
   - `supabaseSecretKey`: the secret key (`sb_secret_...`) printed by
     `supabase status` under **Authentication Keys**. If your local stack still
     uses legacy keys, the local `service_role` key also works, but prefer the
     secret one.
   - `loginEmail` / `loginPassword`: credentials of a test user (by
     default the seed is `user@test.com` / `password123` from
     `supabase/seeds/001_auth_test_user.sql`)

   The environment file is gitignored. If it still has the old variable names,
   rename `supabaseAnonKey` → `supabasePublishableKey` and
   `supabaseServiceRoleKey` → `supabaseSecretKey`.

   Use the keys from the **local** stack only. Production keys will return
   401 against `127.0.0.1:54321`.

3. login in bruno (one-time per session):
   - run `0. login` in the `auth/` folder
   - the request uses `loginEmail` / `loginPassword` from the env
   - on success, `userJwt` env var is populated for the rest of the
     run
4. start a cloudflare tunnel:
   `cloudflared tunnel --url http://127.0.0.1:54321`
5. in bruno select the `tunnel` environment and update its `baseUrl` to
   the tunnel address printed by cloudflared.
6. set `MP_NOTIFICATION_URL` in `supabase/functions/.env` to the tunnel
   address suffixed with `/functions/v1/payments-webhook/mercadopago`.
   (MP does not support configuring subscriptions webhooks via the panel;
   the notification URL must be set at payment creation time via
   `notification_url` in the POST /preapproval body.)

## auth

requests that touch the database via postgrest (`/rest/v1/<table>`) need
two special http headers in addition to the standard apikey / bearer
headers. without them, postgrest looks for the table in the default
schema (`public`) and returns `PGRST205 could not find the table`.
the `payments` schema is exposed via postgrest, but postgrest needs an
explicit `Accept-Profile` (for reads) or `Content-Profile` (for
writes) header to know which schema to query. this matches the
behaviour of supabase-js's `client.schema('payments')...` which adds
the same headers automatically.

in this collection, plan-management requests that hit postgrest use
one of two patterns:

- **reads (GET)** with `Accept-Profile: payments` and the `userJwt`
  bearer captured at login. the `userJwt` is the same access_token a
  real user gets when calling `supabase.auth.signInWithPassword` from
  the app, so the queries run as the `authenticated` role with full
  rls context.

- **writes (POST)** with `Content-Profile: payments` and the
  `supabaseSecretKey` bearer. writing to `payments.plans` and
  `payments.plan_provider_variants` is an admin operation, not a
  user-facing action, so it goes through `service_role` which bypasses
  rls. the secret key is a Supabase project secret and should
  only be used in trusted tooling like this bruno collection.

the only request that runs as a real user is `subscriptions/cancel
subscription (edge)`, which uses the `userJwt` because it deletes
the caller's own subscription.

## test cards (MLA)

- approved: 4509 9535 6623 3704, cvv 123, exp 12/30, doc 12345678
- rejected: 5031 7557 3253 2671

## structure

requests are organised by billing domain into three folders. every
action verb is paired with an explicit destination so the name alone
is unambiguous: "in MP" means it hits mercado pago's api directly,
"in DB" means it hits our `payments.plans` or `plan_provider_variants`
table.

| folder           | request                           | what it does                                                                                                                                                                      |
| ---------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/`          | `0. login`                        | logs in via supabase auth (email + password). captures the access_token into the `userJwt` env var.                                                                               |
| `plans/`         | `create plan in MP`               | creates a plan in mp via api. saves `{{mpPlanId}}` to the env.                                                                                                                    |
| `plans/`         | `list plans in MP`                | lists the plans in your mp account.                                                                                                                                               |
| `plans/`         | `get plan in MP`                  | reads a single plan from mp by id.                                                                                                                                                |
| `plans/`         | `update plan in MP`               | partial update of a plan in mp. body may include `reason`, `back_url`, and any subset of `auto_recurring` (frequency, amount, currency, free_trial).                              |
| `plans/`         | `create plan variant in DB`       | registers a `(plan, provider)` variant — the price for the plan on a specific provider. presence of this row enables the plan on that provider. (writes use `supabaseSecretKey`.) |
| `plans/`         | `list plan variants in DB`        | lists all variants of a given plan across providers. (reads use `userJwt` + `Accept-Profile: payments`.)                                                                          |
| `plans/`         | `create plan in DB`               | registers a plan concept in `payments.plans` (no price, no provider). (writes use `supabaseSecretKey`.)                                                                           |
| `plans/`         | `list plans in DB`                | lists all plans in `payments.plans`. (reads use `userJwt` + `Accept-Profile: payments`.)                                                                                          |
| `plans/`         | `get plan in DB`                  | reads a single plan from `payments.plans`. (reads use `userJwt` + `Accept-Profile: payments`.)                                                                                    |
| `plans/`         | `get plan variant in DB`          | reads a specific `(plan_id, provider)` variant. (reads use `userJwt` + `Accept-Profile: payments`.)                                                                               |
| `plans/`         | `add plan capability in DB`       | grants a capability to a plan. (writes use `supabaseSecretKey`.)                                                                                                                  |
| `plans/`         | `list plan capabilities in DB`    | lists the capabilities granted to a single plan. (reads use `userJwt` + `Accept-Profile: payments`.)                                                                              |
| `plans/`         | `remove plan capability in DB`    | revokes a capability from a plan. (writes use `supabaseSecretKey`.)                                                                                                               |
| `subscriptions/` | `health`                          | sanity check that supabase is up.                                                                                                                                                 |
| `subscriptions/` | `create checkout`                 | looks up the plan's variant in db, calls the provider with the `provider_plan_id`, returns the `initPoint` (the link the user opens to pay).                                      |
| `subscriptions/` | `get subscription`                | reads a single subscription from mp.                                                                                                                                              |
| `subscriptions/` | `list subscriptions`              | lists subscriptions in mp.                                                                                                                                                        |
| `subscriptions/` | `cancel subscription (edge)`      | user-authenticated: cancels the calling user's subscription via the edge function. mp dispatches a `subscription updated` webhook that the existing handler persists.             |
| `subscriptions/` | `cancel subscription (direct MP)` | direct call to mp's `PUT /preapproval/{id}` (utility for forense / manual testing).                                                                                               |
| `webhooks/`      | `subscription created`            | mock: fires the "subscription created" event mp would send.                                                                                                                       |
| `webhooks/`      | `subscription updated`            | mock: fires the "subscription updated" event.                                                                                                                                     |
| `webhooks/`      | `subscription payment`            | mock: fires the "payment processed" event.                                                                                                                                        |
| `webhooks/`      | `invalid signature`               | mock: webhook with a tampered hmac.                                                                                                                                               |
| `webhooks/`      | `missing signature`               | mock: webhook with no hmac header.                                                                                                                                                |
| `webhooks/`      | `unknown provider`                | sanity check that the router rejects unregistered providers.                                                                                                                      |

## end-to-end flow

the canonical happy path uses 7 requests from the `auth/`, `plans/`
and `subscriptions/` folders. run them in order:

0. `auth/login` → populates `userJwt` env var (one-time per session).
1. `plans/create plan in MP` → creates a plan in mp, saves `{{mpPlanId}}`
   in the environment via the post-response script.
2. `plans/create plan in DB` → registers the plan concept in
   `payments.plans`. copy the returned `id`.
3. `plans/create plan variant in DB` → links the plan to a provider
   with body `{plan_id, provider: 'mercadopago', provider_plan_id, amount, currency}`.
4. `subscriptions/create checkout` → looks up the variant, returns the
   `initPoint`. copy it.
5. open `initPoint` in a browser logged in as the test_comprador, pay
   with the approved test card. ~5-10s later, the webhook lands and
   `payments.subscriptions` is upserted with `status = 'authorized'`.
6. `subscriptions/cancel subscription (edge)` (optional) → cancels the
   user's subscription. mp dispatches a `subscription updated` webhook
   which is the single source of truth for the new state in db.

verify the result in the db:

```sql
select provider, provider_subscription_id, status, reason, payer_email,
       transaction_amount, currency_id, updated_at
  from payments.subscriptions
 order by updated_at desc
 limit 1;

select provider, topic, action, signature_valid, processing_status,
       received_at
  from payments.subscription_events
 order by received_at desc
 limit 5;
```

## adding a new provider

- create `_shared/lib/payments/<provider>/{client,webhook,types,config}.ts`
  implementing the `PaymentProvider` interface.
- register it in `_shared/lib/payments/index.ts`.
- extend the enum:
  ```sql
  alter type payments.provider_name add value 'stripe';
  ```
- point the new provider's webhook url at
  `${baseUrl}/functions/v1/payments-webhook/<provider>`.
- mirror the bruno requests under a sibling folder.
- in the db, for each plan you want to enable, insert a row into
  `payments.plan_provider_variants` with the stripe `provider_plan_id`
  and the stripe-native `amount` and `currency`.

## granting a capability to a plan

capability grants are an admin operation separate from plan creation.
the flow is one request per capability you want to enable on the plan:

1. `plans/create plan in DB` → copy the returned `id`.
2. `plans/add plan capability in DB` → set `planId` to the plan's `id`
   and `capability` to one of the valid values (`gmail_sync`,
   `ai_assistant`, `push_notifications`, `advanced_reports`). run as
   many times as capabilities to grant.
3. `plans/list plan capabilities in DB` → audit the resulting set.
4. to revoke, `plans/remove plan capability in DB` with the same
   `(planId, capability)` pair. revocation is immediate: the next gated
   edge-function call from any subscriber of that plan returns 403,
   because `requireCapability` re-queries the database on every
   invocation (no token refresh required).

adding a new capability to the vocabulary is a deliberate product
decision: extend the check constraint in
`payments.plan_capabilities_capability_check` via a migration, add the
identifier to `CAPABILITIES` in both
`packages/frontend/src/lib/capabilities.ts` and
`supabase/functions/_shared/capabilities.ts`, then start granting it.
