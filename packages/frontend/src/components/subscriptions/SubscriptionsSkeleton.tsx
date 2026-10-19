import { Skeleton, SkeletonCircle, SkeletonRegion } from "../ui/Skeleton";
import type { SubscriptionViewMode } from "./SubscriptionsHeader";

const CARDS = [0, 1, 2, 3, 4, 5];

interface SubscriptionsSkeletonProps {
  viewMode: SubscriptionViewMode;
}

/** Mirrors the subscription card grid / list rows for the current view mode. */
export function SubscriptionsSkeleton({
  viewMode,
}: SubscriptionsSkeletonProps) {
  if (viewMode === "list") {
    return (
      <SkeletonRegion className="space-y-3">
        {CARDS.map(i => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-3 shadow-sm sm:gap-4 sm:p-4"
          >
            <SkeletonCircle className="size-10 sm:size-12" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40 max-w-[60%]" />
              <Skeleton className="h-3 w-56 max-w-[80%]" />
            </div>
            <div className="shrink-0 space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-14 ml-auto" />
            </div>
          </div>
        ))}
      </SkeletonRegion>
    );
  }

  return (
    <SkeletonRegion className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {CARDS.map(i => (
        <div
          key={i}
          className="rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex flex-col items-end gap-2">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
          </div>
          <div className="mt-4 space-y-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}
