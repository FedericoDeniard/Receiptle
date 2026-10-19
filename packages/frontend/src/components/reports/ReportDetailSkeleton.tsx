import { CardSkeleton, Skeleton, SkeletonRegion } from "../ui/Skeleton";

const SUMMARY_CARDS = [0, 1];
const TABLE_ROWS = [0, 1, 2, 3, 4, 5];
const TABLE_COLUMNS = [0, 1, 2, 3, 4];

/** Full-page placeholder for `/reports/:reportId` while the report loads. */
export function ReportDetailSkeleton() {
  return (
    <SkeletonRegion className="space-y-6">
      <CardSkeleton>
        <Skeleton className="h-3 w-24" />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Skeleton className="h-7 w-56 max-w-[60%]" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="mt-3 h-3 w-2/3" />
        <Skeleton className="mt-2 h-3 w-40" />
        <div className="mt-5 flex flex-wrap gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-20 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg" />
          <Skeleton className="h-9 w-20 rounded-lg" />
        </div>
      </CardSkeleton>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SUMMARY_CARDS.map(i => (
          <div
            key={i}
            className="space-y-3 rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-5 shadow-sm"
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>

      <ReportTableSkeleton />
    </SkeletonRegion>
  );
}

/** Mirrors `ReportTransactionsTable` (5 columns + footer count). */
export function ReportTableSkeleton() {
  return (
    <SkeletonRegion className="overflow-hidden rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-secondary)]">
            <tr>
              {TABLE_COLUMNS.map(i => (
                <th key={i} className="px-4 py-3 text-left">
                  <Skeleton className="h-3 w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TABLE_ROWS.map(row => (
              <tr key={row}>
                {TABLE_COLUMNS.map(column => (
                  <td key={column} className="px-4 py-3">
                    <Skeleton
                      className={`h-4 ${column === 1 ? "w-40" : "w-20"}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[var(--text-secondary)]/10 px-4 py-2">
        <Skeleton className="h-3 w-28" />
      </div>
    </SkeletonRegion>
  );
}
