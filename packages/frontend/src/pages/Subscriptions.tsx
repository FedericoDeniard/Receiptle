import { Suspense, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../components/ui/EmptyState";
import { SubscriptionCard } from "../components/subscriptions/SubscriptionCard";
import { SubscriptionListItem } from "../components/subscriptions/SubscriptionListItem";
import { SubscriptionsHeader } from "../components/subscriptions/SubscriptionsHeader";
import type {
  SubscriptionSortBy,
  SubscriptionStatusFilter,
  SubscriptionViewMode,
} from "../components/subscriptions/SubscriptionsHeader";
import {
  getSubscriptionStatus,
  getSubscriptionStatusRank,
} from "../components/subscriptions/subscriptionStatus";
import { useSubscriptionCandidates } from "../hooks/useSubscriptionCandidates";
import { SuspenseFallback } from "../components/ui/SuspenseFallback";

const DEFAULT_STATUS_FILTER: SubscriptionStatusFilter = "all";
const DEFAULT_SORT_BY: SubscriptionSortBy = "status";
const DEFAULT_VIEW_MODE: SubscriptionViewMode = "list";

// ─── List section — suspends while subscription candidates load ───────────────
interface SubscriptionListProps {
  statusFilter: SubscriptionStatusFilter;
  sortBy: SubscriptionSortBy;
  viewMode: SubscriptionViewMode;
  onClearFilters: () => void;
  // Callback so the shell can reflect loading/refetch state in the header
  onFetchingChange?: (isFetching: boolean, refetch: () => void) => void;
}

function SubscriptionList({
  statusFilter,
  sortBy,
  viewMode,
  onClearFilters,
}: SubscriptionListProps) {
  const { t } = useTranslation();
  const { data: candidates = [] } = useSubscriptionCandidates({
    minConfidence: 80,
  });

  const visibleCandidates = useMemo(() => {
    const items = candidates.map((candidate, index) => ({
      candidate,
      index,
      status: getSubscriptionStatus(candidate.next_estimated_date),
    }));

    const filtered = items.filter(item =>
      statusFilter === "all" ? true : item.status === statusFilter
    );

    const parseDate = (value: string | null): number | null => {
      if (!value) return null;
      const parsed = new Date(`${value}T00:00:00`).getTime();
      return Number.isNaN(parsed) ? null : parsed;
    };

    filtered.sort((a, b) => {
      if (sortBy === "amount_desc")
        return b.candidate.avg_amount - a.candidate.avg_amount;
      if (sortBy === "amount_asc")
        return a.candidate.avg_amount - b.candidate.avg_amount;
      if (sortBy === "confidence_desc")
        return b.candidate.confidence_score - a.candidate.confidence_score;
      if (sortBy === "merchant_asc") {
        const aName =
          a.candidate.merchant_display || a.candidate.merchant_normalized;
        const bName =
          b.candidate.merchant_display || b.candidate.merchant_normalized;
        return aName.localeCompare(bName);
      }
      if (sortBy === "next_date_asc") {
        const aDate = parseDate(a.candidate.next_estimated_date);
        const bDate = parseDate(b.candidate.next_estimated_date);
        if (aDate === null && bDate === null) return a.index - b.index;
        if (aDate === null) return 1;
        if (bDate === null) return -1;
        return aDate - bDate;
      }
      const rankDiff =
        getSubscriptionStatusRank(a.status) -
        getSubscriptionStatusRank(b.status);
      if (rankDiff !== 0) return rankDiff;
      const aDate = parseDate(a.candidate.next_estimated_date);
      const bDate = parseDate(b.candidate.next_estimated_date);
      if (aDate !== null && bDate !== null && aDate !== bDate)
        return aDate - bDate;
      return a.index - b.index;
    });

    return filtered.map(item => item.candidate);
  }, [candidates, sortBy, statusFilter]);

  if (candidates.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)]">
        <EmptyState
          icon={AlertCircle}
          title={t("subscriptions.emptyTitle")}
          description={t("subscriptions.emptyDescription")}
        />
      </section>
    );
  }

  if (visibleCandidates.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)]">
        <EmptyState
          icon={AlertCircle}
          title={t("subscriptions.filteredEmptyTitle")}
          description={t("subscriptions.filteredEmptyDescription")}
          action={{
            label: t("subscriptions.filters.clear"),
            onClick: onClearFilters,
          }}
        />
      </section>
    );
  }

  return (
    <section
      className={
        viewMode === "grid"
          ? "grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          : "space-y-3"
      }
    >
      {visibleCandidates.map(candidate =>
        viewMode === "grid" ? (
          <SubscriptionCard
            key={`${candidate.merchant_normalized}-${candidate.currency}`}
            candidate={candidate}
          />
        ) : (
          <SubscriptionListItem
            key={`${candidate.merchant_normalized}-${candidate.currency}`}
            candidate={candidate}
          />
        )
      )}
    </section>
  );
}

// ─── Page shell — renders immediately ────────────────────────────────────────
export function Subscriptions() {
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatusFilter>(
    DEFAULT_STATUS_FILTER
  );
  const [sortBy, setSortBy] = useState<SubscriptionSortBy>(DEFAULT_SORT_BY);
  const [viewMode, setViewMode] =
    useState<SubscriptionViewMode>(DEFAULT_VIEW_MODE);

  const hasActiveFilters =
    statusFilter !== DEFAULT_STATUS_FILTER || sortBy !== DEFAULT_SORT_BY;

  const clearFilters = () => {
    setStatusFilter(DEFAULT_STATUS_FILTER);
    setSortBy(DEFAULT_SORT_BY);
  };

  return (
    // oxlint-disable-next-line react-doctor/no-transition-all
    <div className="flex h-[calc(100dvh-5rem)] flex-col gap-4 animate-in fade-in duration-500">
      {/* Header — renders immediately (title, filters, sort, view mode) */}
      <div data-tour="subscriptions-header">
        <SubscriptionsHeader
          isRefreshing={false}
          onRefresh={() => {}}
          statusFilter={statusFilter}
          sortBy={sortBy}
          onStatusFilterChange={setStatusFilter}
          onSortByChange={setSortBy}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
        />
      </div>
      {/* List — suspends while subscription candidates load */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <Suspense fallback={<SuspenseFallback rows={5} />}>
          <SubscriptionList
            statusFilter={statusFilter}
            sortBy={sortBy}
            viewMode={viewMode}
            onClearFilters={clearFilters}
          />
        </Suspense>
      </div>
    </div>
  );
}
