import { Skeleton, SkeletonRegion } from "../ui/Skeleton";

const NAV_ITEMS = [0, 1, 2, 3, 4, 5, 6, 7];
const KPI_CARDS = [0, 1, 2, 3];

/**
 * Shell-level placeholder used while auth resolves and while a lazy route
 * chunk downloads. Mirrors `DashboardLayout` (fixed 16rem sidebar + main
 * column) so the app frame appears instantly on a hard reload instead of
 * a blank page or bare "Loading…" text.
 */
export function AppShellSkeleton() {
  return (
    <SkeletonRegion className="min-h-dvh bg-[var(--bg-secondary)] flex flex-col lg:flex-row">
      <aside className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:w-64 lg:flex-col border-r border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4">
        <div className="flex items-center gap-3 px-2 py-4">
          <Skeleton className="size-9 rounded-lg" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="mt-4 space-y-1">
          {NAV_ITEMS.map(i => (
            <Skeleton key={i} className="h-10 w-full rounded-xl" />
          ))}
        </div>
        <div className="mt-auto border-t border-[var(--text-secondary)]/20 pt-4">
          <Skeleton className="h-8 w-32" />
        </div>
      </aside>

      <header className="lg:hidden flex items-center justify-between border-b border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="size-9 rounded-lg" />
      </header>

      <main className="relative flex-1 w-full px-4 py-4 lg:px-8 lg:pt-4 lg:ml-64">
        <div className="mx-auto max-w-7xl space-y-6">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {KPI_CARDS.map(i => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
      </main>
    </SkeletonRegion>
  );
}
