// the free plan is a hardcoded baseline — it has no row in
// payments.plans and no mp variant. always rendered on the account
// billing page regardless of what paid plans exist. the rest of the
// pricing grid comes from useAvailablePlans (db-backed) so adding
// new paid plans there automatically shows up here.

import type { Database } from "../types/database.types";

type PlanRow = Database["payments"]["Tables"]["plans"]["Row"];

type Currency = string;

export interface FreePlanCard {
  kind: "free";
  id: "free";
  displayName: string;
  pricePerMonth: number;
  currency: Currency;
  perLabel: string;
  /** i18n keys for the feature list, in display order. */
  features: readonly string[];
}

export const FREE_PLAN: FreePlanCard = {
  kind: "free",
  id: "free",
  displayName: "Free",
  pricePerMonth: 0,
  currency: "USD",
  perLabel: "Per user",
  // free = full access minus the AI/automation features. manual
  // transactions + dashboard + filters are the core of the app; the
  // paid tier adds Gmail sync, the AI assistant, and push notifications.
  features: [
    "accountBilling.pricing.free.features.manualTransactions",
    "accountBilling.pricing.free.features.dashboard",
    "accountBilling.pricing.free.features.searchAndFilters",
  ],
};

// shape that pricing cards render from. db plans and the free plan
// both get mapped into this so the grid renders them uniformly.
export interface PricingCardData {
  key: string;
  displayName: string;
  pricePerMonth: number;
  currency: Currency;
  perLabel: string;
  /** i18n key for "per X" suffix. */
  perLabelKey: string;
  /** either i18n keys (preferred) or already-translated strings. */
  features: readonly string[];
  highlight: boolean;
  source: "free" | "db";
  dbPlan?: PlanRow;
}

// supabase-js returns jsonb as `unknown` (or as a string in some
// client modes). we coerce defensively so the pricing card always
// receives a clean string[] regardless of how supabase serializes the
// column. the column is jsonb on the server, so the parsed shape is
// always string[].
export function readFeatureKeys(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string");
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // fall through
    }
  }
  return [];
}
