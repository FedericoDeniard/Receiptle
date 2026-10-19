import { Skeleton, SkeletonRegion } from "./Skeleton";

interface SuspenseFallbackProps {
  rows?: number;
  className?: string;
}

/**
 * Generic fallback for Suspense boundaries without a layout-matched
 * skeleton. Prefer a page-specific skeleton where one exists.
 */
export function SuspenseFallback({
  rows = 3,
  className = "",
}: SuspenseFallbackProps) {
  return (
    <SkeletonRegion className={className}>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function SuspenseFallbackPage({
  className = "",
}: {
  className?: string;
}) {
  return (
    <SkeletonRegion
      className={`flex items-center justify-center h-64 ${className}`}
    >
      <div className="space-y-3 w-full max-w-sm">
        <Skeleton className="h-6 w-1/2 rounded-md mx-auto" />
        <Skeleton className="h-20 w-3/4 rounded-xl mx-auto" />
      </div>
    </SkeletonRegion>
  );
}
