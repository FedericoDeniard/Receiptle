import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Archive, ArrowRight, FileText } from "lucide-react";
import { cn } from "../../lib/utils";
import { formatCurrency } from "../../utils/currency";
import type { ReportSummary } from "../../types/reports";

interface ReportCardProps {
  report: ReportSummary;
}

export function ReportCard({ report }: ReportCardProps) {
  const { t } = useTranslation();

  return (
    <Link
      to={`/reports/${report.id}`}
      aria-labelledby={`report-${report.id}-title`}
      className="group flex flex-col gap-4 rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-5 shadow-sm transition-[color,background-color,border-color,box-shadow,opacity,transform] hover:shadow-md hover:border-[var(--text-secondary)]/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="size-10 shrink-0 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center">
            <FileText size={18} className="text-[var(--text-secondary)]" />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id={`report-${report.id}-title`}
              className="text-base font-semibold text-[var(--text-primary)] truncate group-hover:text-[var(--primary)] transition-colors"
            >
              {report.title}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              <DateRangeLabel
                from={report.dateRangeStart}
                to={report.dateRangeEnd}
              />
            </p>
          </div>
        </div>
        {report.status === "archived" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 text-zinc-700 text-xs px-2 py-0.5 shrink-0">
            <Archive size={12} />
            {t("reports.archived", "Archived")}
          </span>
        )}
      </header>

      {report.description && (
        <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
          {report.description}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {report.perCurrency.map(bucket => (
          <CurrencyChip
            key={bucket.currency}
            currency={bucket.currency}
            count={bucket.transactionCount}
            net={bucket.net}
          />
        ))}
        {report.perCurrency.length === 0 && (
          <span className="text-xs text-[var(--text-secondary)]">
            {t("reports.noTransactions", "No transactions in this report yet")}
          </span>
        )}
      </div>

      <footer className="flex items-center justify-between pt-3 mt-auto border-t border-[var(--text-secondary)]/10">
        <span className="text-xs text-[var(--text-secondary)]">
          {t("reports.summary.count", {
            count: report.totalCount,
            defaultValue: "{{count}} transactions",
          })}
        </span>
        <ArrowRight
          size={14}
          className="text-[var(--text-secondary)] group-hover:text-[var(--primary)] group-hover:translate-x-0.5 transition-[color,background-color,border-color,box-shadow,opacity,transform]"
          aria-hidden
        />
      </footer>
    </Link>
  );
}

function CurrencyChip({
  currency,
  count,
  net,
}: {
  currency: string;
  count: number;
  net: number;
}) {
  // The service should never pass a null/undefined currency, but guard anyway
  // so a bad row never renders the literal string "null".
  if (!currency) return null;
  const positive = net >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
        "bg-[var(--bg-secondary)] border-[var(--text-secondary)]/15"
      )}
    >
      <span className="font-mono text-[var(--text-secondary)]">{currency}</span>
      <span
        className={cn(
          "font-semibold",
          positive ? "text-emerald-700" : "text-rose-700"
        )}
      >
        {formatCurrency(net, currency)}
      </span>
      <span className="text-[var(--text-secondary)]">· {count}</span>
    </span>
  );
}

function DateRangeLabel({
  from,
  to,
}: {
  from: string | null;
  to: string | null;
}) {
  const { t } = useTranslation();
  if (!from && !to) {
    return <>{t("reports.dateRange.none", "No date range")}</>;
  }
  if (from && to) {
    return (
      <>
        {t("reports.dateRange.fromTo", "{{from}} → {{to}}", {
          from,
          to,
        })}
      </>
    );
  }
  if (from) {
    return <>{t("reports.dateRange.openEnded", "{{from}} →", { from })}</>;
  }
  return <>{t("reports.dateRange.toOnly", "→ {{to}}", { to: to ?? "" })}</>;
}
