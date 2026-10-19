import { Skeleton, SkeletonRegion } from "../ui/Skeleton";

const PLANS = [0, 1, 2];
const FEATURES = [0, 1, 2, 3];

/** Mirrors `PricingGrid`: three plan cards with a CTA each. */
export function AccountBillingSkeleton() {
  return (
    <SkeletonRegion className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {PLANS.map(i => (
        <div
          key={i}
          className="flex flex-col rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-6 shadow-sm"
        >
          <div className="flex items-baseline justify-between gap-2">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-8 w-32" />
          <Skeleton className="mt-2 h-3 w-40" />
          <div className="mt-6 space-y-3">
            {FEATURES.map(feature => (
              <div key={feature} className="flex items-center gap-2">
                <Skeleton className="size-4 shrink-0 rounded-full" />
                <Skeleton className="h-3 w-full max-w-[75%]" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-6 h-10 w-full rounded-lg" />
        </div>
      ))}
    </SkeletonRegion>
  );
}
