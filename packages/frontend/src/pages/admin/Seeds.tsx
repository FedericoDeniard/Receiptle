import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { AdminShell } from "../../components/admin/AdminShell";
import { AdminDataTable } from "../../components/admin/AdminDataTable";
import { AdminPagination } from "../../components/admin/AdminPagination";
import { AdminSelect } from "../../components/admin/AdminSelect";
import { PageHeader } from "../../components/admin/PageHeader";
import { StatusBadge } from "../../components/admin/StatusBadge";
import { useAdminSeeds, useAdminSeedsCount } from "../../hooks/useAdminSeeds";
import { adminTableFeatures } from "../../lib/admin-table-features";
import type { AdminSeedRow } from "../../services/admin.service";
import { formatDateSafe } from "../../utils/format";

const STATUS_OPTIONS = [
  { value: "all", label: "all" },
  { value: "pending", label: "pending" },
  { value: "processing", label: "processing" },
  { value: "completed", label: "completed" },
  { value: "failed", label: "failed" },
] as const;

export function Seeds() {
  const { t, i18n } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const seedsQuery = useAdminSeeds({
    status: statusFilter === "all" ? undefined : statusFilter,
    page,
    pageSize,
  });
  const totalQuery = useAdminSeedsCount(
    statusFilter === "all" ? undefined : statusFilter
  );

  const columns: ColumnDef<typeof adminTableFeatures, AdminSeedRow, unknown>[] =
    [
      {
        id: "user",
        accessorFn: row => row.user_email ?? row.user_id ?? "",
        header: () => t("admin.seeds.columns.user"),
        cell: ({ row }) =>
          row.original.user_email ?? row.original.user_id ?? "—",
      },
      {
        id: "gmail",
        accessorKey: "gmail_email",
        header: () => t("admin.seeds.columns.gmail"),
        cell: ({ row }) => row.original.gmail_email ?? "—",
      },
      {
        id: "status",
        accessorKey: "status",
        header: () => t("admin.seeds.columns.status"),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "progress",
        accessorFn: row =>
          `${row.transactions_found ?? 0}/${row.total_emails ?? 0}`,
        header: () => t("admin.seeds.columns.progress"),
        cell: ({ row }) =>
          `${row.original.transactions_found ?? 0}/${row.original.total_emails ?? 0}`,
      },
      {
        id: "updated",
        accessorKey: "updated_at",
        header: () => t("admin.seeds.columns.updated"),
        cell: ({ row }) =>
          row.original.updated_at
            ? formatDateSafe(row.original.updated_at, i18n.language)
            : "—",
      },
    ];

  return (
    <AdminShell>
      <PageHeader
        title={t("admin.seeds.title")}
        description={t("admin.seeds.description")}
        actions={
          <AdminSelect
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="w-48"
          >
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </AdminSelect>
        }
      />

      <div className="mt-4">
        <AdminDataTable
          loading={seedsQuery.isLoading}
          error={seedsQuery.error as Error | null}
          emptyMessage={t("admin.seeds.empty")}
          rows={seedsQuery.data ?? []}
          rowKey={row => row.id}
          columns={columns}
        />
      </div>

      <AdminPagination
        className="mt-4"
        page={page}
        pageSize={pageSize}
        total={totalQuery.data ?? 0}
        onPageChange={setPage}
      />
    </AdminShell>
  );
}
