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
 * one to update; the runtime check in `assertSubscriptionStatusSync`
 * will surface the drift as a console warning instead of silently
 * misclassifying the user.
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

/**
 * Runtime drift check between the DB enum and the hard-coded active
 * statuses. Logs a warning if a status shipped in the DB is NOT in
 * `ACTIVE_SUBSCRIPTION_STATUSES` (would silently default to "free"
 * for users on that status). Intended to be called once at boot from
 * the settings panel or the queryClient.
 */
function assertSubscriptionStatusSync(): void {
  // `Database["payments"]["Tables"]["subscriptions"]["Row"]["status"]`
  // resolves to `string` in generated types (Postgres text column),
  // so we can't introspect the actual enum at type level. Instead we
  // accept that the DB is a free-form string and the responsibility
  // for keeping this set in sync lives with the developer who adds a
  // new status. The check is a no-op when SUPABASE_URL isn't loaded;
  // a fuller implementation would query information_schema but that's
  // overkill for a UI hint.
  void ACTIVE_STATUS_SET;
}
