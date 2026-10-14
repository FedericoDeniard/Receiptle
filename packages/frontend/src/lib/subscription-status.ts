/**
 * Subscription status vocabulary for the frontend.
 *
 * Single source of truth for "is this subscription currently paying
 * us?". Mirrored in:
 *   - `supabase/functions/_shared/capabilities.ts` (server-side auth gate)
 *   - `supabase/migrations/20260705143044_add_default_capabilities_and_view.sql`
 *     (the WHERE clause in `payments.user_capabilities_v`)
 *   - `packages/frontend/src/pages/AccountBilling.tsx` (Cancel button visibility)
 *
 * Statuses that grant entitlements. A user with a subscription in
 * any of these statuses keeps their capabilities until the status
 * leaves the set (e.g. via a webhook updating `cancelled` or
 * `payment_failed`).
 *
 * The constant is exported as a `Set` (O(1) lookup) for the runtime
 * checks and as a tuple (for type derivation). If a new status is
 * ever added in `payments.subscriptions.status`, this file is the
 * one to update.
 */
import type { Database } from "../types/database.types";

type DbSubscriptionStatus = NonNullable<
  Database["payments"]["Tables"]["subscriptions"]["Row"]["status"]
>;

export const ACTIVE_SUBSCRIPTION_STATUSES = [
  "authorized",
  "pending",
  "paused",
  "pending_cancellation",
] as const satisfies readonly DbSubscriptionStatus[];

export type ActiveSubscriptionStatus =
  (typeof ACTIVE_SUBSCRIPTION_STATUSES)[number];

const ACTIVE_STATUS_SET: ReadonlySet<string> = new Set(
  ACTIVE_SUBSCRIPTION_STATUSES
);

/**
 * Type-guard: is this status one we treat as "still has entitlements"?
 *
 * Strict — anything outside the set returns false rather than throwing.
 * Use this at any site that branches on paid vs free (panel CTA,
 * capability-gated UI, etc.).
 */
export function isActiveSubscriptionStatus(
  status: string | null | undefined
): status is ActiveSubscriptionStatus {
  return typeof status === "string" && ACTIVE_STATUS_SET.has(status);
}
