// mercado pago provider implementation of the PaymentProvider contract.
//
// all network IO is contained here. callers depend only on the PaymentProvider
// interface (../types.ts) so swapping providers is a one-line change in
// ../index.ts.
//
// scope: hosted-checkout flow only. the seller pre-creates a
// preapproval_plan via POST /preapproval_plan; create-subscription
// stamps our user.id into the plan's external_reference via PUT, then
// reads it via getPlan() and hands back its `init_point` so the user
// pays on mp's own site. mp does not reliably propagate external_reference
// to the resulting preapproval; payments-webhook recovers the user from
// the payment's external_reference when the preapproval arrives without it.

import type {
  AuthorizedPaymentDetails,
  NormalizedWebhookEvent,
  PaymentDetails,
  PaymentProvider,
  PlanDetails,
  SubscriptionDetails,
  UpdatePlanInput,
  WebhookVerification,
} from "../types.ts";
import { getMPConfig } from "./config.ts";
import {
  authorizedPaymentResponseSchema,
  paymentResponseSchema,
  preapprovalResponseSchema,
  preapprovalWebhookSchema,
  authorizedPaymentWebhookSchema,
  updatePreapprovalPlanResponseSchema,
} from "./types.ts";
import { verifyMPWebhookSignature } from "./webhook.ts";

export class MercadoPagoProvider implements PaymentProvider {
  readonly name = "mercadopago" as const;

  // returns the init_point of an existing preapproval plan. used by
  // create-subscription in the hosted-checkout flow: the seller
  // pre-creates a plan (e.g. "Pro $100/mes"), getPlan reads it, and we
  // redirect the user to plan.initPoint. mp creates the preapproval on
  // the user-side, dispatches the subscription_preapproval webhook, and
  // payments-webhook persists the row.
  async getPlan(
    planId: string
  ): Promise<{ id: string; initPoint: string } | null> {
    const config = getMPConfig();
    const response = await fetch(
      `${config.apiBaseUrl}/preapproval_plan/${encodeURIComponent(planId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${config.accessToken}` },
      }
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MP getPlan failed (${response.status}): ${text}`);
    }
    const json = (await response.json()) as { id: string; init_point?: string };
    if (!json.init_point) return null;
    return { id: json.id, initPoint: json.init_point };
  }

  async getSubscription(
    providerSubscriptionId: string
  ): Promise<SubscriptionDetails | null> {
    const config = getMPConfig();
    const response = await fetch(
      `${config.apiBaseUrl}/preapproval/${encodeURIComponent(providerSubscriptionId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${config.accessToken}` },
      }
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `MP getSubscription failed (${response.status}): ${text}`
      );
    }

    const json = await response.json();
    const parsed = preapprovalResponseSchema.parse(json);

    return {
      providerSubscriptionId: parsed.id,
      status: parsed.status,
      reason: parsed.reason ?? null,
      payerEmail: parsed.payer_email ?? null,
      frequency: parsed.auto_recurring?.frequency ?? null,
      frequencyType: parsed.auto_recurring?.frequency_type ?? null,
      transactionAmount: parsed.auto_recurring?.transaction_amount ?? null,
      currencyId: parsed.auto_recurring?.currency_id ?? null,
      externalReference: parsed.external_reference ?? null,
      autoRecurring: parsed.auto_recurring ?? null,
      preapprovalPlanId: parsed.preapproval_plan_id ?? null,
      currentPeriodEnd: resolveCurrentPeriodEnd({
        nextPaymentDate: parsed.next_payment_date ?? null,
        lastChargedDate: parsed.summarized?.last_charged_date ?? null,
        frequency: parsed.auto_recurring?.frequency ?? null,
        frequencyType: parsed.auto_recurring?.frequency_type ?? null,
      }),
      raw: json,
    };
  }

  // partial update of a preapproval plan. every input field is optional;
  // omitted fields are left untouched by the provider. throws on empty
  // input (no fields to update) and on any non-2xx response other than 404.
  //
  // the caller is responsible for keeping any local mirror in sync
  // (e.g. payments.plans) after a successful call. MP does
  // NOT fire a webhook for plan updates, so the only way to refresh a
  // cached plan is to call getPlan() after this.
  async updatePlan(
    planId: string,
    input: UpdatePlanInput
  ): Promise<PlanDetails | null> {
    const config = getMPConfig();

    const body: Record<string, unknown> = {};
    if (input.reason !== undefined) body.reason = input.reason;
    if (input.backUrl !== undefined) body.back_url = input.backUrl;
    if (input.externalReference !== undefined) {
      body.external_reference = input.externalReference;
    }

    const hasAutoRecurringField =
      input.transactionAmount !== undefined ||
      input.currencyId !== undefined ||
      input.frequency !== undefined ||
      input.frequencyType !== undefined ||
      input.trialDays !== undefined;
    if (hasAutoRecurringField) {
      const ar: Record<string, unknown> = {};
      if (input.frequency !== undefined) ar.frequency = input.frequency;
      if (input.frequencyType !== undefined) {
        ar.frequency_type = input.frequencyType;
      }
      if (input.transactionAmount !== undefined) {
        ar.transaction_amount = input.transactionAmount;
      }
      if (input.currencyId !== undefined) ar.currency_id = input.currencyId;
      if (input.trialDays !== undefined && input.trialDays > 0) {
        ar.free_trial = {
          frequency: input.trialDays,
          frequency_type: "days",
        };
      }
      body.auto_recurring = ar;
    }

    if (Object.keys(body).length === 0) {
      throw new Error(
        "updatePlan called with no fields to update (all input fields are undefined)"
      );
    }

    const response = await fetch(
      `${config.apiBaseUrl}/preapproval_plan/${encodeURIComponent(planId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MP updatePlan failed (${response.status}): ${text}`);
    }

    const json = await response.json();
    const parsed = updatePreapprovalPlanResponseSchema.parse(json);

    return {
      id: parsed.id,
      status: parsed.status,
      reason: parsed.reason ?? null,
      autoRecurring: parsed.auto_recurring ?? null,
      backUrl: parsed.back_url ?? null,
      initPoint: parsed.init_point ?? null,
      dateCreated: parsed.date_created ?? null,
      lastModified: parsed.last_modified ?? null,
      raw: json,
    };
  }

  // not part of the PaymentProvider contract yet. used by the webhook router
  // to resolve the underlying preapproval id from an authorized_payment event.
  // promote to the interface when a second provider needs the same lookup.
  async getAuthorizedPayment(
    authorizedPaymentId: string | number
  ): Promise<AuthorizedPaymentDetails | null> {
    const config = getMPConfig();
    const response = await fetch(
      `${config.apiBaseUrl}/authorized_payments/${encodeURIComponent(String(authorizedPaymentId))}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${config.accessToken}` },
      }
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `MP getAuthorizedPayment failed (${response.status}): ${text}`
      );
    }

    const json = await response.json();
    const parsed = authorizedPaymentResponseSchema.parse(json);

    return {
      preapprovalId: parsed.preapproval_id ?? null,
      paymentId: parsed.payment_id ?? null,
      externalReference: parsed.external_reference ?? null,
      status: parsed.status ?? null,
      statusDetail: parsed.status_detail ?? null,
      transactionAmount: parsed.transaction_amount ?? null,
      currencyId: parsed.currency_id ?? null,
      dateApproved: parsed.date_approved ?? parsed.date_created ?? null,
    };
  }

  // not part of the PaymentProvider contract yet. used by the webhook router
  // to recover the app user from the payment's external_reference when mp
  // does not propagate the plan's external_reference to the preapproval.
  async getPayment(paymentId: string | number): Promise<PaymentDetails | null> {
    const config = getMPConfig();
    const response = await fetch(
      `${config.apiBaseUrl}/v1/payments/${encodeURIComponent(String(paymentId))}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${config.accessToken}` },
      }
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MP getPayment failed (${response.status}): ${text}`);
    }

    const json = await response.json();
    const parsed = paymentResponseSchema.parse(json);

    return {
      externalReference: parsed.external_reference ?? null,
      payerEmail: parsed.payer?.email ?? null,
      status: parsed.status ?? null,
      statusDetail: parsed.status_detail ?? null,
      transactionAmount: parsed.transaction_amount ?? null,
      currencyId: parsed.currency_id ?? null,
      dateApproved: parsed.date_approved ?? parsed.date_created ?? null,
    };
  }

  async verifyWebhookSignature(
    req: Request,
    rawBody: string
  ): Promise<WebhookVerification> {
    return verifyMPWebhookSignature(req, rawBody);
  }

  // cancels or pauses a subscription. MP accepts 'cancelled' and 'paused'
  // as the only valid `status` values for this endpoint; we let the caller
  // decide. on 404 (idempotency: subscription already gone) we return
  // silently so the caller can replay the call safely.
  async cancelSubscription(
    providerSubscriptionId: string,
    options?: { status?: "cancelled" | "paused" }
  ): Promise<void> {
    const config = getMPConfig();
    const status = options?.status ?? "cancelled";

    const response = await fetch(
      `${config.apiBaseUrl}/preapproval/${encodeURIComponent(providerSubscriptionId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      }
    );

    if (response.status === 404) return;
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `MP cancelSubscription failed (${response.status}): ${text}`
      );
    }
    // 200 → the actual state change is delivered by the subsequent
    // subscription_preapproval.updated webhook, which the payments-webhook
    // handler persists. we intentionally do not parse the response body
    // here; the contract returns void and the webhook is the source of truth.
  }

  parseWebhookEvent(rawBody: string): NormalizedWebhookEvent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return {
        provider: "mercadopago",
        topic: "unknown",
        action: "",
        raw: rawBody,
      };
    }

    const preapproval = preapprovalWebhookSchema.safeParse(parsed);
    if (preapproval.success) {
      const isCreated = preapproval.data.action.includes("created");
      return {
        provider: "mercadopago",
        providerEventId: String(
          preapproval.data.id ?? preapproval.data.data.id
        ),
        providerSubscriptionId: String(preapproval.data.data.id),
        topic: isCreated ? "subscription.created" : "subscription.updated",
        action: preapproval.data.action,
        raw: parsed,
      };
    }

    const authPayment = authorizedPaymentWebhookSchema.safeParse(parsed);
    if (authPayment.success) {
      return {
        provider: "mercadopago",
        providerEventId: String(authPayment.data.data.id),
        providerPaymentId: String(authPayment.data.data.id),
        topic: "subscription.payment",
        action: authPayment.data.action,
        raw: parsed,
      };
    }

    return {
      provider: "mercadopago",
      topic: "unknown",
      action: "",
      raw: parsed,
    };
  }
}

// ─── paid-period end ─────────────────────────────────────────────────────────

// resolve the end of the period the subscriber has already paid for.
//
// `next_payment_date` is the next scheduled charge and, for an active
// preapproval, also the end of the current paid period. mp keeps the field
// after a cancellation. we only trust it when there is at least one
// successful charge (`summarized.last_charged_date`): before the first
// payment the date is just the first scheduled charge and does not
// represent paid access.
//
// when `next_payment_date` is missing we derive the period end from the
// last charge plus the recurrence (months or days).
function resolveCurrentPeriodEnd(input: {
  nextPaymentDate: string | null;
  lastChargedDate: string | null;
  frequency: number | null;
  frequencyType: string | null;
}): string | null {
  if (!input.lastChargedDate) return null;
  if (input.nextPaymentDate) return input.nextPaymentDate;
  if (!input.frequency || !input.frequencyType) return null;

  const lastCharged = new Date(input.lastChargedDate);
  if (Number.isNaN(lastCharged.getTime())) return null;

  const periodEnd = addRecurrence(
    lastCharged,
    input.frequency,
    input.frequencyType
  );
  return periodEnd ? periodEnd.toISOString() : null;
}

function addRecurrence(
  date: Date,
  frequency: number,
  frequencyType: string
): Date | null {
  if (frequencyType === "days") {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + frequency);
    return next;
  }

  if (frequencyType !== "months") return null;

  // clamp the day to the target month's last day (jan 31 + 1 month = feb 28).
  const day = date.getUTCDate();
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + frequency);
  const lastDayOfMonth = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
  ).getUTCDate();
  next.setUTCDate(Math.min(day, lastDayOfMonth));
  return next;
}
