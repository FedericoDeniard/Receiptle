import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Base loading placeholder. Uses `--skeleton-base` (derived from
 * `--text-secondary`) so the block stays visible on both `--bg-primary`
 * and `--bg-secondary` surfaces — the old fallbacks painted
 * `--bg-secondary` on `--bg-secondary` and were invisible.
 */
export function Skeleton({ className = "", style }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-[var(--skeleton-base)] ${className}`}
      style={style}
    />
  );
}

interface SkeletonCircleProps {
  className?: string;
}

/** Round placeholder, e.g. avatar or icon badge slots. */
export function SkeletonCircle({ className = "size-10" }: SkeletonCircleProps) {
  return <Skeleton className={`${className} rounded-full`} />;
}

interface SkeletonRegionProps {
  children: ReactNode;
  className?: string;
  /** Screen-reader label. Defaults to `common.loading`. */
  label?: string;
}

/**
 * Wraps a placeholder tree: announces the loading state once and hides
 * the decorative blocks from the accessibility tree.
 */
export function SkeletonRegion({
  children,
  className = "",
  label,
}: SkeletonRegionProps) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label ?? t("common.loading")}</span>
      {children}
    </div>
  );
}

interface CardSkeletonProps {
  children: ReactNode;
  className?: string;
}

/** Page section card shell: mirrors `rounded-2xl border ... shadow-sm`. */
export function CardSkeleton({ children, className = "" }: CardSkeletonProps) {
  return (
    <div
      className={`rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4 md:p-6 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

/** Mirrors `MetricCard`: icon box, label, value, change pill. */
export function MetricCardSkeleton() {
  return (
    <div className="p-6 rounded-xl border border-[#3d5a80]/15">
      <div className="flex items-start justify-between mb-4">
        <Skeleton className="size-9 rounded-lg" />
        <Skeleton className="h-4 w-9" />
      </div>
      <Skeleton className="h-4 w-24 mb-2" />
      <Skeleton className="h-7 w-32" />
      <div className="flex items-center gap-2 mt-3">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

interface ChartSkeletonProps {
  className?: string;
}

/** Chart placeholder. Defaults to the recharts `ResponsiveContainer` heights. */
export function ChartSkeleton({ className = "h-[320px]" }: ChartSkeletonProps) {
  return <Skeleton className={`w-full rounded-xl ${className}`} />;
}

/** Mirrors `TransactionCard`: title, meta lines and right-aligned amount. */
export function ListRowSkeleton() {
  return (
    <div className="relative p-4 rounded-2xl bg-[var(--bg-primary)] shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-4 w-40 max-w-[60%]" />
          <Skeleton className="h-3 w-32 max-w-[45%]" />
          <Skeleton className="h-3 w-24 max-w-[35%]" />
        </div>
        <div className="shrink-0 space-y-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-3 w-10 ml-auto" />
        </div>
      </div>
    </div>
  );
}
