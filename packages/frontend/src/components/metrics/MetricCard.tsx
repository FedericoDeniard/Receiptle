import { LazyMotion, m, domAnimation } from "framer-motion";
import { useTranslation } from "react-i18next";
import { TrendingUp, TrendingDown } from "lucide-react";

export interface MetricCardProps {
  title: string;
  value: string;
  change: number | null;
  icon: React.ReactNode;
  currency?: string;
}

export function MetricCard({
  title,
  value,
  change,
  icon,
  currency,
}: MetricCardProps) {
  const { t } = useTranslation();
  const isPositive = change !== null && change > 0;
  const isNeutral = change === null || change === 0;

  return (
    <LazyMotion features={domAnimation}>
      <div className="p-6 rounded-xl border border-[#3d5a80]/15 hover:border-[#3d5a80]/30 transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-300">
        <div className="flex items-start justify-between mb-4">
          <div className="p-2 rounded-lg bg-[#3d5a80]/15 text-[#3d5a80]">
            {icon}
          </div>
          {currency && (
            <span className="text-xs font-medium text-[#3d5a80]/70">
              {currency}
            </span>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-[var(--text-secondary)] mb-1">
            {title}
          </p>
          <m.p
            className="text-2xl font-bold text-[var(--text-primary)] tracking-tight"
            key={value}
            initial={{ opacity: 0.5, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {value}
          </m.p>

          <div className="flex items-center mt-3 text-sm">
            <div
              className={`flex items-center px-2 py-0.5 rounded-full ${
                isNeutral
                  ? "text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border)]"
                  : isPositive
                    ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20"
                    : "text-rose-600 bg-rose-50 dark:bg-rose-900/20"
              }`}
            >
              {isNeutral ? (
                <div className="size-3 mr-1 flex items-center justify-center">
                  <div className="w-2 h-0.5 bg-current rounded-full"></div>
                </div>
              ) : isPositive ? (
                <TrendingUp className="size-3 mr-1" />
              ) : (
                <TrendingDown className="size-3 mr-1" />
              )}
              <span className="font-medium">
                {change !== null ? Math.abs(change).toFixed(1) : "0.0"}%
              </span>
            </div>
            <span className="text-[var(--text-secondary)] text-xs ml-2 opacity-60">
              {t("metrics.vsLastPeriod")}
            </span>
          </div>
        </div>
      </div>
    </LazyMotion>
  );
}
