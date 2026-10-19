import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, BarChart2 } from "lucide-react";
import { ChartSkeleton } from "../ui/Skeleton";

const CategoryTreeMapChart = lazy(
  () => import("../charts/CategoryTreeMapChart")
);

interface CategoryDatum {
  category: string;
  amount: number;
  percentage: number;
  count: number;
}

interface DashboardChartsProps {
  categoryData: CategoryDatum[];
  hasData: boolean;
}

export function DashboardCharts({
  categoryData,
  hasData,
}: DashboardChartsProps) {
  const { t } = useTranslation();

  if (!hasData) {
    return (
      <div className="rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-[var(--bg-secondary)] p-2 text-[var(--text-secondary)]">
            <BarChart2 size={18} />
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {t("dashboardOverview.charts.noData")}
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {t("dashboardOverview.charts.noDataSubtitle")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label={t("dashboardOverview.charts.categoryBreakdown")}
      className="rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-5 shadow-sm"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {t("dashboardOverview.charts.categoryBreakdown")}
        </h2>
        <Link
          to="/metrics"
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--button-primary)] hover:underline"
        >
          {t("dashboardOverview.charts.viewMore")}
          <ArrowRight size={14} />
        </Link>
      </div>
      <Suspense fallback={<ChartSkeleton />}>
        <CategoryTreeMapChart data={categoryData} />
      </Suspense>
    </section>
  );
}
