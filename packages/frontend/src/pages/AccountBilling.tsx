import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useAvailablePlans } from "../hooks/useAvailablePlans";
import { useMySubscription } from "../hooks/useMySubscription";
import {
  useCreateCheckoutLink,
  useInvalidatePaymentsQueries,
} from "../hooks/useCreateCheckoutLink";
import { useCancelSubscription } from "../hooks/useCancelSubscription";
import { PricingGrid } from "../components/account-billing/PricingGrid";
import { AccountBillingSkeleton } from "../components/account-billing/AccountBillingSkeleton";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { toast } from "../utils/toast";
import { getEdgeFunctionErrorMessage } from "../utils/edge-function-errors";
import type { MySubscription } from "../services/payments.service";
import { FREE_PLAN } from "../services/pricing";
import { formatDateOnly } from "../utils/format";
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  isActiveSubscriptionStatus,
} from "../lib/subscription-status";

// statuses where the cancel button is visible. `cancelled` and
// `pending_cancellation` are excluded because the user has already
// kicked off cancellation — there's nothing left to cancel. We
// take the active-status set and drop `pending_cancellation` for
// this single use case; the rest of the codebase uses the full set.
const CANCELLABLE_STATUSES = new Set(
  ACTIVE_SUBSCRIPTION_STATUSES.filter(s => s !== "pending_cancellation")
);

export function AccountBilling() {
  const { t, i18n } = useTranslation();
  const { user, refreshUser } = useAuth();
  const userId = user?.id;
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: subscription, isLoading: isLoadingSub } =
    useMySubscription(userId);
  const { data: plans, isLoading: isLoadingPlans } = useAvailablePlans();

  const createCheckoutLink = useCreateCheckoutLink();
  const cancelSubscription = useCancelSubscription();
  const invalidatePayments = useInvalidatePaymentsQueries();

  const [cancelTarget, setCancelTarget] = useState<MySubscription | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // when mp redirects the user back here with ?subscribed=1 we toast a
  // confirmation and invalidate the subscription cache so the new plan
  // shows up. we also refresh the JWT so the `user_capabilities` and
  // `user_role` claims reflect the new entitlements before the user
  // navigates elsewhere (otherwise the Settings → Usage panel can show
  // a stale scope for the first few seconds).
  useEffect(() => {
    if (searchParams.get("subscribed") === "1") {
      invalidatePayments();
      void refreshUser();
      toast.success(t("accountBilling.toast.subscribed"));
      const next = new URLSearchParams(searchParams);
      next.delete("subscribed");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, invalidatePayments, refreshUser, t]);

  // tier click. the pricing card key is the plan id (for db plans) or
  // "free" (for the free card). only db plans route through
  // create-subscription — free has no checkout.
  const handleSelect = async (key: string) => {
    if (key === "free") return;
    const plan = plans?.find(p => p.id === key);
    const variant = plan?.plan_provider_variants.find(v => v.is_active);
    if (!plan || !variant) {
      toast.error(t("accountBilling.toast.noActiveVariant"));
      return;
    }

    setPendingKey(key);
    try {
      const result = await createCheckoutLink.mutateAsync({
        planId: plan.id,
        provider: variant.provider,
      });
      toast.info(t("accountBilling.toast.checkoutOpened"));
      window.location.href = result.initPoint;
    } catch (error) {
      // getEdgeFunctionErrorMessage substitutes "This is a premium
      // feature" when the server rejected us with a requireMinRole /
      // requireCapability 403. For any other error it falls back to the
      // raw message. See packages/frontend/src/utils/edge-function-errors.ts.
      const message = getEdgeFunctionErrorMessage(error, t);
      console.error("[billing] checkout link failed", { error, message });
      toast.error(t("accountBilling.toast.subscribeError"), message);
      setPendingKey(null);
    }
  };

  const handleConfirmCancel = async () => {
    try {
      await cancelSubscription.mutateAsync();
      toast.success(t("accountBilling.toast.cancelSuccess"));
      invalidatePayments();
      setCancelTarget(null);
    } catch (error) {
      // Same premium-feature substitution as above; see edge-function-errors.
      const message = getEdgeFunctionErrorMessage(error, t);
      toast.error(t("accountBilling.toast.cancelError"), message);
    }
  };

  const isLoading = isLoadingSub || isLoadingPlans;

  // pending_cancellation keeps the plan active until the paid period ends.
  // surface the end date so the user knows exactly when access stops.
  const accessUntil =
    subscription?.status === "pending_cancellation"
      ? (subscription.access_until ?? null)
      : null;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-8 flex flex-col gap-6">
      <section className="rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4 md:p-6 shadow-sm">
        <h1 className="text-xl md:text-2xl font-semibold text-[var(--text-primary)]">
          {t("accountBilling.title")}
        </h1>
        <p className="mt-1 text-xs md:text-sm text-[var(--text-secondary)]">
          {t("accountBilling.description")}
        </p>
        {accessUntil && (
          <p className="mt-3 inline-flex rounded-full bg-[var(--primary)]/10 px-3 py-1 text-xs font-medium text-[var(--primary)]">
            {t("accountBilling.accessUntil", {
              date: formatDateOnly(accessUntil, i18n.language),
            })}
          </p>
        )}
      </section>

      {isLoading ? (
        <AccountBillingSkeleton />
      ) : (
        <PricingGrid
          freePlan={FREE_PLAN}
          dbPlans={plans ?? []}
          subscription={subscription ?? null}
          pendingKey={pendingKey}
          onSelect={handleSelect}
        />
      )}

      {subscription &&
        subscription.plan_id &&
        isActiveSubscriptionStatus(subscription.status) &&
        CANCELLABLE_STATUSES.has(subscription.status as never) && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setCancelTarget(subscription)}
              disabled={cancelSubscription.isPending}
              className="text-sm text-[var(--text-secondary)] hover:text-red-600 hover:underline disabled:opacity-50"
            >
              {cancelSubscription.isPending
                ? t("accountBilling.cancel.cancelling")
                : t("accountBilling.cancel.trigger")}
            </button>
          </div>
        )}

      <ConfirmModal
        isOpen={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancel}
        title={t("accountBilling.cancel.title")}
        message={t("accountBilling.cancel.description")}
        confirmText={t("accountBilling.cancel.confirm")}
        cancelText={t("common.cancel")}
        isDestructive
        isLoading={cancelSubscription.isPending}
      />
    </div>
  );
}
