// payment provider contract.
//
// to add a new provider (e.g. stripe):
//   1. create _shared/lib/payments/<provider>/{client,webhook,types,config}.ts
//      implementing the PaymentProvider interface below.
//   2. register the provider in _shared/lib/payments/index.ts.
//   3. add a migration extending the public.provider_name enum:
//        alter type public.provider_name add value 'stripe';
//
// this file is provider-agnostic. do not import any third-party SDK here.

export type ProviderName = "mercadopago";

// partial update of a plan. every field is optional; the provider applies
// a partial-update semantics where omitted fields are left untouched. the
// caller is responsible for keeping any local mirror (e.g.
// payments.plans) in sync after a successful call.
export interface UpdatePlanInput {
  reason?: string;
  transactionAmount?: number;
  currencyId?: string;
  frequency?: number;
  frequencyType?: "months" | "days";
  // mapped to the provider's free-trial field. only set if > 0.
  trialDays?: number;
  backUrl?: string;
  // mp-specific: stamps a per-user identifier on the plan. mp does not
  // reliably propagate it to the preapproval created by the hosted
  // checkout, so payments-webhook also recovers the user from the
  // payment's external_reference. not in the documented create/update
  // params, but accepted and returned by the api.
  externalReference?: string;
}

export interface PlanDetails {
  id: string;
  status: string;
  reason: string | null;
  // the full auto_recurring block as returned by the provider. we keep it
  // untyped because the schema varies per provider (mp nests frequency /
  // amount / currency inside auto_recurring; stripe uses price_data
  // with a different shape). callers that need specific fields should
  // cast or destructure with care.
  autoRecurring: unknown;
  backUrl: string | null;
  initPoint: string | null;
  dateCreated: string | null;
  lastModified: string | null;
  raw: unknown;
}

export interface SubscriptionDetails {
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
  // when the subscription is associated with a preapproval plan, this is
  // the id of that plan in mp. lets the webhook resolve plan_id in our db.
  preapprovalPlanId: string | null;
  raw: unknown;
}

export interface PaymentDetails {
  externalReference: string | null;
  payerEmail: string | null;
}

export type WebhookVerification =
  | { valid: true; ts: number; requestId: string | null }
  | {
      valid: false;
      reason:
        | "missing_signature"
        | "malformed"
        | "ts_out_of_range"
        | "hash_mismatch";
    };

// normalized webhook topics. each provider maps its own raw events to one of these.
// adding a new normalized topic here is a contract change that affects:
//   - the audit columns / event processing logic in payments-webhook
//   - downstream consumers that react to specific topics
export type NormalizedWebhookTopic =
  | "subscription.created"
  | "subscription.updated"
  | "subscription.payment"
  | "unknown";

export interface NormalizedWebhookEvent {
  provider: ProviderName;
  // providerEventId = the id of the individual delivery (e.g. payment id for
  // subscription.payment, or a unique delivery id for preapproval events).
  providerEventId?: string;
  // providerSubscriptionId = the id of the underlying subscription.
  // may be missing for subscription.payment events; in that case the webhook
  // router resolves it via provider.getAuthorizedPayment(...).
  providerSubscriptionId?: string;
  providerPaymentId?: string;
  topic: NormalizedWebhookTopic;
  action: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  getSubscription(
    providerSubscriptionId: string
  ): Promise<SubscriptionDetails | null>;
  // plan lookup. used in plan-based flow where the seller pre-creates
  // plans and create-subscription hands back the plan's checkout url
  // instead of creating a brand-new preapproval each time.
  getPlan(planId: string): Promise<{ id: string; initPoint: string } | null>;
  // partial update of a plan. returns the updated plan, or null if the
  // provider could not find it (typically 404). throws on any other
  // provider-side error (400, 401, 500) or on an empty input.
  updatePlan(
    planId: string,
    input: UpdatePlanInput
  ): Promise<PlanDetails | null>;
  // cancel or pause a subscription. idempotent: returns void on 404.
  // `options.status` defaults to 'cancelled'. we do not return the
  // updated subscription here — MP dispatches a webhook that the existing
  // handler persists, which is the single source of truth for status.
  cancelSubscription(
    providerSubscriptionId: string,
    options?: { status?: "cancelled" | "paused" }
  ): Promise<void>;
  verifyWebhookSignature(
    req: Request,
    rawBody: string
  ): Promise<WebhookVerification>;
  parseWebhookEvent(rawBody: string): NormalizedWebhookEvent;
}
