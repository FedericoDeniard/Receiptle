import { useTranslation } from "react-i18next";
import { useRecharts } from "../../hooks/useRecharts";
import { formatCurrencyCode } from "../../utils/currency";
import { formatMonthShort } from "../../utils/format";
import type { AdminRevenueMonth } from "../../services/admin.service";

interface AdminRevenueChartProps {
  monthly: AdminRevenueMonth[];
}

const CHART_COLORS = [
  "var(--primary)",
  "var(--accent)",
  "var(--success)",
  "var(--warning)",
  "var(--text-secondary)",
];

export default function AdminRevenueChart({ monthly }: AdminRevenueChartProps) {
  const { t, i18n } = useTranslation();
  const {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
  } = useRecharts();

  const currencies = Array.from(
    new Set(monthly.map(point => point.currency_id))
  );
  const months = Array.from(new Set(monthly.map(point => point.month))).sort();

  if (months.length === 0 || currencies.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-[var(--text-secondary)]">
        {t("admin.payments.revenue.monthlyEmpty")}
      </div>
    );
  }

  const monthLabel = (month: string) => formatMonthShort(month, i18n.language);

  return (
    <div className="flex flex-col gap-6">
      {currencies.map((currency, index) => {
        const data = months.map(month => {
          const point = monthly.find(
            entry => entry.month === month && entry.currency_id === currency
          );
          return {
            month: monthLabel(month),
            collected: point?.collected ?? 0,
          };
        });

        return (
          <div key={currency}>
            {currencies.length > 1 ? (
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                {currency}
              </p>
            ) : null}
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={data}
                margin={{ top: 5, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--text-secondary)"
                  strokeOpacity={0.2}
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                  tickFormatter={(value: number) =>
                    Math.abs(value) >= 1000
                      ? `${Math.round(value / 1000)}k`
                      : String(value)
                  }
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--bg-secondary)",
                    border: "1px solid var(--text-secondary)",
                    borderRadius: "8px",
                  }}
                  labelStyle={{ color: "var(--text-primary)" }}
                  formatter={(value: unknown) => [
                    formatCurrencyCode(
                      Number(value ?? 0),
                      currency,
                      i18n.language
                    ),
                    t("admin.payments.revenue.collected"),
                  ]}
                />
                <Bar
                  dataKey="collected"
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
