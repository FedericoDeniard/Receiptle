import { useTranslation } from "react-i18next";
import type { Database } from "../../types/database.types";
import {
  FREE_PLAN,
  type PricingCardData,
  readFeatureKeys,
} from "../../services/pricing";
import type { MySubscription } from "../../services/payments.service";
import { formatDateOnly } from "../../utils/format";
import { PricingCard } from "./PricingCard";

type PlanRow = Database["payments"]["Tables"]["plans"]["Row"];
type PlanVariantRow =
  Database["payments"]["Tables"]["plan_provider_variants"]["Row"];

type PlanWithVariants = PlanRow & {
  plan_provider_variants: PlanVariantRow[];
};

interface PricingGridProps {
  freePlan: typeof FREE_PLAN;
  dbPlans: PlanWithVariants[];
  subscription: MySubscription | null;
  pendingKey: string | null;
  onSelect: (key: string) => void;
}

interface DbCard {
  data: PricingCardData;
  isCurrent: boolean;
  accessUntilLabel: string | null;
}

// 3-up grid: free card (hardcoded) + db-backed plans. db plans
// rendered as cards use name + price + the active variant's
// currency. feature list comes from payments.plans.feature_keys
// (jsonb of i18n keys).
//
// the user's current plan (from the subscription row) gets a "current"
// badge. the highest-priced active variant is highlighted.
export function PricingGrid({
  freePlan,
  dbPlans,
  subscription,
  pendingKey,
  onSelect,
}: PricingGridProps) {
  const { t, i18n } = useTranslation();

  // map db plans → pricing card data. we take the first active variant
  // for amount/currency. if a plan has no active variant we skip it.
  const dbCards: DbCard[] = dbPlans
    .map(plan => {
      const variant = plan.plan_provider_variants.find(v => v.is_active);
      if (!variant) return null;
      const amount = Number(variant.amount);
      const isCurrent =
        subscription !== null &&
        subscription.plan_id === plan.id &&
        ["authorized", "pending", "paused", "pending_cancellation"].includes(
          subscription.status
        );
      const accessUntil =
        isCurrent &&
        subscription?.status === "pending_cancellation" &&
        subscription.access_until
          ? subscription.access_until
          : null;
      const accessUntilLabel = accessUntil
        ? t("accountBilling.accessUntil", {
            date: formatDateOnly(accessUntil, i18n.language),
          })
        : null;
      // feature_keys isn't in the generated PlanRow type yet (depends on
      // a fresh `bun docker:db:types` after the migration runs). the
      // cast + readFeatureKeys helper is safe either way: returns [] if
      // the column is missing.
      const featureKeys = readFeatureKeys(
        (plan as PlanRow & { feature_keys?: unknown }).feature_keys
      );
      const data: PricingCardData = {
        key: plan.id,
        displayName: plan.display_name,
        pricePerMonth: amount,
        currency: variant.currency,
        perLabel: t("accountBilling.pricing.perEditor"),
        perLabelKey: "accountBilling.pricing.perEditor",
        features: featureKeys,
        highlight: false,
        source: "db",
        dbPlan: plan,
      };
      return { data, isCurrent, accessUntilLabel };
    })
    .filter((x): x is DbCard => x !== null);

  // highlight the most expensive db plan
  const maxPrice = Math.max(0, ...dbCards.map(c => c.data.pricePerMonth));
  dbCards.forEach(c => {
    if (maxPrice > 0 && c.data.pricePerMonth === maxPrice) {
      c.data.highlight = true;
    }
  });

  // free card: current if user has no subscription OR subscription is
  // cancelled. (cancelled users fall back to free in the ui — they
  // keep free access until they re-subscribe.)
  const freeIsCurrent =
    !subscription ||
    subscription.status === "cancelled" ||
    !dbCards.some(c => c.isCurrent);

  const freeData: PricingCardData = {
    ...freePlan,
    key: freePlan.id,
    source: "free",
    highlight: false,
    perLabelKey: "accountBilling.pricing.perEditor",
    perLabel: t("accountBilling.pricing.perEditor"),
  };

  return (
    <div>
      <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <PricingCard
          data={freeData}
          isCurrent={freeIsCurrent}
          isLoading={pendingKey === freeData.key}
          accessUntilLabel={null}
          onSelect={onSelect}
        />
        {dbCards.map(({ data, isCurrent, accessUntilLabel }) => (
          <PricingCard
            key={data.key}
            data={data}
            isCurrent={isCurrent}
            isLoading={pendingKey === data.key}
            accessUntilLabel={accessUntilLabel}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
