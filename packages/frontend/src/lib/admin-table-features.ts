/**
 * Shared TanStack Table v9 `tableFeatures` registry for admin tables.
 * Single source of truth so every `ColumnDef<typeof adminTableFeatures, ...>`
 * stays in sync with the feature set passed to `useTable`.
 *
 * Sorting is the only feature currently enabled. Columns never reference a
 * custom `sortFn` by name, so the bare `rowSortingFeature` +
 * `createSortedRowModel()` is enough — `sortFn: "auto"` resolves via the
 * built-in comparators shipped with `table-core`.
 */
import {
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";

export const adminTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});

export type AdminTableFeatures = typeof adminTableFeatures;
