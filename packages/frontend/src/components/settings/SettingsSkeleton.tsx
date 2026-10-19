import { Skeleton, SkeletonRegion } from "../ui/Skeleton";

type SettingsSkeletonVariant = "gmail" | "usage";

interface SettingsSkeletonProps {
  variant: SettingsSkeletonVariant;
}

const PANEL_ROWS = [0, 1];
const USAGE_ROWS = [0, 1, 2];

/** Section-level placeholders used inside the Settings page cards. */
export function SettingsSkeleton({ variant }: SettingsSkeletonProps) {
  if (variant === "usage") {
    return (
      <SkeletonRegion className="divide-y divide-[var(--text-secondary)]/10 overflow-hidden rounded-xl bg-[var(--bg-secondary)]">
        {USAGE_ROWS.map(i => (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(10rem,1fr)_minmax(8rem,0.85fr)_auto]"
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="col-span-2 h-1.5 w-full rounded-full md:col-span-1" />
            <div className="col-start-2 row-start-1 space-y-2 md:col-auto md:row-auto">
              <Skeleton className="ml-auto h-4 w-16" />
              <Skeleton className="ml-auto h-3 w-24" />
            </div>
          </div>
        ))}
      </SkeletonRegion>
    );
  }

  return (
    <SkeletonRegion className="rounded-xl bg-[var(--bg-secondary)] p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40 max-w-[60%]" />
          <Skeleton className="h-3 w-56 max-w-[80%]" />
        </div>
      </div>
      <div className="space-y-3">
        {PANEL_ROWS.map(i => (
          <div
            key={i}
            className="flex flex-col items-start justify-between gap-3 rounded-lg border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-3 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Skeleton className="size-5 shrink-0 rounded-sm" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-48 max-w-[60%]" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2 border-t border-[var(--text-secondary)]/20 pt-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-64 max-w-full" />
      </div>
    </SkeletonRegion>
  );
}
