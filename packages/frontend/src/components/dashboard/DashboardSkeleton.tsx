import {
  CardSkeleton,
  ChartSkeleton,
  ListRowSkeleton,
  MetricCardSkeleton,
  Skeleton,
  SkeletonRegion,
} from "../ui/Skeleton";

const KPI_CARDS = [0, 1, 2, 3];
const RECENT_ROWS = [0, 1, 2, 3, 4];

/** Mirrors the dashboard data section: KPI row, category chart, recent list. */
export function DashboardSkeleton() {
  return (
    <SkeletonRegion className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_CARDS.map(i => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>

      <CardSkeleton>
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-24" />
        </div>
        <ChartSkeleton />
      </CardSkeleton>

      <CardSkeleton>
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="space-y-3">
          {RECENT_ROWS.map(i => (
            <ListRowSkeleton key={i} />
          ))}
        </div>
      </CardSkeleton>
    </SkeletonRegion>
  );
}
