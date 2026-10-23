// create-subscription edge function.
//
// flow (hosted-checkout): the client picks a plan in /account/billing
// and posts { plan_id, provider }. we look up the active variant for
// (plan_id, provider) in payments.plan_provider_variants, stamp the
// user's uuid into the plan's `external_reference` field via PUT
// /preapproval_plan/{id}, then return the plan's hosted-checkout url
// (its `init_point`). mp creates the preapproval server-side when the
// user pays; if mp propagates the plan's external_reference to the
// resulting preapproval, the webhook resolves user_id at our end.
//
// we previously tried POST /preapproval server-side with
// external_reference = user.id, but for this seller account MP rejects
// standalone (500), plan + card_token_id (404 Card token service not
// found), and plan without card (400 card_token_id required). the
// only working path is hosted-checkout.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflightRequest, getCorsHeaders } from "../_shared/cors.ts";
import { requireSecretKey } from "../_shared/lib/api-keys.ts";
import { requireMinRole, requireUserAuth } from "../_shared/auth.ts";
import { getProvider, isKnownProvider } from "../_shared/lib/payments/index.ts";

Deno.serve(async req => {
  const corsHeaders = getCorsHeaders(req);

  console.info("[create-subscription] incoming", {
    method: req.method,
    url: req.url,
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    contentType: req.headers.get("content-type"),
    hasAuth: Boolean(req.headers.get("authorization")),
    corsAllowOrigin: corsHeaders["Access-Control-Allow-Origin"],
  });

  const preflight = handleCorsPreflightRequest(req, corsHeaders);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  const auth = await requireUserAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const roleCheck = requireMinRole(auth, "subscriptions", corsHeaders);
  if (roleCheck instanceof Response) return roleCheck;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const providerField = stringField(body, "provider");
  if (!providerField) {
    return jsonResponse(
      { error: "Missing required field: provider" },
      400,
      corsHeaders
    );
  }
  if (!isKnownProvider(providerField)) {
    return jsonResponse(
      { error: `Unknown provider: ${providerField}` },
      400,
      corsHeaders
    );
  }

  const planId = stringField(body, "plan_id");
  if (!planId) {
    return jsonResponse(
      { error: "Missing required field: plan_id" },
      400,
      corsHeaders
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    requireSecretKey(),
    { db: { schema: "payments" } }
  );

  const { data: variant, error: variantError } = await supabase
    .from("plan_provider_variants")
    .select("provider_plan_id, is_active, plan_id, amount, currency")
    .eq("plan_id", planId)
    .eq("provider", providerField)
    .eq("is_active", true)
    .maybeSingle();

  if (variantError) {
    return jsonResponse(
      { error: "variant lookup failed", details: variantError.message },
      500,
      corsHeaders
    );
  }

  if (!variant) {
    return jsonResponse(
      {
        error: `Plan '${planId}' is not enabled on provider '${providerField}'`,
        hint: "register the plan on this provider via payments.plan_provider_variants",
      },
      404,
      corsHeaders
    );
  }

  const provider = getProvider(providerField);
  if (!provider) {
    return jsonResponse(
      { error: `Unknown provider: ${providerField}` },
      500,
      corsHeaders
    );
  }

  // hosted-checkout flow. we stamp user.id into the plan's
  // external_reference right before redirecting — when mp creates the
  // preapproval on its side (after the user pays), it propagates that
  // value to the preapproval and the webhook carries it back so we can
  // resolve user_id at parse time.
  //
  // the plan's external_reference is a single field so this is racy
  // across concurrent users (a second user clicking subscribe while the
  // first is still paying would overwrite the first's stamp). for now we
  // serialize via the function's single-threaded event loop and trust
  // that the user pays immediately; if concurrency becomes a problem
  // we'll switch to one plan per user or a checkout_sessions table.
  try {
    await provider.updatePlan(variant.provider_plan_id, {
      externalReference: auth.user.id,
    });
    console.info("[create-subscription] stamped plan external_reference", {
      providerPlanId: variant.provider_plan_id,
      externalReference: auth.user.id,
    });

    const plan = await provider.getPlan(variant.provider_plan_id);
    if (!plan) {
      return jsonResponse(
        {
          error: `Plan not found in provider: ${variant.provider_plan_id}`,
          hint: "the variant references a provider plan id that no longer exists",
        },
        404,
        corsHeaders
      );
    }

    return jsonResponse(
      {
        providerPlanId: plan.id,
        initPoint: plan.initPoint,
        status: "pending",
        mode: "plan",
        planId,
        externalReference: auth.user.id,
      },
      200,
      corsHeaders
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[create-subscription] hosted checkout prep failed", {
      provider: providerField,
      planId,
      externalReference: auth.user.id,
      errorMessage: message,
    });
    return jsonResponse({ error: message }, 502, corsHeaders);
  }
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

function stringField(
  body: Record<string, unknown>,
  key: string
): string | null {
  const v = body[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
