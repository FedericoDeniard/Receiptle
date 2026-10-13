import { LazyMotion, m, domAnimation } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import type { MetricPeriod } from "../../utils/period";
import { currentYearMonth, isValidYearMonth } from "../../utils/period";

interface FilterBarProps {
  selectedPeriod: MetricPeriod;
  selectedCurrency: string;
  availableCurrencies: string[];
  onPeriodChange: (period: MetricPeriod) => void;
  onCurrencyChange: (currency: string) => void;
}

export function FilterBar({
  selectedPeriod,
  selectedCurrency,
  availableCurrencies,
  onPeriodChange,
  onCurrencyChange,
}: FilterBarProps) {
  const { t } = useTranslation();

  const rollingOptions: { value: 30 | 90 | 365; label: string }[] = [
    { value: 30, label: t("metrics.last30Days") },
    { value: 90, label: t("metrics.last90Days") },
    { value: 365, label: t("metrics.lastYear") },
  ];

  const monthValue =
    selectedPeriod.kind === "month" &&
    isValidYearMonth(selectedPeriod.yearMonth)
      ? selectedPeriod.yearMonth
      : currentYearMonth();

  return (
    <LazyMotion features={domAnimation}>
      <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full sm:w-auto items-stretch sm:items-center">
        <div className="flex gap-2">
          <m.select
            value={selectedCurrency}
            onChange={e => onCurrencyChange(e.target.value)}
            className="w-full sm:w-auto px-3 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-medium bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-transparent hover:border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer transition-[color,background-color,border-color,box-shadow,opacity,transform] appearance-none h-8 md:h-9"
            whileFocus={{ scale: 1.01 }}
            whileHover={{ scale: 1.01 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <option value="all">{t("metrics.allCurrencies")}</option>
            {availableCurrencies.map(currency => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </m.select>
        </div>

        <div className="flex flex-wrap gap-1 bg-[var(--bg-secondary)] p-1 rounded-lg shrink-0 items-center">
          {rollingOptions.map(option => {
            const isSelected =
              selectedPeriod.kind === "rolling" &&
              selectedPeriod.days === option.value;
            return (
              <Button
                key={option.value}
                onClick={() =>
                  onPeriodChange({ kind: "rolling", days: option.value })
                }
                variant="outline"
                size="sm"
                selected={isSelected}
                className="flex-1 sm:flex-none text-xs md:text-sm h-6 md:h-7 px-2 md:px-3 whitespace-nowrap"
              >
                {option.label}
              </Button>
            );
          })}
          <Button
            onClick={() =>
              onPeriodChange({ kind: "month", yearMonth: monthValue })
            }
            variant="outline"
            size="sm"
            selected={selectedPeriod.kind === "month"}
            className="flex-1 sm:flex-none text-xs md:text-sm h-6 md:h-7 px-2 md:px-3 whitespace-nowrap"
          >
            {t("metrics.specificMonth")}
          </Button>
        </div>

        {selectedPeriod.kind === "month" && (
          <input
            type="month"
            value={monthValue}
            max={currentYearMonth()}
            onChange={e => {
              const value = e.target.value;
              if (isValidYearMonth(value)) {
                onPeriodChange({ kind: "month", yearMonth: value });
              }
            }}
            aria-label={t("metrics.specificMonth")}
            className="px-2 h-7 md:h-7 rounded-md text-xs md:text-sm font-medium bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-transparent hover:border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer transition-[color,background-color,border-color,box-shadow,opacity,transform] appearance-none"
          />
        )}
      </div>
    </LazyMotion>
  );
}
