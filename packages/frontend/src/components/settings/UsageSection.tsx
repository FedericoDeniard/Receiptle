/**
 * Container for the usage panel. Lives between AccountSection and
 * ProfileSection in the Settings page. Renders one UsageRowCard per
 * capability, in display order, with skeleton/error/empty states.
 *
 * Empty state for `role === "admin"` is handled by the service
 * (returns []) — the same render path covers both "no limits
 * configured" and "admin" so the UX is consistent.
 */
import { useTranslation } from "react-i18next";
import { Inbox } from "lucide-react";
import { SettingsCategoryCard } from "./SettingsCategoryCard";
import { SettingsSkeleton } from "./SettingsSkeleton";
import { UsageRowCard } from "./UsageRowCard";
import { useUserUsage } from "../../hooks/useUserUsage";
import { assertCapabilityEnumSync } from "../../lib/capabilities";
import { sortByDisplayOrder } from "../../lib/usage-display";

export function UsageSection() {
  // One-time runtime sync check. Idempotent; subsequent calls no-op.
  assertCapabilityEnumSync();

  const { rows, isLoading, isError, refetch } = useUserUsage();
  const orderedRows = sortByDisplayOrder(rows);

  return (
    <SettingsCategoryCard
      id="usage"
      titleKey="settingsLayout.nav.usage"
      descriptionKey="settingsLayout.categoryDescription.usage"
    >
      {isLoading ? (
        <SettingsSkeleton variant="usage" />
      ) : isError ? (
        <UsageErrorState onRetry={refetch} />
      ) : orderedRows.length === 0 ? (
        <UsageEmptyState />
      ) : (
        <div className="divide-y divide-[var(--text-secondary)]/10 overflow-hidden rounded-xl bg-[var(--bg-secondary)]">
          {orderedRows.map(row => (
            <UsageRowCard key={row.capability} row={row} />
          ))}
        </div>
      )}
    </SettingsCategoryCard>
  );
}

function UsageErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-[var(--error)]/30 bg-[var(--error)]/5 p-6 text-center"
    >
      <Inbox size={24} className="text-[var(--error)]" aria-hidden />
      <p className="text-sm text-[var(--text-secondary)]">
        {t("settings.usage.loadingError")}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md bg-[var(--button-primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--button-primary-hover)]"
      >
        {t("settings.usage.retry")}
      </button>
    </div>
  );
}

function UsageEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-[var(--bg-secondary)] p-6 text-center">
      <Inbox size={24} className="text-[var(--text-secondary)]" aria-hidden />
      <p className="text-sm text-[var(--text-secondary)]">
        {t("settings.usage.empty")}
      </p>
    </div>
  );
}
