import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { formatCurrencyCode } from "../../utils/currency";
import type {
  AdminRevenueSummary,
  AdminRevenueTotal,
} from "../../services/admin.service";
import { ChartSkeleton, Skeleton, SkeletonRegion } from "../ui/Skeleton";
import { StatCard } from "./StatCard";

const AdminRevenueChart = lazy(() => import("./AdminRevenueChart"));

const STAT_CARDS = [0, 1, 2, 3];

interface AdminRevenueBlockProps {
  summary: AdminRevenueSummary | null | undefined;
  loading: boolean;
  error?: Error | null;
}

function moneyByCurrency(
  totals: AdminRevenueTotal[],
  pick: (total: AdminRevenueTotal) => number,
  language: string
): string {
  if (totals.length === 0) return "—";
  return totals
    .map(total => formatCurrencyCode(pick(total), total.currency_id, language))
    .join(" · ");
}

export function AdminRevenueBlock({
  summary,
  loading,
  error,
}: AdminRevenueBlockProps) {
  const { t, i18n } = useTranslation();

  const totals = summary?.totals ?? [];
  const monthly = summary?.monthly ?? [];
  const paymentCount = totals.reduce((sum, total) => sum + total.payments, 0);
  const activeSubs = totals.reduce((sum, total) => sum + total.active_subs, 0);

  return (
    <section
      aria-label={t("admin.payments.revenue.title")}
      className="mt-6 rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-5"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {t("admin.payments.revenue.title")}
        </h3>
        <p className="text-xs text-[var(--text-secondary)]">
          {t("admin.payments.revenue.description")}
        </p>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {t("admin.payments.revenue.error")}
        </div>
      ) : loading ? (
        <SkeletonRegion className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STAT_CARDS.map(index => (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-secondary)] p-5"
              >
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-28" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
          <ChartSkeleton className="h-[240px]" />
        </SkeletonRegion>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t("admin.payments.revenue.mrr")}
              value={moneyByCurrency(totals, total => total.mrr, i18n.language)}
              hint={t("admin.payments.revenue.mrrHint", {
                count: activeSubs,
              })}
            />
            <StatCard
              label={t("admin.payments.revenue.collected")}
              value={moneyByCurrency(
                totals,
                total => total.collected_total,
                i18n.language
              )}
              hint={t("admin.payments.revenue.collectedHint")}
            />
            <StatCard
              label={t("admin.payments.revenue.collected30d")}
              value={moneyByCurrency(
                totals,
                total => total.collected_30d,
                i18n.language
              )}
              hint={t("admin.payments.revenue.collected30dHint")}
            />
            <StatCard
              label={t("admin.payments.revenue.payments")}
              value={totals.length > 0 ? paymentCount : "—"}
              hint={t("admin.payments.revenue.paymentsHint")}
            />
          </div>

          <div className="mt-5">
            <h4 className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              {t("admin.payments.revenue.monthlyTitle")}
            </h4>
            <div className="mt-3">
              <Suspense fallback={<ChartSkeleton className="h-[240px]" />}>
                <AdminRevenueChart monthly={monthly} />
              </Suspense>
            </div>
          </div>

          <p className="mt-3 text-xs text-[var(--text-secondary)]">
            {t("admin.payments.revenue.refundsNote")}
          </p>
        </>
      )}
    </section>
  );
}
