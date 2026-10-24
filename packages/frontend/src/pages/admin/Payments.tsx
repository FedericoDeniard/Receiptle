import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { AdminShell } from "../../components/admin/AdminShell";
import { AdminDataTable } from "../../components/admin/AdminDataTable";
import { AdminPagination } from "../../components/admin/AdminPagination";
import { AdminRevenueBlock } from "../../components/admin/AdminRevenueBlock";
import { PageHeader } from "../../components/admin/PageHeader";
import {
  useAdminPaymentEvents,
  useAdminPaymentEventsCount,
} from "../../hooks/useAdminPaymentEvents";
import { useAdminRevenueSummary } from "../../hooks/useAdminRevenueSummary";
import { adminTableFeatures } from "../../lib/admin-table-features";
import type { AdminPaymentEventRow } from "../../services/admin.service";
import { formatCurrency } from "../../utils/currency";
import { formatDateSafe } from "../../utils/format";

export function Payments() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const eventsQuery = useAdminPaymentEvents({ page, pageSize });
  const totalQuery = useAdminPaymentEventsCount();
  const revenueQuery = useAdminRevenueSummary();

  const columns: ColumnDef<
    typeof adminTableFeatures,
    AdminPaymentEventRow,
    unknown
  >[] = [
    {
      id: "received",
      accessorKey: "received_at",
      header: () => t("admin.payments.columns.received"),
      cell: ({ row }) =>
        row.original.received_at
          ? formatDateSafe(row.original.received_at, i18n.language)
          : "—",
    },
    {
      id: "user",
      accessorFn: row => row.user_email ?? row.user_id ?? "",
      header: () => t("admin.payments.columns.user"),
      cell: ({ row }) => row.original.user_email ?? row.original.user_id ?? "—",
    },
    {
      id: "payment",
      accessorKey: "payment_id",
      header: () => t("admin.payments.columns.paymentId"),
      cell: ({ row }) => `#${row.original.payment_id}`,
    },
    {
      id: "amount",
      enableSorting: false,
      header: () => t("admin.payments.columns.amount"),
      cell: ({ row }) =>
        row.original.transaction_amount != null && row.original.currency_id
          ? formatCurrency(
              row.original.transaction_amount,
              row.original.currency_id
            )
          : "—",
    },
    {
      id: "topic",
      accessorKey: "topic",
      header: () => t("admin.payments.columns.topic"),
      cell: ({ row }) => row.original.topic,
    },
    {
      id: "action",
      accessorKey: "action",
      header: () => t("admin.payments.columns.action"),
      cell: ({ row }) => row.original.action ?? "—",
    },
    {
      id: "signature",
      accessorFn: row => (row.signature_valid ? 1 : 0),
      header: () => t("admin.payments.columns.signature"),
      cell: ({ row }) =>
        row.original.signature_valid ? (
          <span className="text-emerald-600">
            {t("admin.payments.signatureOk")}
          </span>
        ) : (
          <span className="text-red-600">
            {t("admin.payments.signatureBad")}
          </span>
        ),
    },
    {
      id: "processing",
      accessorKey: "processing_status",
      header: () => t("admin.payments.columns.processing"),
      cell: ({ row }) => row.original.processing_status,
    },
  ];

  return (
    <AdminShell>
      <PageHeader
        title={t("admin.payments.title")}
        description={t("admin.payments.description")}
      />

      <AdminRevenueBlock
        summary={revenueQuery.data}
        loading={revenueQuery.isLoading}
        error={revenueQuery.error as Error | null}
      />

      <p className="mt-2 text-xs text-[var(--text-secondary)]">
        {t("admin.payments.rawWarning")}
      </p>

      <div className="mt-4">
        <AdminDataTable
          loading={eventsQuery.isLoading}
          error={eventsQuery.error as Error | null}
          emptyMessage={t("admin.payments.empty")}
          rows={eventsQuery.data ?? []}
          rowKey={row => String(row.id)}
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
