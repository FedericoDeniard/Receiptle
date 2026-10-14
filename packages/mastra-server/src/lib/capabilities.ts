import type { UserRole } from "./roles";

/**
 * Capability vocabulary. Mirrors
 * `supabase/functions/_shared/capabilities.ts` and
 * `packages/frontend/src/lib/capabilities.ts`. The CHECK constraint on
 * `payments.plan_capabilities.capability` is the authoritative guard
 * against drift between these copies.
 *
 * Capabilities are a subscription-tier concept: a user has a capability
 * if any active subscription's plan grants it. Active statuses mirror
 * the WHERE clause in
 * `supabase/migrations/20260705031217_add_user_capabilities_to_jwt.sql`
 * so this helper and the JWT claim agree on what counts as "active".
 */
const CAPABILITIES = {
  gmail_sync: "gmail_sync",
  ai_assistant: "ai_assistant",
  push_notifications: "push_notifications",
  process_documents: "process_documents",
  report_pdf_export: "report_pdf_export",
} as const;

type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

/**
 * Type guard for runtime values (e.g. read from the JWT claim).
 */
function isCapability(x: unknown): x is Capability {
  return typeof x === "string" && x in CAPABILITIES;
}

/**
 * Roles that bypass capability gates entirely. Staff (`admin`) and
 * developers running the app as `tester` can exercise any gated feature
 * without holding an active subscription. The bypass short-circuits
 * the DB roundtrip; the call site logs the bypass at info level so
 * observers can tell when a feature was granted via staff role vs.
 * via subscription.
 *
 * Mirror this list in `supabase/functions/_shared/capabilities.ts`.
 */
const ROLE_BYPASS: ReadonlySet<UserRole> = new Set<UserRole>([
  "admin",
  "tester",
]);

/**
 * Server-side capability gate for the mastra-server. Calls the
 * `payments.user_capabilities(target_user_id)` RPC (a SECURITY DEFINER
 * function that wraps the underlying `payments.user_capabilities_v`
 * view) so the gate reflects subscription state changes immediately,
 * without waiting for a JWT refresh — same contract as
 * `supabase/functions/_shared/capabilities.ts#requireCapability`.
 *
 * Returns `{ allowed: true }` when the caller has the capability on
 * any active subscription (or as a default grant, or when their role
 * is in the bypass set); `{ allowed: false, missing: capability }`
 * otherwise. The caller decides how to surface a denial (the chat
 * handler in `routes/resilient-chat-route.ts` returns a 403 with the
 * same `Requires capability: <key>` prefix the frontend classifier
 * matches against, so the user sees the localized "premium feature"
 * toast via `getEdgeFunctionErrorMessage`).
 *
 * The mirror of this helper in the supabase edge functions uses the
 * service-role Supabase client; the mastra-server uses a per-request
 * client scoped to the caller's JWT (built from `supabaseToken` in
 * the request context) so RLS still applies and we don't need
 * service-role credentials in this package. The RPC is SECURITY
 * DEFINER so it can read payments.user_capabilities_v (which is
 * revoked from authenticated) on behalf of the caller's JWT.
 */
interface CapabilityCheckOk {
  allowed: true;
}

interface CapabilityCheckDenied {
  allowed: false;
  missing: Capability;
}

type CapabilityCheck = CapabilityCheckOk | CapabilityCheckDenied;

interface RequireCapabilityContext {
  userId: string;
  supabaseToken: string;
  role: UserRole;
}

export async function requireCapability(
  ctx: RequireCapabilityContext,
  capability: Capability
): Promise<CapabilityCheck> {
  if (ROLE_BYPASS.has(ctx.role)) {
    console.info(
      `[requireCapability] role bypass for ${capability} by ${ctx.role} (user ${ctx.userId})`
    );
    return { allowed: true };
  }

  // The supabase client lives in the lib directory and is created
  // from the caller's JWT — same pattern as
  // `lib/supabase-from-token.ts` which the tools already use.
  const { supabaseFromToken } = await import("./supabase-from-token");
  const supabase = supabaseFromToken(ctx.supabaseToken);

  // SECURITY DEFINER RPC that wraps the view. Per-user gate lives in
  // the function body, so even though we pass the user's own user_id
  // here, the rpc cannot be tricked into leaking other users' caps.
  // supabase.schema('payments') sets the Accept-Profile / Content-Profile
  // headers that PostgREST needs to resolve the rpc in a non-default
  // schema; without the profile, the call returns PGRST202 (the first
  // schema in PGRST_DB_SCHEMAS is public, where this function does not
  // exist). See https://docs.postgrest.org/en/v12/references/api/schemas.html.
  const { data, error } = await supabase
    .schema("payments")
    .rpc("user_capabilities", {
      target_user_id: ctx.userId,
    });

  if (error) {
    // Treat DB errors as "not allowed" so the caller surfaces the
    // premium-feature UX instead of a confusing internal error. The
    // route handler logs the underlying error.
    console.error(
      `[requireCapability] db error checking ${capability}:`,
      error
    );
    return { allowed: false, missing: capability };
  }

  const caps = (data ?? []).filter(isCapability);
  if (!caps.includes(capability)) {
    return { allowed: false, missing: capability };
  }

  return { allowed: true };
}
