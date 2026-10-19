import { Skeleton, SkeletonRegion } from "../ui/Skeleton";

const CARDS = [0, 1, 2, 3, 4, 5];

/** Mirrors `ReportList`: a grid of `ReportCard` tiles. */
export function ReportsSkeleton() {
  return (
    <SkeletonRegion>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map(i => (
          <li
            key={i}
            className="flex flex-col gap-4 rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-5 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <Skeleton className="size-10 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-32 max-w-[70%]" />
                <Skeleton className="h-3 w-24 max-w-[50%]" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-6 w-24 rounded-lg" />
              <Skeleton className="h-6 w-20 rounded-lg" />
            </div>
            <div className="flex items-center justify-between border-t border-[var(--text-secondary)]/10 pt-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-4 rounded-sm" />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonRegion>
  );
}
