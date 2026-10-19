import { ListRowSkeleton, Skeleton, SkeletonRegion } from "../ui/Skeleton";

const ROWS = [0, 1, 2, 3, 4, 5];

/**
 * Mirrors the transaction list column (header with count + refresh, then
 * `TransactionCard` rows). The detail panel keeps its real empty state
 * while this loads, so only the list column is replaced.
 */
export function TransactionsSkeleton() {
  return (
    <SkeletonRegion className="w-full lg:w-1/3 bg-[var(--bg-secondary)] rounded-lg overflow-hidden flex flex-col">
      <div className="p-4 border-b border-[var(--text-secondary)]/20">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="size-8 rounded-lg" />
        </div>
      </div>
      <div className="flex-1 space-y-3 p-4">
        {ROWS.map(i => (
          <ListRowSkeleton key={i} />
        ))}
      </div>
    </SkeletonRegion>
  );
}
