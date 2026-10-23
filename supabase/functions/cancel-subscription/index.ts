// cancel-subscription edge function.
//
// cancels (or pauses) the calling user's active subscription. the user's
// row in payments.subscriptions is looked up by user_id from the JWT, the
// provider's cancelSubscription() is called, and we return
// `pending_cancellation`. the actual database state change is delivered
// by the provider's webhook (subscription_preapproval.updated) which the
// existing payments-webhook handler persists — that webhook is the single
// source of truth for status, not this endpoint.
//
// auth: requireUserAuth (a real user JWT, not the internal service). RLS
// is not used for the lookup because the service_role client is shared
// across the edge function runtime; we filter by user_id explicitly so a
// user can only cancel their own subscription.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflightRequest, getCorsHeaders } from "../_shared/cors.ts";
import { requireSecretKey } from "../_shared/lib/api-keys.ts";
import { requireMinRole, requireUserAuth } from "../_shared/auth.ts";
import { getProvider } from "../_shared/lib/payments/index.ts";

Deno.serve(async req => {
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightRequest(req, corsHeaders);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  const auth = await requireUserAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const roleCheck = requireMinRole(auth, "subscriptions", corsHeaders);
  if (roleCheck instanceof Response) return roleCheck;

  const { user } = auth;

  // body is optional. default target is 'cancelled'. callers can pass
  // { status: 'paused' } to pause instead.
  let body: { status?: "cancelled" | "paused" } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // empty body is fine — defaults apply
  }

  if (
    body.status !== undefined &&
    body.status !== "cancelled" &&
    body.status !== "paused"
  ) {
    return jsonResponse(
      { error: "status must be 'cancelled' or 'paused' if provided" },
      400,
      corsHeaders
    );
  }
  const targetStatus = body.status ?? "cancelled";

  // lookup the user's own subscription. we use the service_role client
  // (bypasses RLS) and filter by user_id explicitly. sorting by
  // updated_at desc and limiting to 1 gives us the most recent row.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    requireSecretKey(),
    { db: { schema: "payments" } }
  );

  const { data: subs, error: lookupError } = await supabase
    .from("subscriptions")
    .select("provider, provider_subscription_id, status")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (lookupError) {
    return jsonResponse(
      { error: "lookup failed", details: lookupError.message },
      500,
      corsHeaders
    );
  }

  if (!subs || subs.length === 0) {
    return jsonResponse(
      { error: "No subscription found for this user" },
      404,
      corsHeaders
    );
  }

  const sub = subs[0];

  // idempotency: if the row is already in the target state, the call
  // would be a no-op at the provider. short-circuit to avoid a
  // confusing 4xx from mp.
  if (sub.status === targetStatus) {
    return jsonResponse(
      {
        status: sub.status,
        providerSubscriptionId: sub.provider_subscription_id,
        alreadyInTargetState: true,
        cancellationRequestedAt:
          sub.status === "cancelled" ? new Date().toISOString() : null,
      },
      200,
      corsHeaders
    );
  }

  const provider = getProvider(sub.provider);
  if (!provider) {
    return jsonResponse(
      { error: `Unknown provider: ${sub.provider}` },
      500,
      corsHeaders
    );
  }

  try {
    await provider.cancelSubscription(sub.provider_subscription_id, {
      status: targetStatus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      { error: "Provider rejected cancellation", details: message },
      502,
      corsHeaders
    );
  }

  // we intentionally do not update payments.subscriptions here. mp
  // dispatches subscription_preapproval.updated within seconds, and
  // the existing payments-webhook handler writes the new status. the
  // frontend can poll get_user_access (or our existing subscription
  // table reads) to observe the state change.
  return jsonResponse(
    {
      status: "pending_cancellation",
      requestedStatus: targetStatus,
      providerSubscriptionId: sub.provider_subscription_id,
      cancellationRequestedAt: new Date().toISOString(),
    },
    200,
    corsHeaders
  );
});

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
