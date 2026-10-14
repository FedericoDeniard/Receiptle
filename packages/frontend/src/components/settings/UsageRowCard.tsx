import { useTranslation } from "react-i18next";
import { getUsageRowStatus } from "../../utils/usage";
import type { UsageRow } from "../../services/usage.service";

interface UsageRowCardProps {
  row: UsageRow;
}

const STATUS_BAR_CLASS = {
  ok: "bg-[var(--button-primary)]",
  warn: "bg-[var(--warning)]",
  exceeded: "bg-[var(--error)]",
} as const;

export function UsageRowCard({ row }: UsageRowCardProps) {
  const { t, i18n } = useTranslation();
  const label = t(`settings.usage.capabilities.${row.capability}.label`, {
    defaultValue: row.capability.replace(/_/g, " "),
  });
  const status = getUsageRowStatus(row.used, row.limit);
  const pct = Math.min(
    100,
    Math.round((row.used / Math.max(row.limit, 1)) * 100)
  );

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(10rem,1fr)_minmax(8rem,0.85fr)_auto]"
      data-capability={row.capability}
    >
      <span className="truncate text-sm font-medium text-[var(--text-primary)]">
        {label}
      </span>

      {row.unlimited ? (
        <UnlimitedProgress />
      ) : (
        <TrackedProgress row={row} status={status} pct={pct} t={t} />
      )}

      <div className="col-start-2 row-start-1 md:col-auto md:row-auto">
        {row.unlimited ? (
          <UnlimitedMetric />
        ) : (
          <TrackedMetric row={row} locale={i18n.language} />
        )}
      </div>
    </div>
  );
}

function UnlimitedProgress() {
  const { t } = useTranslation();

  return (
    <div
      role="progressbar"
      aria-label={t("settings.usage.unlimitedAria")}
      className="col-span-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--text-secondary)]/15 md:col-span-1"
    >
      <div className="h-full w-full bg-[var(--button-primary)]/25" />
    </div>
  );
}

interface TrackedProgressProps {
  row: UsageRow;
  status: ReturnType<typeof getUsageRowStatus>;
  pct: number;
  t: ReturnType<typeof useTranslation>["t"];
}

function TrackedProgress({ row, status, pct, t }: TrackedProgressProps) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={row.limit}
      aria-valuenow={Math.min(row.used, row.limit)}
      aria-valuetext={t("settings.usage.ariaValueText", {
        used: row.used,
        limit: row.limit,
        percent: pct,
      })}
      className="col-span-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--text-secondary)]/15 md:col-span-1"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${STATUS_BAR_CLASS[status]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function UnlimitedMetric() {
  const { t } = useTranslation();

  return (
    <span
      className="block text-right text-lg font-medium tabular-nums text-[var(--text-primary)]"
      aria-label={t("settings.usage.unlimitedAria")}
    >
      ∞
    </span>
  );
}

interface TrackedMetricProps {
  row: UsageRow;
  locale: string;
}

function TrackedMetric({ row, locale }: TrackedMetricProps) {
  const { t } = useTranslation();
  const resetDate = formatResetDateLocalized(row.resetsAt, locale);

  return (
    <div className="flex items-center justify-end gap-3">
      <div className="text-right">
        <span
          className="block whitespace-nowrap text-sm font-medium tabular-nums text-[var(--text-primary)]"
          aria-label={t("settings.usage.ariaLabelProgress", {
            used: row.used,
            limit: row.limit,
          })}
        >
          {row.used} / {row.limit}
        </span>
        <span className="mt-0.5 block whitespace-nowrap text-xs text-[var(--text-secondary)]">
          {t("settings.usage.resetsOn", { date: resetDate })}
        </span>
      </div>
    </div>
  );
}

function formatResetDateLocalized(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale || "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
