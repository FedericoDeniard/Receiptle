// provider-agnostic billing webhook router.
//
// url shape:  /functions/v1/payments-webhook/<provider>
// the provider segment is the only thing the router needs to know; all
// signature verification, event parsing and upsert logic is delegated to
// the registered PaymentProvider implementation.
//
// add a new provider:
//   1. register it in _shared/lib/payments/index.ts.
//   2. add an entry in the provider_name enum (migration).
//   3. configure the provider's webhook url pointing at this function with
//      /<provider> as the suffix.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflightRequest, getCorsHeaders } from "../_shared/cors.ts";
import { requireSecretKey } from "../_shared/lib/api-keys.ts";
import { getProvider } from "../_shared/lib/payments/index.ts";
import type {
  AuthorizedPaymentDetails,
  NormalizedWebhookEvent,
  PaymentDetails,
  WebhookVerification,
} from "../_shared/lib/payments/types.ts";

Deno.serve(async req => {
  const corsHeaders = getCorsHeaders(req);

  // cors preflight (mp does not send one, but we leave the door open)
  const preflight = handleCorsPreflightRequest(req, corsHeaders);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  // resolve provider from path. url pattern: /functions/v1/payments-webhook/<provider>
  const providerName = extractProviderName(req.url);
  if (!providerName) {
    return jsonResponse(
      { error: "Missing provider in path" },
      400,
      corsHeaders
    );
  }

  const provider = getProvider(providerName);
  if (!provider) {
    return jsonResponse(
      { error: `Unknown provider: ${providerName}` },
      404,
      corsHeaders
    );
  }

  // capture raw body before any parsing - signature verification needs the
  // exact bytes the provider sent.
  const rawBody = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  // verify signature
  const verification = await provider.verifyWebhookSignature(req, rawBody);

  // in production we reject invalid signatures. in test we accept them and
  // mark the event as 'rejected_signature' for debugging bruno mocks.
  const isProduction = isProductionEnv();
  if (!verification.valid) {
    console.warn("[payments-webhook] signature invalid", {
      provider: providerName,
      reason: verification.reason,
    });
    if (isProduction) {
      return jsonResponse({ error: "Invalid signature" }, 401, corsHeaders);
    }
  }

  // normalize the event via the provider
  const event = provider.parseWebhookEvent(rawBody);

  // persist raw event first (always - audit log)
  // the supabase client is pinned to the `payments` schema so all
  // .from("...") calls below resolve to payments.<table> automatically.
  // this keeps the rest of the handler identical to the previous
  // public-schema version while routing queries to the new schema.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    requireSecretKey(),
    { db: { schema: "payments" } }
  );

  const eventRow = await insertEvent(supabase, {
    provider: providerName,
    event,
    body,
    verification,
  });

  // dispatch by normalized topic
  try {
    await processEvent(supabase, providerName, event, eventRow.id);
    await supabase
      .from("subscription_events")
      .update({ processing_status: "processed" })
      .eq("id", eventRow.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[payments-webhook] processing error", {
      provider: providerName,
      message,
    });
    await supabase
      .from("subscription_events")
      .update({ processing_status: "error", processing_error: message })
      .eq("id", eventRow.id);
  }

  console.info("[payments-webhook] processed", {
    provider: providerName,
    topic: event.topic,
    action: event.action,
    signatureValid: verification.valid,
  });

  return jsonResponse({ received: true }, 200, corsHeaders);
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function extractProviderName(url: string): string | null {
  // strip query string and split by '/', pick the last non-empty segment.
  const path = new URL(url).pathname.replace(/\/+$/, "");
  const segments = path.split("/");
  const last = segments[segments.length - 1];
  if (!last || last === "payments-webhook") return null;
  return last;
}

function isProductionEnv(): boolean {
  return (Deno.env.get("MP_ENVIRONMENT") ?? "test") === "production";
}

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

interface EventInsertInput {
  provider: string;
  event: NormalizedWebhookEvent;
  body: unknown;
  verification: WebhookVerification;
}

async function insertEvent(
  supabase: ReturnType<typeof createClient>,
  input: EventInsertInput
): Promise<{ id: number }> {
  const processingStatus = input.verification.valid
    ? "received"
    : "rejected_signature";

  // signature timing: pull ts/hash off the verification if valid.
  const ts = input.verification.valid ? input.verification.ts : null;

  const { data, error } = await supabase
    .from("subscription_events")
    .insert({
      provider: input.provider,
      provider_subscription_id: input.event.providerSubscriptionId ?? null,
      provider_event_id: input.event.providerEventId ?? null,
      topic: input.event.topic,
      action: input.event.action || null,
      payment_id: input.event.providerPaymentId
        ? Number(input.event.providerPaymentId)
        : null,
      x_request_id: input.verification.valid
        ? input.verification.requestId
        : null,
      x_signature_ts: ts,
      signature_valid: input.verification.valid,
      body: input.body as Record<string, unknown>,
      processing_status: processingStatus,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert subscription_event: ${error?.message ?? "no data"}`
    );
  }
  return { id: data.id as number };
}

async function processEvent(
  supabase: ReturnType<typeof createClient>,
  providerName: string,
  event: NormalizedWebhookEvent,
  eventId: number
): Promise<void> {
  const provider = getProvider(providerName);
  if (!provider) throw new Error(`Provider disappeared: ${providerName}`);

  console.info("[payments-webhook] processing event", {
    eventId,
    provider: providerName,
    topic: event.topic,
    action: event.action,
    providerSubscriptionId: event.providerSubscriptionId,
  });

  switch (event.topic) {
    case "subscription.created":
    case "subscription.updated": {
      if (!event.providerSubscriptionId) {
        throw new Error("subscription event without providerSubscriptionId");
      }
      console.info("[payments-webhook] MP returned subscription id", {
        providerSubscriptionId: event.providerSubscriptionId,
      });
      const details = await provider.getSubscription(
        event.providerSubscriptionId
      );
      if (!details) {
        throw new Error(
          `MP /preapproval/${event.providerSubscriptionId} returned 404`
        );
      }
      // the payload mp returned to us. external_reference is what we
      // stamped on the plan in create-subscription (= auth.users.id).
      console.info("[payments-webhook] MP preapproval details", {
        providerSubscriptionId: details.providerSubscriptionId,
        status: details.status,
        payerEmail: details.payerEmail,
        externalReference: details.externalReference,
        reason: details.reason,
      });
      await upsertSubscription(
        supabase,
        providerName,
        event.providerSubscriptionId,
        details
      );
      return;
    }

    case "subscription.payment": {
      // resolve the underlying preapproval id from the authorized_payment id,
      // then enrich the event row and link the subscription to the app user.
      // mp does not reliably propagate the plan's external_reference to the
      // preapproval, so recover it from the authorized payment, or from the
      // payment itself when the authorized payment does not carry it yet.
      if (!event.providerPaymentId) {
        throw new Error("payment event without providerPaymentId");
      }
      // getAuthorizedPayment/getPayment are mercadopago-specific for now. keep
      // the dispatch generic by feature-detecting the methods.
      const maybeClient = provider as unknown as {
        getAuthorizedPayment?: (
          id: string | number
        ) => Promise<AuthorizedPaymentDetails | null>;
        getPayment?: (id: string | number) => Promise<PaymentDetails | null>;
      };
      if (typeof maybeClient.getAuthorizedPayment !== "function") {
        console.info(
          "[payments-webhook] provider has no getAuthorizedPayment; skipping resolve"
        );
        return;
      }
      const authPayment = await maybeClient.getAuthorizedPayment(
        event.providerPaymentId
      );
      if (authPayment?.preapprovalId) {
        await supabase
          .from("subscription_events")
          .update({ provider_subscription_id: authPayment.preapprovalId })
          .eq("id", eventId);
      }

      // persist the charge before anything else: the revenue ledger must not
      // depend on the user-linking path below (which can return early). the
      // status is deliberately left out here: the authorized payment mirror
      // can report a later cancellation that must not erase an approved
      // charge. only the payment resource below sets the revenue status.
      if (authPayment) {
        await upsertPayment(supabase, {
          provider: providerName,
          providerPaymentId: String(event.providerPaymentId),
          providerSubscriptionId: authPayment.preapprovalId,
          transactionAmount: authPayment.transactionAmount,
          currencyId: authPayment.currencyId,
          dateApproved: authPayment.dateApproved,
        });
      }

      if (!authPayment?.preapprovalId) {
        console.warn(
          "[payments-webhook] authorized payment has no preapproval id; cannot link user",
          { authorizedPaymentId: event.providerPaymentId }
        );
        return;
      }

      // the authorized payment carries the same external_reference we stamp
      // on the plan. use it directly when present: payment_id can still be
      // null in the early event even though the payment already exists.
      let externalReference = authPayment.externalReference;
      let userId = asUserId(externalReference);
      let payerEmail: string | null = null;

      if (
        authPayment.paymentId &&
        typeof maybeClient.getPayment === "function"
      ) {
        let payment: PaymentDetails | null = null;
        try {
          payment = await maybeClient.getPayment(authPayment.paymentId);
        } catch (error) {
          // if the authorized payment already gave us a usable user id, the
          // payment lookup is only for payer_email and must not block linking.
          if (!userId) throw error;
          console.warn(
            "[payments-webhook] getPayment failed; using authorized payment data",
            {
              paymentId: authPayment.paymentId,
              message: error instanceof Error ? error.message : String(error),
            }
          );
        }
        if (payment) {
          payerEmail = payment.payerEmail;
          if (!userId) {
            externalReference = payment.externalReference;
            userId = asUserId(externalReference);
          }
        }
        if (!payment && !userId) {
          throw new Error(
            `MP payment ${authPayment.paymentId} not found while linking subscription ${authPayment.preapprovalId}`
          );
        }

        // the payment resource is the authoritative charge: prefer its
        // status/amount/date over the authorized payment mirror. the status
        // is only updated when the payment resource exists, so a later
        // authorized-payment cancellation cannot erase an approved charge.
        await upsertPayment(supabase, {
          provider: providerName,
          providerPaymentId: String(event.providerPaymentId),
          providerChargeId: String(authPayment.paymentId),
          providerSubscriptionId: authPayment.preapprovalId,
          status: payment?.status,
          statusDetail: payment?.statusDetail,
          transactionAmount:
            payment?.transactionAmount ?? authPayment.transactionAmount,
          currencyId: payment?.currencyId ?? authPayment.currencyId,
          dateApproved: payment?.dateApproved ?? authPayment.dateApproved,
        });
      }

      if (!userId) {
        console.info(
          "[payments-webhook] no usable external_reference; leaving user_id untouched",
          {
            preapprovalId: authPayment.preapprovalId,
            paymentId: authPayment.paymentId,
            authorizedPaymentId: event.providerPaymentId,
          }
        );
        return;
      }

      const update: Record<string, unknown> = {
        user_id: userId,
        external_reference: externalReference,
      };
      if (payerEmail) {
        update.payer_email = payerEmail;
      }

      // only fill user_id when it is still empty: the plan-level
      // external_reference is a single field and a stale payment could carry
      // another user's id under concurrent checkouts.
      const linkUnlinkedSubscription = async (): Promise<boolean> => {
        const { data: updated, error: updateError } = await supabase
          .from("subscriptions")
          .update(update)
          .eq("provider", providerName)
          .eq("provider_subscription_id", authPayment.preapprovalId)
          .is("user_id", null)
          .select("id");

        if (updateError) {
          throw new Error(
            `Failed to link subscription to user: ${updateError.message}`
          );
        }
        return !!updated && updated.length > 0;
      };

      const logLinked = () =>
        console.info("[payments-webhook] linked subscription to user", {
          preapprovalId: authPayment.preapprovalId,
          paymentId: authPayment.paymentId,
          userId,
        });

      if (await linkUnlinkedSubscription()) {
        logLinked();
        return;
      }

      const { data: existing, error: existingError } = await supabase
        .from("subscriptions")
        .select("id, user_id")
        .eq("provider", providerName)
        .eq("provider_subscription_id", authPayment.preapprovalId)
        .maybeSingle();

      if (existingError) {
        throw new Error(
          `Failed to inspect subscription before linking: ${existingError.message}`
        );
      }

      if (existing) {
        // the preapproval event (subscription.updated) arrives at the same
        // time and may have inserted the row between our update and this
        // select. the row is there now, so link it.
        if (!existing.user_id) {
          if (await linkUnlinkedSubscription()) {
            logLinked();
            return;
          }
          throw new Error(
            `Subscription ${authPayment.preapprovalId} still unlinked after retry`
          );
        }
        if (existing.user_id !== userId) {
          console.warn(
            "[payments-webhook] subscription already linked to another user; leaving it untouched",
            {
              preapprovalId: authPayment.preapprovalId,
              existingUserId: existing.user_id,
              paymentUserId: userId,
            }
          );
        }
        return;
      }

      // event order is not guaranteed: if the subscription row does not exist
      // yet, fetch the preapproval and upsert it with the recovered user.
      const details = await provider.getSubscription(authPayment.preapprovalId);
      if (!details) {
        throw new Error(
          `MP preapproval ${authPayment.preapprovalId} not found while linking subscription`
        );
      }
      await upsertSubscription(
        supabase,
        providerName,
        authPayment.preapprovalId,
        {
          ...details,
          externalReference,
          payerEmail: details.payerEmail || payerEmail || null,
        }
      );
      console.info("[payments-webhook] created and linked subscription", {
        preapprovalId: authPayment.preapprovalId,
        paymentId: authPayment.paymentId,
        userId,
      });
      return;
    }

    case "unknown":
      // already persisted with processing_status='received' (signature valid)
      // or 'rejected_signature'. nothing else to do.
      return;
  }
}

interface PaymentUpsertInput {
  provider: string;
  providerPaymentId: string;
  providerChargeId?: string | null;
  providerSubscriptionId?: string | null;
  status?: string | null;
  statusDetail?: string | null;
  transactionAmount?: number | null;
  currencyId?: string | null;
  dateApproved?: string | null;
}

// one row per charge. keyed by the authorized_payment id the webhook carries
// as payment_id, so repeated deliveries (created + updated) update the same
// row instead of duplicating revenue.
async function upsertPayment(
  supabase: ReturnType<typeof createClient>,
  input: PaymentUpsertInput
): Promise<void> {
  const row: Record<string, unknown> = {
    provider: input.provider,
    provider_payment_id: input.providerPaymentId,
  };

  const optional: Record<string, unknown> = {
    provider_charge_id: input.providerChargeId,
    provider_subscription_id: input.providerSubscriptionId,
    status: input.status,
    status_detail: input.statusDetail,
    transaction_amount: input.transactionAmount,
    currency_id: input.currencyId,
    date_approved: input.dateApproved,
  };

  // omit null/undefined so a later event cannot erase data a previous one
  // already persisted (e.g. provider_charge_id or status).
  for (const [column, value] of Object.entries(optional)) {
    if (value !== undefined && value !== null) {
      row[column] = value;
    }
  }

  try {
    const { error } = await supabase
      .from("payments")
      .upsert(row, { onConflict: "provider,provider_payment_id" });

    // the ledger is secondary: a bookkeeping failure must not break the
    // subscription/entitlement path. log and let the webhook continue.
    if (error) {
      console.error("[payments-webhook] failed to upsert payment", {
        providerPaymentId: input.providerPaymentId,
        message: error.message,
      });
    }
  } catch (error) {
    console.error("[payments-webhook] failed to upsert payment", {
      providerPaymentId: input.providerPaymentId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

interface SubscriptionUpsertInput {
  providerSubscriptionId: string;
  status: string;
  reason: string | null;
  payerEmail: string | null;
  frequency: number | null;
  frequencyType: string | null;
  transactionAmount: number | null;
  currencyId: string | null;
  externalReference: string | null;
  autoRecurring: unknown;
  preapprovalPlanId: string | null;
  currentPeriodEnd: string | null;
  raw: unknown;
}

async function upsertSubscription(
  supabase: ReturnType<typeof createClient>,
  providerName: string,
  providerSubscriptionId: string,
  details: SubscriptionUpsertInput
): Promise<void> {
  // resolve plan_id from the variant table. when the preapproval is
  // associated with a plan (the common case in our plan-based flow),
  // we look up the (provider, provider_plan_id) tuple and set plan_id
  // on the row. this lets the rest of the app (cancellation, future
  // entitlements RPC) link subscriptions to plan concepts.
  let planId: string | null = null;
  if (details.preapprovalPlanId) {
    const { data: variant } = await supabase
      .from("plan_provider_variants")
      .select("plan_id")
      .eq("provider", providerName)
      .eq("provider_plan_id", details.preapprovalPlanId)
      .eq("is_active", true)
      .maybeSingle();
    planId = variant?.plan_id ?? null;
  }

  // preserve an existing link: later preapproval events may omit the
  // external_reference, and those must not un-link a subscription that the
  // payment event already linked. same for payer_email.
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("user_id, payer_email, external_reference, status, access_until")
    .eq("provider", providerName)
    .eq("provider_subscription_id", providerSubscriptionId)
    .maybeSingle();

  const userId = existing?.user_id ?? asUserId(details.externalReference);
  const payerEmail = details.payerEmail || existing?.payer_email || null;
  const externalReference =
    details.externalReference || existing?.external_reference || null;

  const { status, accessUntil } = resolveLocalStatus({
    providerStatus: details.status,
    currentPeriodEnd: details.currentPeriodEnd,
    existingStatus: existing?.status ?? null,
    existingAccessUntil: existing?.access_until ?? null,
  });

  const row: Record<string, unknown> = {
    provider: providerName,
    provider_subscription_id: providerSubscriptionId,
    status,
    access_until: accessUntil,
    reason: details.reason,
    frequency: details.frequency,
    frequency_type: details.frequencyType,
    transaction_amount: details.transactionAmount,
    currency_id: details.currencyId,
    auto_recurring: details.autoRecurring as Record<string, unknown> | null,
    plan_id: planId,
    raw: details.raw as Record<string, unknown>,
  };
  // the payment event can link the row between our select and this upsert.
  // omit the link columns when we have nothing to write so the upsert does
  // not overwrite them with null (on conflict only sent columns are updated).
  if (userId) row.user_id = userId;
  if (payerEmail) row.payer_email = payerEmail;
  if (externalReference) row.external_reference = externalReference;

  const { error } = await supabase
    .from("subscriptions")
    .upsert(row, { onConflict: "provider,provider_subscription_id" });

  if (error) {
    throw new Error(`Failed to upsert subscription: ${error.message}`);
  }
}

// ─── entitlement state ───────────────────────────────────────────────────────

// map the provider status onto the local entitlement status.
//
// mp has no "cancel at period end": a cancelled preapproval is cancelled
// immediately, even though the subscriber already paid through
// `currentPeriodEnd`. keeping access until that date is a product decision,
// so a cancelled subscription with a future paid period is stored as
// `pending_cancellation` (an entitled status) and the pg_cron job flips it
// to `cancelled` once `access_until` passes.
//
// retried webhooks must not move a terminal row back to an entitled state,
// nor extend access after the paid period ended.
function resolveLocalStatus(input: {
  providerStatus: string;
  currentPeriodEnd: string | null;
  existingStatus: string | null;
  existingAccessUntil: string | null;
}): { status: string; accessUntil: string | null } {
  const {
    providerStatus,
    currentPeriodEnd,
    existingStatus,
    existingAccessUntil,
  } = input;

  if (providerStatus !== "cancelled") {
    // active provider status: refresh the paid-through date, falling back
    // to the stored value when the provider does not report a paid period.
    return {
      status: providerStatus,
      accessUntil: currentPeriodEnd ?? existingAccessUntil ?? null,
    };
  }

  // already terminal or already waiting for the paid period to end:
  // preserve the local state so webhook retries cannot resurrect access.
  if (
    existingStatus === "cancelled" ||
    existingStatus === "pending_cancellation"
  ) {
    return {
      status: existingStatus,
      accessUntil: existingAccessUntil ?? null,
    };
  }

  const accessUntil =
    existingAccessUntil && isFuture(existingAccessUntil)
      ? existingAccessUntil
      : currentPeriodEnd && isFuture(currentPeriodEnd)
        ? currentPeriodEnd
        : null;

  if (accessUntil) {
    return { status: "pending_cancellation", accessUntil };
  }

  return { status: "cancelled", accessUntil: new Date().toISOString() };
}

function isFuture(iso: string): boolean {
  const timestamp = Date.parse(iso);
  return !Number.isNaN(timestamp) && timestamp > Date.now();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// mp does not reliably propagate the plan's external_reference to the
// preapproval. the webhook also recovers it from the payment's
// external_reference. validate it before using it as an auth user id.
//
// payer_email is kept as a column on payments.subscriptions (for
// reconciliation / debugging) but it is not used to resolve user_id.
function asUserId(externalReference: string | null): string | null {
  if (!externalReference) return null;
  if (!UUID_RE.test(externalReference)) return null;
  return externalReference;
}
