import {
  ChartSkeleton,
  MetricCardSkeleton,
  Skeleton,
  SkeletonRegion,
} from "../ui/Skeleton";

const KPI_CARDS = [0, 1, 2, 3];
const INSIGHT_CARDS = [0, 1, 2];

/**
 * Mirrors the metrics data area: KPI grid, the two chart cards and the
 * insights grid. The page header + `FilterBar` render outside this, so
 * only the data section is replaced.
 */
export function MetricsSkeleton() {
  return (
    <SkeletonRegion className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_CARDS.map(i => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {[0, 1].map(i => (
          <div
            key={i}
            className="bg-[var(--bg-secondary)] p-6 rounded-2xl flex flex-col"
          >
            <div className="mb-6 flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
            <ChartSkeleton />
          </div>
        ))}
      </div>

      <div className="bg-[var(--bg-secondary)] p-6 rounded-2xl">
        <Skeleton className="mb-4 h-5 w-32" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {INSIGHT_CARDS.map(i => (
            <div
              key={i}
              className="rounded-xl border border-[var(--text-secondary)]/20 p-4"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-6 w-16" />
              <Skeleton className="mt-2 h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}
