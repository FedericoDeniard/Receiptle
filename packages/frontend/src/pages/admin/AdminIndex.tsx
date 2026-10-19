import { useTranslation } from "react-i18next";
import { AdminShell } from "../../components/admin/AdminShell";
import { AdminStatsSkeleton } from "../../components/admin/AdminStatsSkeleton";
import { StatCard } from "../../components/admin/StatCard";
import { useAdminStats } from "../../hooks/useAdminStats";
import { formatDateSafe } from "../../utils/format";

export function AdminIndex() {
  const { t, i18n } = useTranslation();
  const statsQuery = useAdminStats();
  const stats = statsQuery.data;

  return (
    <AdminShell>
      {statsQuery.isLoading ? (
        <AdminStatsSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t("admin.stats.mrr")}
            value={
              stats && stats.mrr.length > 0
                ? stats.mrr
                    .map(
                      m =>
                        `${m.currency} ${m.mrr_amount.toLocaleString()} (${m.subs})`
                    )
                    .join(" · ")
                : "—"
            }
            hint={t("admin.stats.mrrHint")}
          />
          <StatCard
            label={t("admin.stats.activeSubs")}
            value={stats?.active_subscriptions ?? "—"}
            hint={t("admin.stats.activeSubsHint")}
          />
          <StatCard
            label={t("admin.stats.churn30d")}
            value={stats ? `${stats.churn_30d_pct}%` : "—"}
            hint={
              stats
                ? t("admin.stats.churnHint", { count: stats.cancelled_30d })
                : undefined
            }
          />
          <StatCard
            label={t("admin.stats.generatedAt")}
            value={
              stats ? formatDateSafe(stats.generated_at, i18n.language) : "—"
            }
          />
        </div>
      )}
    </AdminShell>
  );
}
