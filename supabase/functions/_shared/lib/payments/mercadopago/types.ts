// zod schemas and ts types for mercado pago subscription payloads.
// these are provider-specific; do not import from the generic _shared/lib/payments/types.ts.

import { z } from "npm:zod@4.4.3";

// ─── webhook payloads ─────────────────────────────────────────────────────────

// preapproval events arrive on the subscription_preapproval topic. MP sends
// `data.id` as the preapproval id (i.e. the subscription id).
export const preapprovalWebhookSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  type: z.literal("subscription_preapproval"),
  action: z.string(),
  date_created: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
  api_version: z.string().optional(),
  live_mode: z.boolean().optional(),
  data: z.object({
    id: z.union([z.string(), z.number()]),
  }),
});

// authorized_payment events arrive on the subscription_authorized_payment topic.
// `data.id` is the authorized_payment id (not the preapproval id). resolving
// the underlying subscription requires a follow-up GET to /authorized_payments/{id}.
export const authorizedPaymentWebhookSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  type: z.literal("subscription_authorized_payment"),
  action: z.string(),
  date_created: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
  api_version: z.string().optional(),
  live_mode: z.boolean().optional(),
  data: z.object({
    id: z.union([z.string(), z.number()]),
  }),
});

// ─── /preapproval api response ───────────────────────────────────────────────

export const preapprovalResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  reason: z.string().optional().nullable(),
  payer_email: z.string().optional().nullable(),
  auto_recurring: z
    .object({
      frequency: z.number().optional(),
      frequency_type: z.string().optional(),
      transaction_amount: z.number().optional().nullable(),
      currency_id: z.string().optional(),
    })
    .optional()
    .nullable(),
  external_reference: z.string().optional().nullable(),
  back_url: z.string().optional().nullable(),
  date_created: z.string().optional(),
  last_modified: z.string().optional(),
  // present when the preapproval is associated with a plan; lets us link
  // the subscription back to our payments.plans row via the
  // plan_provider_variants table.
  preapproval_plan_id: z.string().optional().nullable(),
});

// ─── /authorized_payments/{id} response ──────────────────────────────────────

export const authorizedPaymentResponseSchema = z.object({
  id: z.number(),
  status: z.string(),
  preapproval_id: z.string().optional().nullable(),
  payment_id: z.number().optional().nullable(),
  external_reference: z.string().optional().nullable(),
});

export type AuthorizedPaymentResponse = z.infer<
  typeof authorizedPaymentResponseSchema
>;

// ─── /v1/payments/{id} response ──────────────────────────────────────────────
// only the fields the webhook needs to recover the app user when mp does not
// propagate the plan's external_reference to the preapproval.

export const paymentResponseSchema = z.object({
  id: z.number(),
  external_reference: z.string().optional().nullable(),
  payer: z
    .object({
      email: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

// ─── update preapproval plan response (PUT /preapproval_plan/{id}) ────────
// the response shape mirrors the create-preapproval-plan response plus a
// `last_modified` timestamp. we only validate the fields the caller reads
// directly; the rest is exposed via the `raw` field for forense.
export const updatePreapprovalPlanResponseSchema = z.object({
  id: z.string(),
  application_id: z.number().optional(),
  collector_id: z.number().optional(),
  status: z.string(),
  reason: z.string().optional().nullable(),
  auto_recurring: z.unknown().optional().nullable(),
  payment_methods_allowed: z.unknown().optional().nullable(),
  back_url: z.string().optional().nullable(),
  external_reference: z.string().optional().nullable(),
  init_point: z.string().optional(),
  date_created: z.string().optional(),
  last_modified: z.string().optional(),
});
