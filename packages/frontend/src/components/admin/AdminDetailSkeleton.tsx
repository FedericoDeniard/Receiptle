import { Skeleton, SkeletonRegion } from "../ui/Skeleton";

const DETAIL_CARDS = [0, 1, 2, 3];
const PLAN_CARDS = [0, 1, 2];
const TABLE_ROWS = [0, 1, 2, 3];
const TABLE_COLUMNS = [0, 1, 2, 3, 4];

/**
 * Full-page placeholder for `/admin/users/:userId`: back link, header,
 * detail cards, role section, plan cards and the usage table.
 */
export function AdminDetailSkeleton() {
  return (
    <SkeletonRegion className="flex flex-col gap-6">
      <Skeleton className="h-4 w-32" />

      <div className="space-y-2">
        <Skeleton className="h-6 w-64 max-w-[60%]" />
        <Skeleton className="h-3 w-72 max-w-[70%]" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DETAIL_CARDS.map(i => (
          <div
            key={i}
            className="space-y-2 rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-32 max-w-full" />
          </div>
        ))}
      </div>

      <Skeleton className="h-10 w-64 max-w-full rounded-lg" />

      <div className="rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4">
        <Skeleton className="h-4 w-32" />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-9 w-40 rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {PLAN_CARDS.map(i => (
          <div
            key={i}
            className="space-y-2 rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-28 max-w-full" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <div className="overflow-hidden rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)]">
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
            <tbody className="divide-y divide-[var(--text-secondary)]/10">
              {TABLE_ROWS.map(row => (
                <tr key={row}>
                  {TABLE_COLUMNS.map(column => (
                    <td key={column} className="px-4 py-3">
                      <Skeleton className="h-4 w-20" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SkeletonRegion>
  );
}
