import { Skeleton, SkeletonRegion } from "../ui/Skeleton";

const STAT_CARDS = [0, 1, 2, 3];

/** Mirrors the four `StatCard`s on the admin overview. */
export function AdminStatsSkeleton() {
  return (
    <SkeletonRegion className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {STAT_CARDS.map(i => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-5"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </SkeletonRegion>
  );
}
