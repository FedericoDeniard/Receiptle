import type { User } from "jsr:@supabase/supabase-js@2";
import { supabase } from "./lib/supabase.ts";
import { isCapability, type UserRole } from "./features.ts";

type JsonHeaders = Record<string, string>;

/**
 * Capability vocabulary. Mirrors packages/frontend/src/lib/capabilities.ts
 * and packages/mastra-server/src/lib/capabilities.ts. The CHECK constraint
 * on payments.plan_capabilities.capability (see
 * supabase/migrations/20260705031212_add_plan_capabilities.sql) is the
 * authoritative guard against drift between these copies.
 */
export const CAPABILITIES = {
  gmail_sync: "gmail_sync",
  ai_assistant: "ai_assistant",
  push_notifications: "push_notifications",
  process_documents: "process_documents",
  report_pdf_export: "report_pdf_export",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

// isCapability lives in features.ts so all three copies (edge,
// frontend, mastra) share the same check.

/**
 * Statuses that grant entitlements. A user with a subscription in any of
 * these statuses keeps their capabilities until the status leaves the set
 * (e.g. via a webhook updating `cancelled` or `payment_failed`). Kept in
 * sync with the WHERE clause in
 * supabase/migrations/20260705031217_add_user_capabilities_to_jwt.sql so
 * the JWT hint and the security boundary agree on what counts as "active".
 */
const ACTIVE_SUBSCRIPTION_STATUSES = [
  "authorized",
  "pending",
  "paused",
  "pending_cancellation",
] as const;

/**
 * Roles that bypass capability gates entirely. Staff (`admin`) and
 * developers running the app as `tester` can exercise any gated feature
 * without holding an active subscription. The bypass short-circuits
 * the DB roundtrip and logs an info-level audit entry so observers can
 * tell when a feature was granted via staff role vs. via subscription.
 *
 * Mirror this list in `packages/mastra-server/src/lib/capabilities.ts`.
 */
const ROLE_BYPASS: ReadonlySet<UserRole> = new Set<UserRole>([
  "admin",
  "tester",
]);

function forbidden(corsHeaders: JsonHeaders, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function internalError(corsHeaders: JsonHeaders): Response {
  return new Response(
    JSON.stringify({ error: "Failed to verify capabilities" }),
    {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

/**
 * Security boundary for capability-gated edge functions.
 *
 * Returns `{ user }` if the caller has the capability on any active
 * subscription OR as a default grant; returns a 403 Response otherwise.
 *
 * Calls `payments.user_capabilities(target_user_id)` — a SECURITY
 * DEFINER RPC that wraps the underlying view. We do **not** trust the
 * JWT `user_capabilities` claim here: the claim is a UI hint (so the
 * frontend can hide buttons without a roundtrip) but it is baked into
 * the access token until it expires, so a subscription that cancels
 * would still appear active until the next refresh. By querying the
 * DB on every call, the next gated call after a status change
 * immediately gets the right answer.
 *
 * The RPC is the canonical public API; the underlying
 * `payments.user_capabilities_v` view is internal (revoked from
 * authenticated) so a future contributor cannot bypass the RPC's
 * per-user gate by querying the view from a supabase-js client. The
 * RPC itself rejects authenticated callers that query another
 * user's id with a 42501, providing an additional belt-and-suspenders
 * check on top of the cascading RLS of the underlying tables.
 *
 * Role bypass: callers whose `role` is `admin` or `tester` skip the DB
 * call entirely. Staff and developers can exercise any gated feature
 * without holding a subscription; the bypass is logged at info level
 * so observability can distinguish staff-granted access from
 * subscription-granted access.
 */
export async function requireCapability(
  ctx: { user: User; role: UserRole },
  capability: Capability,
  corsHeaders: JsonHeaders
): Promise<{ user: User } | Response> {
  if (ROLE_BYPASS.has(ctx.role)) {
    console.info(
      `[requireCapability] role bypass for ${capability} by ${ctx.role} (user ${ctx.user.id})`
    );
    return { user: ctx.user };
  }

  // supabase.schema('payments') sets the Accept-Profile / Content-Profile
  // headers that PostgREST needs to discover the rpc in a non-default
  // schema. Without the profile, PostgREST only resolves the function
  // when it lives in the FIRST schema listed in PGRST_DB_SCHEMAS (which
  // is `public` in this stack); the rpc in `payments` returns PGRST202
  // and the consumer reports a confusing 500. See
  // https://docs.postgrest.org/en/v12/references/api/schemas.html.
  const { data, error } = await supabase
    .schema("payments")
    .rpc("user_capabilities", {
      target_user_id: ctx.user.id,
    });

  if (error) {
    console.error(
      `[requireCapability] db error checking ${capability}:`,
      error
    );
    return internalError(corsHeaders);
  }

  const caps = (data ?? []).filter(isCapability);
  if (!caps.includes(capability)) {
    return forbidden(corsHeaders, `Requires capability: ${capability}`);
  }

  return { user: ctx.user };
}
