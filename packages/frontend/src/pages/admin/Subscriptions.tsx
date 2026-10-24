import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { AdminShell } from "../../components/admin/AdminShell";
import { AdminDataTable } from "../../components/admin/AdminDataTable";
import { AdminPagination } from "../../components/admin/AdminPagination";
import { PageHeader } from "../../components/admin/PageHeader";
import { StatusBadge } from "../../components/admin/StatusBadge";
import {
  useAdminSubscriptions,
  useAdminSubscriptionsCount,
} from "../../hooks/useAdminSubscriptions";
import { useAdminCancelSubscription } from "../../hooks/useAdminCancelSubscription";
import { adminTableFeatures } from "../../lib/admin-table-features";
import { AdminSelect } from "../../components/admin/AdminSelect";
import { Button } from "../../components/ui/Button";
import type { AdminSubscriptionRow } from "../../services/admin.service";
import { formatDateSafe } from "../../utils/format";

const STATUS_OPTIONS = [
  { value: "all", label: "all" },
  { value: "authorized", label: "authorized" },
  { value: "pending", label: "pending" },
  { value: "paused", label: "paused" },
  { value: "pending_cancellation", label: "pending_cancellation" },
  { value: "cancelled", label: "cancelled" },
] as const;

export function Subscriptions() {
  const { t, i18n } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const subsQuery = useAdminSubscriptions({
    status: statusFilter === "all" ? undefined : statusFilter,
    page,
    pageSize,
  });
  const totalQuery = useAdminSubscriptionsCount(
    statusFilter === "all" ? undefined : statusFilter
  );

  const cancel = useAdminCancelSubscription();

  const columns: ColumnDef<
    typeof adminTableFeatures,
    AdminSubscriptionRow,
    unknown
  >[] = [
    {
      id: "user",
      accessorFn: row => row.user_email ?? row.user_id ?? "",
      header: () => t("admin.subscriptions.columns.user"),
      cell: ({ row }) => row.original.user_email ?? row.original.user_id ?? "—",
    },
    {
      id: "plan",
      accessorKey: "plan_key",
      header: () => t("admin.subscriptions.columns.plan"),
      cell: ({ row }) => row.original.plan_key ?? "—",
    },
    {
      id: "provider",
      accessorKey: "provider",
      header: () => t("admin.subscriptions.columns.provider"),
      cell: ({ row }) => row.original.provider,
    },
    {
      id: "amount",
      accessorKey: "transaction_amount",
      header: () => t("admin.subscriptions.columns.amount"),
      cell: ({ row }) =>
        row.original.transaction_amount != null && row.original.currency_id
          ? `${row.original.currency_id} ${row.original.transaction_amount.toLocaleString()}`
          : "—",
      meta: { align: "right" },
    },
    {
      id: "status",
      accessorKey: "status",
      header: () => t("admin.subscriptions.columns.status"),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "updated",
      accessorKey: "updated_at",
      header: () => t("admin.subscriptions.columns.updated"),
      cell: ({ row }) =>
        row.original.updated_at
          ? formatDateSafe(row.original.updated_at, i18n.language)
          : "—",
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        if (!row.original.user_id) return null;
        const isTerminal =
          row.original.status === "cancelled" ||
          row.original.status === "completed";
        if (isTerminal) return null;
        return (
          <Button
            variant="danger"
            size="sm"
            loading={cancel.isPending}
            onClick={() => {
              cancel.mutate({
                userId: row.original.user_id as string,
                targetStatus: "cancelled",
              });
            }}
          >
            {t("admin.subscriptions.cancel")}
          </Button>
        );
      },
    },
  ];

  return (
    <AdminShell>
      <PageHeader
        title={t("admin.subscriptions.title")}
        description={t("admin.subscriptions.description")}
        actions={
          <AdminSelect
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
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
          loading={subsQuery.isLoading}
          error={subsQuery.error as Error | null}
          emptyMessage={t("admin.subscriptions.empty")}
          rows={subsQuery.data ?? []}
          rowKey={row => row.subscription_id}
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
