import { useRef, useState, useEffect } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
} from "lucide-react";

interface AdminDataTableProps<TRow> {
  /** TanStack column definitions. Each column needs an accessorKey
   *  (or accessorFn) so sorting can read the raw value. */
  columns: ColumnDef<TRow, unknown>[];
  /** Rows to render. */
  rows: TRow[];
  /** Initial loading state. Shows skeleton when true and no rows. */
  loading: boolean;
  /** Error from the query. */
  error?: Error | null;
  /** Text shown when rows is empty. */
  emptyMessage: string;
  /** Stable key per row. */
  rowKey: (row: TRow) => string;
  /** Optional row click handler. */
  onRowClick?: (row: TRow) => void;
}

/**
 * Admin table built on @tanstack/react-table. Container exposes a
 * horizontal scrollbar (with chevron affordances) only when the inner
 * table is wider than the visible area, so columns like "Affected
 * users" never get clipped silently by an ancestor with
 * `overflow-x-hidden`. Every column sizes to its content via
 * `size: 'auto'`; if the total exceeds the container, the user can
 * scroll horizontally without losing the rightmost cells.
 *
 * Sorting is enabled on every column by default. Click a header to
 * sort asc, click again for desc, click a third time to clear. The
 * header shows an up / down / neutral chevron so the sort direction
 * is always visible. Per-column `enableSorting: false` (used by the
 * action button column on most pages) opts out.
 */
export function AdminDataTable<TRow>({
  columns,
  rows,
  loading,
  error,
  emptyMessage,
  rowKey,
  onRowClick,
}: AdminDataTableProps<TRow>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable<TRow>({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: row => rowKey(row),
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setCanScrollLeft(el.scrollLeft > 0);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [rows]);

  if (loading && rows.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-8 text-center text-sm text-[var(--text-secondary)]">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-8 text-center text-sm text-red-700">
        {error.message}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-8 text-center text-sm text-[var(--text-secondary)]">
        {emptyMessage}
      </div>
    );
  }

  const scrollBy = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <div className="relative">
      {canScrollLeft ? (
        <button
          type="button"
          onClick={() => scrollBy(-240)}
          aria-label="Scroll left"
          className="absolute left-0 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-1.5 text-[var(--text-secondary)] shadow-md sm:flex"
        >
          <ChevronLeft size={16} />
        </button>
      ) : null}
      {canScrollRight ? (
        <button
          type="button"
          onClick={() => scrollBy(240)}
          aria-label="Scroll right"
          className="absolute right-0 top-1/2 z-10 hidden -translate-y-1/2 translate-x-1/2 rounded-full border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-1.5 text-[var(--text-secondary)] shadow-md sm:flex"
        >
          <ChevronRight size={16} />
        </button>
      ) : null}

      <div
        ref={scrollRef}
        className="overflow-x-auto rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)]"
      >
        <table className="w-max min-w-full text-sm">
          <thead className="bg-[var(--bg-secondary)] text-left text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  const label = header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      );
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={cx(
                        "px-4 py-3 font-medium",
                        sortDir && "text-[var(--text-primary)]"
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 text-left uppercase tracking-wide transition-colors hover:text-[var(--text-primary)]"
                        >
                          <span>{label}</span>
                          <SortIcon dir={sortDir} />
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-[var(--text-secondary)]/10">
            {table.getRowModel().rows.map(row => (
              <RowEl
                key={row.id}
                row={row}
                onClick={
                  onRowClick ? () => onRowClick(row.original) : undefined
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortIcon({ dir }: { dir: false | "asc" | "desc" }) {
  if (dir === "asc") return <ChevronUp size={12} aria-hidden="true" />;
  if (dir === "desc") return <ChevronDown size={12} aria-hidden="true" />;
  return <ChevronsUpDown size={12} aria-hidden="true" className="opacity-40" />;
}

function RowEl<TRow>({
  row,
  onClick,
}: {
  row: Row<TRow>;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? "button" : undefined}
      className={
        onClick
          ? "cursor-pointer transition-colors hover:bg-[var(--bg-secondary)]"
          : undefined
      }
    >
      {row.getVisibleCells().map(cell => (
        <td key={cell.id} className="px-4 py-3">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
