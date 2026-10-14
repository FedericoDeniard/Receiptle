import { useState, useMemo, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { useMetricsData } from "../hooks/useMetricsData";
import { LoadingSpinner } from "../components/ui/LoadingSpinner";
import { parseDateSafe } from "../hooks/useFormatDate";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  CreditCard,
  PieChart as PieChartIcon,
  LayoutGrid,
  BarChart2,
  Activity,
} from "lucide-react";
import { Button } from "../components/ui/Button";
const MonthlyTrendChart = lazy(
  () => import("../components/charts/MonthlyTrendChart")
);
const MonthlyAreaChart = lazy(
  () => import("../components/charts/MonthlyAreaChart")
);
const CategoryPieChart = lazy(
  () => import("../components/charts/CategoryPieChart")
);
const CategoryTreeMapChart = lazy(
  () => import("../components/charts/CategoryTreeMapChart")
);
import { MetricCard } from "../components/metrics/MetricCard";
import { FilterBar } from "../components/metrics/FilterBar";
import { InsightsSection } from "../components/metrics/InsightsSection";
import { CurrencyComparison } from "../components/metrics/CurrencyComparison";
import type { MetricCardProps } from "../components/metrics/MetricCard";
import { getCurrencySymbol } from "../utils/currency";
import {
  type MetricPeriod,
  formatMonthLabel,
  getDateRange,
} from "../utils/period";

interface CategoryData {
  category: string;
  amount: number;
  percentage: number;
  count: number;
}

interface MonthlyData {
  month: string;
  income: number;
  expense: number;
  net: number;
}

export function Metrics() {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState<MetricPeriod>({
    kind: "rolling",
    days: 30,
  });
  const [selectedCurrency, setSelectedCurrency] = useState<string>("all");
  const [breakdownChartType, setBreakdownChartType] = useState<
    "pie" | "treemap"
  >("pie");
  const [trendChartType, setTrendChartType] = useState<"bar" | "area">("bar");

  const dateRange = useMemo(() => getDateRange(period), [period]);

  const {
    availableCurrencies,
    metrics,
    isLoadingAllPages: loading,
    error,
    filteredTransactions,
  } = useMetricsData({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    previousStartDate: dateRange.previousStartDate,
    previousEndDate: dateRange.previousEndDate,
    selectedCurrency,
  });

  const periodSubtitle = useMemo(() => {
    if (period.kind === "rolling") {
      return t("metrics.inLastPeriod", { days: period.days });
    }
    const monthLabel = formatMonthLabel(period.yearMonth, i18n.language);
    return t("metrics.inMonth", { month: monthLabel });
  }, [period, t, i18n.language]);

  const periodKey =
    period.kind === "rolling" ? `r-${period.days}` : `m-${period.yearMonth}`;

  const monthlyData = useMemo((): MonthlyData[] => {
    if (!filteredTransactions.length) return [];
    const monthlyMap = new Map<string, { income: number; expense: number }>();
    filteredTransactions.forEach(tx => {
      const date = parseDateSafe(tx.transaction_date);
      const monthKey = date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
      });
      if (!monthlyMap.has(monthKey))
        monthlyMap.set(monthKey, { income: 0, expense: 0 });
      const monthData = monthlyMap.get(monthKey)!;
      if (tx.transaction_type === "income") monthData.income += tx.amount;
      else monthData.expense += tx.amount;
    });
    return Array.from(monthlyMap.entries())
      .map(([month, data]) => ({
        month,
        income: data.income,
        expense: -data.expense,
        net: data.income - data.expense,
      }))
      .sort(
        (a, b) => new Date(a.month).getTime() - new Date(b.month).getTime()
      );
  }, [filteredTransactions]);

  const categoryData = useMemo((): CategoryData[] => {
    if (!filteredTransactions.length) return [];
    const total = metrics.totalExpense;
    const categoryMap = new Map<string, { amount: number; count: number }>();
    for (const tx of filteredTransactions) {
      if (tx.transaction_type !== "expense") continue;
      const category = tx.category || "other";
      if (!categoryMap.has(category))
        categoryMap.set(category, { amount: 0, count: 0 });
      const data = categoryMap.get(category)!;
      data.amount += tx.amount;
      data.count += 1;
    }
    return Array.from(categoryMap.entries())
      .map(([category, data]) => ({
        category,
        amount: data.amount,
        percentage: total > 0 ? (data.amount / total) * 100 : 0,
        count: data.count,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredTransactions, metrics.totalExpense]);

  const displayCurrency =
    selectedCurrency === "all"
      ? filteredTransactions[0]?.currency || "USD"
      : selectedCurrency;

  const metricCards: MetricCardProps[] = [
    {
      title: t("metrics.totalIncome"),
      value: `${getCurrencySymbol(displayCurrency)}${metrics.totalIncome.toFixed(2)}`,
      change: metrics.changes.income,
      icon: <TrendingUp className="size-5" />,
      currency: selectedCurrency === "all" ? displayCurrency : selectedCurrency,
    },
    {
      title: t("metrics.totalExpense"),
      value: `${getCurrencySymbol(displayCurrency)}${metrics.totalExpense.toFixed(2)}`,
      change: metrics.changes.expense,
      icon: <TrendingDown className="size-5" />,
      currency: selectedCurrency === "all" ? displayCurrency : selectedCurrency,
    },
    {
      title: t("metrics.netBalance"),
      value: `${getCurrencySymbol(displayCurrency)}${metrics.netBalance.toFixed(2)}`,
      change: metrics.changes.netBalance,
      icon: <DollarSign className="size-5" />,
      currency: selectedCurrency === "all" ? displayCurrency : selectedCurrency,
    },
    {
      title: t("metrics.averageTransaction"),
      value: `${getCurrencySymbol(displayCurrency)}${metrics.averageTransaction.toFixed(2)}`,
      change: metrics.changes.averageTransaction,
      icon: <CreditCard className="size-5" />,
      currency: selectedCurrency === "all" ? displayCurrency : selectedCurrency,
    },
  ];

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-[var(--error)] mb-2">{t("errors.loadingError")}</p>
          <Button variant="primary" size="md">
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <section
        data-tour="metrics-header"
        className="rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4 md:p-6 shadow-sm"
      >
        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
          <div className="shrink-0 mb-2 xl:mb-0">
            <h1 className="text-xl md:text-2xl font-semibold text-[var(--text-primary)]">
              {t("metrics.title")}
            </h1>
            <p className="mt-1 text-xs md:text-sm text-[var(--text-secondary)] line-clamp-2 md:line-clamp-none">
              {t("metrics.description")}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 xl:items-center xl:justify-end xl:flex-1 shrink-0">
            <FilterBar
              selectedPeriod={period}
              selectedCurrency={selectedCurrency}
              availableCurrencies={availableCurrencies}
              onPeriodChange={setPeriod}
              onCurrencyChange={setSelectedCurrency}
            />
          </div>
        </div>
      </section>

      <div data-tour="metrics-content">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <LoadingSpinner size="lg" />
          </div>
        ) : selectedCurrency === "all" && availableCurrencies.length > 1 ? (
          <div>
            <CurrencyComparison
              key={periodKey}
              transactions={filteredTransactions}
              getCurrencySymbol={getCurrencySymbol}
              onCurrencySelect={setSelectedCurrency}
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {metricCards.map(card => (
                <MetricCard
                  key={card.title}
                  title={card.title}
                  value={card.value}
                  change={card.change}
                  icon={card.icon}
                  currency={card.currency}
                />
              ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="bg-[var(--bg-secondary)] p-6 rounded-2xl flex flex-col relative">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                    {t("metrics.monthlyTrend")}
                  </h2>
                  <div className="flex bg-[var(--bg-primary)] rounded-lg p-1 border border-[var(--text-secondary)]/10">
                    <button
                      onClick={() => setTrendChartType("bar")}
                      aria-label={t("metrics.barChart", "Bar chart")}
                      aria-pressed={trendChartType === "bar"}
                      className={`p-1.5 rounded-md transition-colors ${trendChartType === "bar" ? "bg-[var(--primary)] text-white shadow-sm" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
                      title="Bar Chart"
                      type="button"
                    >
                      <BarChart2 size={16} />
                    </button>
                    <button
                      onClick={() => setTrendChartType("area")}
                      aria-label={t("metrics.areaChart", "Area chart")}
                      aria-pressed={trendChartType === "area"}
                      className={`p-1.5 rounded-md transition-colors ${trendChartType === "area" ? "bg-[var(--primary)] text-white shadow-sm" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
                      title="Area Chart"
                      type="button"
                    >
                      <Activity size={16} />
                    </button>
                  </div>
                </div>
                {trendChartType === "bar" ? (
                  <Suspense fallback={<LoadingSpinner />}>
                    <MonthlyTrendChart data={monthlyData} />
                  </Suspense>
                ) : (
                  <Suspense fallback={<LoadingSpinner />}>
                    <MonthlyAreaChart data={monthlyData} />
                  </Suspense>
                )}
              </div>
              <div className="bg-[var(--bg-secondary)] p-6 rounded-2xl flex flex-col relative">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                    {t("metrics.categoryBreakdown")}
                  </h2>
                  <div className="flex bg-[var(--bg-primary)] rounded-lg p-1 border border-[var(--text-secondary)]/10">
                    <button
                      onClick={() => setBreakdownChartType("pie")}
                      aria-label={t("metrics.pieChart", "Pie chart")}
                      aria-pressed={breakdownChartType === "pie"}
                      className={`p-1.5 rounded-md transition-colors ${breakdownChartType === "pie" ? "bg-[var(--primary)] text-white shadow-sm" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
                      title="Pie Chart"
                      type="button"
                    >
                      <PieChartIcon size={16} />
                    </button>
                    <button
                      onClick={() => setBreakdownChartType("treemap")}
                      aria-label={t("metrics.treemapChart", "Treemap")}
                      aria-pressed={breakdownChartType === "treemap"}
                      className={`p-1.5 rounded-md transition-colors ${breakdownChartType === "treemap" ? "bg-[var(--primary)] text-white shadow-sm" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
                      title="Treemap"
                      type="button"
                    >
                      <LayoutGrid size={16} />
                    </button>
                  </div>
                </div>
                {breakdownChartType === "pie" ? (
                  <Suspense fallback={<LoadingSpinner />}>
                    <CategoryPieChart data={categoryData} />
                  </Suspense>
                ) : (
                  <Suspense fallback={<LoadingSpinner />}>
                    <CategoryTreeMapChart data={categoryData} />
                  </Suspense>
                )}
              </div>
            </div>

            <InsightsSection
              data={{
                topCategory: metrics.topCategory,
                transactionCount: metrics.transactionCount,
                totalIncome: metrics.totalIncome,
                totalExpense: metrics.totalExpense,
              }}
              periodSubtitle={periodSubtitle}
              getCurrencySymbol={getCurrencySymbol}
              displayCurrency={displayCurrency}
            />
          </>
        )}
      </div>
    </div>
  );
}
