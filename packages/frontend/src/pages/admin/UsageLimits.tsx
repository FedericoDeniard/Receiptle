import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { AdminShell } from "../../components/admin/AdminShell";
import { AdminDataTable } from "../../components/admin/AdminDataTable";
import { PageHeader } from "../../components/admin/PageHeader";
import { ScopeBadge } from "../../components/admin/ScopeBadge";
import { useAdminUsageLimits } from "../../hooks/useAdminUsageLimits";
import { useAdminUserUsageSummary } from "../../hooks/useAdminUserUsageSummary";
import { useAdminTopConsumers } from "../../hooks/useAdminTopConsumers";
import { adminTableFeatures } from "../../lib/admin-table-features";
import { AdminInput } from "../../components/admin/AdminInput";
import { AdminSelect } from "../../components/admin/AdminSelect";
import type {
  AdminTopConsumerRow,
  AdminUsageLimitRow,
  AdminUserUsageSummaryRow,
  Capability,
} from "../../services/admin.service";

const CAPABILITIES: Capability[] = [
  "gmail_sync",
  "ai_assistant",
  "push_notifications",
  "process_documents",
  "report_pdf_export",
];

function startOfCurrentMonth(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();
}

export function UsageLimits() {
  const { t } = useTranslation();
  const [userLookupId, setUserLookupId] = useState("");
  const [activeLookupId, setActiveLookupId] = useState<string | null>(null);
  const [topCapability, setTopCapability] =
    useState<Capability>("ai_assistant");

  const limitsQuery = useAdminUsageLimits();
  const userSummaryQuery = useAdminUserUsageSummary(
    activeLookupId ?? undefined
  );
  const topConsumersQuery = useAdminTopConsumers({
    capability: topCapability,
    periodStart: startOfCurrentMonth(),
    limit: 10,
  });

  const limits = limitsQuery.data ?? [];
  const userSummary = userSummaryQuery.data ?? [];
  const topConsumers = topConsumersQuery.data ?? [];

  const limitsColumns: ColumnDef<
    typeof adminTableFeatures,
    AdminUsageLimitRow,
    unknown
  >[] = [
    {
      id: "capability",
      accessorKey: "capability",
      header: () => t("admin.usageLimits.columns.capability"),
      cell: ({ row }) => row.original.capability,
    },
    {
      id: "scope",
      accessorFn: row => `${row.scope_kind}:${row.scope_value ?? "default"}`,
      header: () => t("admin.usageLimits.columns.scope"),
      cell: ({ row }) => (
        <ScopeBadge
          scope={row.original.scope_kind}
          value={row.original.scope_value}
        />
      ),
    },
    {
      id: "period",
      accessorKey: "period",
      header: () => t("admin.usageLimits.columns.period"),
      cell: ({ row }) => row.original.period,
    },
    {
      id: "max",
      accessorKey: "max_count",
      header: () => t("admin.usageLimits.columns.maxCount"),
      cell: ({ row }) => row.original.max_count.toLocaleString(),
    },
    {
      id: "affected",
      accessorKey: "affected_users",
      header: () => t("admin.usageLimits.columns.affectedUsers"),
      cell: ({ row }) => row.original.affected_users.toLocaleString(),
    },
  ];

  const topConsumersColumns: ColumnDef<
    typeof adminTableFeatures,
    AdminTopConsumerRow,
    unknown
  >[] = [
    {
      id: "user",
      accessorFn: row => row.user_email ?? row.user_id,
      header: () => t("admin.usageLimits.columns.user"),
      cell: ({ row }) => row.original.user_email ?? row.original.user_id,
    },
    {
      id: "count",
      accessorKey: "count",
      header: () => t("admin.usageLimits.columns.currentCount"),
      cell: ({ row }) => row.original.count.toLocaleString(),
    },
  ];

  const userSummaryColumns: ColumnDef<
    typeof adminTableFeatures,
    AdminUserUsageSummaryRow,
    unknown
  >[] = [
    {
      id: "capability",
      accessorKey: "capability",
      header: () => t("admin.usageLimits.columns.capability"),
      cell: ({ row }) => row.original.capability,
    },
    {
      id: "scope",
      accessorFn: row => `${row.scope_kind}:${row.scope_value ?? "default"}`,
      header: () => t("admin.usageLimits.columns.scope"),
      cell: ({ row }) => (
        <ScopeBadge
          scope={row.original.scope_kind as never}
          value={row.original.scope_value}
        />
      ),
    },
    {
      id: "period",
      accessorKey: "period",
      header: () => t("admin.usageLimits.columns.period"),
      cell: ({ row }) => row.original.period,
    },
    {
      id: "limit",
      accessorKey: "resolved_limit",
      header: () => t("admin.usageLimits.columns.maxCount"),
      cell: ({ row }) => row.original.resolved_limit.toLocaleString(),
    },
    {
      id: "used",
      accessorKey: "current_count",
      header: () => t("admin.usageLimits.columns.currentCount"),
      cell: ({ row }) => row.original.current_count.toLocaleString(),
    },
    {
      id: "remaining",
      accessorFn: row => Math.max(0, row.resolved_limit - row.current_count),
      header: () => t("admin.usageLimits.columns.remaining"),
      cell: ({ row }) => {
        const remaining = Math.max(
          0,
          row.original.resolved_limit - row.original.current_count
        );
        const pct =
          row.original.resolved_limit > 0
            ? Math.round(
                (row.original.current_count / row.original.resolved_limit) * 100
              )
            : 0;
        return (
          <span className="tabular-nums">
            {remaining.toLocaleString()}{" "}
            <span className="opacity-60">/ {pct}%</span>
          </span>
        );
      },
    },
  ];

  return (
    <AdminShell>
      <PageHeader
        title={t("admin.usageLimits.title")}
        description={t("admin.usageLimits.description")}
      />

      <section className="mt-6">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
          {t("admin.usageLimits.configuredTitle")}
        </h3>
        <p className="mb-3 text-xs text-[var(--text-secondary)]">
          {t("admin.usageLimits.configuredHint")}
        </p>
        <AdminDataTable
          loading={limitsQuery.isLoading}
          error={limitsQuery.error as Error | null}
          emptyMessage={t("admin.usageLimits.empty")}
          rows={limits}
          rowKey={row =>
            `${row.capability}-${row.scope_kind}-${row.scope_value ?? "default"}-${row.period}`
          }
          columns={limitsColumns}
        />
      </section>

      <section className="mt-8">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {t("admin.usageLimits.topConsumersTitle")}
          </h3>
          <AdminSelect
            value={topCapability}
            onChange={e => setTopCapability(e.target.value as Capability)}
            className="w-56"
          >
            {CAPABILITIES.map(cap => (
              <option key={cap} value={cap}>
                {cap}
              </option>
            ))}
          </AdminSelect>
        </div>
        <AdminDataTable
          loading={topConsumersQuery.isLoading}
          error={topConsumersQuery.error as Error | null}
          emptyMessage={t("admin.usageLimits.topConsumersEmpty")}
          rows={topConsumers}
          rowKey={row => row.user_id}
          columns={topConsumersColumns}
        />
      </section>

      <section className="mt-8">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
          {t("admin.usageLimits.userLookupTitle")}
        </h3>
        <p className="mb-3 text-xs text-[var(--text-secondary)]">
          {t("admin.usageLimits.userLookupHint")}
        </p>
        <form
          onSubmit={e => {
            e.preventDefault();
            if (userLookupId.trim().length > 0) {
              setActiveLookupId(userLookupId.trim());
            }
          }}
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <AdminInput
            placeholder={t("admin.usageLimits.userLookupPlaceholder")}
            value={userLookupId}
            onChange={e => setUserLookupId(e.target.value)}
            className="sm:w-96"
          />
        </form>
        <div className="mt-4">
          <AdminDataTable
            loading={userSummaryQuery.isLoading}
            error={userSummaryQuery.error as Error | null}
            emptyMessage={
              activeLookupId
                ? t("admin.usageLimits.userLookupEmpty")
                : t("admin.usageLimits.userLookupInactive")
            }
            rows={userSummary}
            rowKey={row => `${row.capability}-${row.period}`}
            columns={userSummaryColumns}
          />
        </div>
      </section>
    </AdminShell>
  );
}
