import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft } from "lucide-react";
import { AdminShell } from "../../components/admin/AdminShell";
import { PageHeader } from "../../components/admin/PageHeader";
import { RoleBadge } from "../../components/admin/RoleBadge";
import { StatusBadge } from "../../components/admin/StatusBadge";
import { ScopeBadge } from "../../components/admin/ScopeBadge";
import { AdminDataTable } from "../../components/admin/AdminDataTable";
import { AdminDetailSkeleton } from "../../components/admin/AdminDetailSkeleton";
import { UserIdCopy } from "../../components/admin/UserIdCopy";
import { useAdminUserDetail } from "../../hooks/useAdminUserDetail";
import { useAdminSetUserRole } from "../../hooks/useAdminSetUserRole";
import { useAdminUserUsageSummary } from "../../hooks/useAdminUserUsageSummary";
import { adminTableFeatures } from "../../lib/admin-table-features";
import { AdminSelect } from "../../components/admin/AdminSelect";
import { Button } from "../../components/ui/Button";
import type {
  AdminUserUsageSummaryRow,
  AppRole,
} from "../../services/admin.service";
import { formatDateSafe } from "../../utils/format";

const ROLES: AppRole[] = ["user", "tester", "admin"];

const usageColumns: ColumnDef<
  typeof adminTableFeatures,
  AdminUserUsageSummaryRow,
  unknown
>[] = [
  {
    id: "capability",
    accessorKey: "capability",
    header: () => "Capability",
    cell: ({ row }) => row.original.capability,
  },
  {
    id: "period",
    accessorKey: "period",
    header: () => "Period",
    cell: ({ row }) => row.original.period,
  },
  {
    id: "scope",
    accessorFn: row => `${row.scope_kind}:${row.scope_value ?? "default"}`,
    header: () => "Scope",
    cell: ({ row }) => (
      <ScopeBadge
        scope={row.original.scope_kind as never}
        value={row.original.scope_value}
      />
    ),
  },
  {
    id: "limit",
    accessorKey: "resolved_limit",
    header: () => "Max",
    cell: ({ row }) => row.original.resolved_limit.toLocaleString(),
  },
  {
    id: "used",
    accessorKey: "current_count",
    header: () => "Used",
    cell: ({ row }) => row.original.current_count.toLocaleString(),
  },
];

export function UserDetail() {
  const { userId } = useParams<{ userId: string }>();
  const { t, i18n } = useTranslation();

  const detailQuery = useAdminUserDetail(userId);
  const usageQuery = useAdminUserUsageSummary(userId);
  const setRole = useAdminSetUserRole();

  const detail = detailQuery.data;
  const usage = usageQuery.data ?? [];

  if (detailQuery.isLoading) {
    return (
      <AdminShell>
        <AdminDetailSkeleton />
      </AdminShell>
    );
  }

  if (!detail) {
    return (
      <AdminShell>
        <div className="text-sm text-[var(--text-secondary)]">
          {t("admin.userDetail.notFound")}
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <Link
        to="/admin/users"
        className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft size={16} />
        {t("admin.userDetail.backToUsers")}
      </Link>

      <PageHeader
        title={detail.email ?? detail.user_id}
        description={t("admin.userDetail.description")}
      />

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 min-w-0">
        <Card label={t("admin.userDetail.email")} value={detail.email ?? "—"} />
        <Card label={t("admin.userDetail.name")} value={detail.name ?? "—"} />
        <Card
          label={t("admin.userDetail.createdAt")}
          value={
            detail.created_at
              ? formatDateSafe(detail.created_at, i18n.language)
              : "—"
          }
        />
        <Card
          label={t("admin.userDetail.gmailConnected")}
          value={detail.has_gmail ? t("common.yes") : t("common.no")}
        />
      </section>

      <section className="mt-4">
        <UserIdCopy userId={detail.user_id} />
      </section>

      <section className="mt-6 rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {t("admin.userDetail.roleSection")}
        </h3>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <RoleBadge role={detail.role} />
          <AdminSelect
            value={detail.role ?? "user"}
            onChange={e => {
              setRole.mutate({
                userId: detail.user_id,
                role: e.target.value as AppRole,
              });
            }}
            disabled={setRole.isPending}
            className="w-40"
          >
            {ROLES.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </AdminSelect>
          {setRole.isPending ? (
            <span className="text-xs text-[var(--text-secondary)]">
              {t("admin.userDetail.roleSaving")}
            </span>
          ) : null}
          {setRole.isError ? (
            <span className="text-xs text-red-600">
              {setRole.error?.message}
            </span>
          ) : null}
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3 min-w-0">
        <Card
          label={t("admin.userDetail.activePlan")}
          value={detail.active_plan_key ?? "—"}
        />
        <Card
          label={t("admin.userDetail.subStatus")}
          value={<StatusBadge status={detail.sub_status} />}
        />
        <Card
          label={t("admin.userDetail.subUpdated")}
          value={
            detail.sub_updated_at
              ? formatDateSafe(detail.sub_updated_at, i18n.language)
              : "—"
          }
        />
      </section>

      <section className="mt-6">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
          {t("admin.userDetail.usageTitle")}
        </h3>
        <AdminDataTable
          loading={usageQuery.isLoading}
          error={usageQuery.error as Error | null}
          emptyMessage={t("admin.userDetail.usageEmpty")}
          rows={usage}
          rowKey={row => `${row.capability}-${row.period}`}
          columns={usageColumns}
        />
      </section>

      <section className="mt-6 flex justify-end">
        <Button variant="ghost" onClick={() => detailQuery.refetch()} size="sm">
          {t("common.refresh")}
        </Button>
      </section>
    </AdminShell>
  );
}

function Card({ label, value }: { label: string; value: React.ReactNode }) {
  const displayValue =
    typeof value === "string" ? (
      <span title={value} className="block truncate">
        {value}
      </span>
    ) : (
      value
    );
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
        {label}
      </span>
      <span className="block min-w-0 text-base text-[var(--text-primary)]">
        {displayValue}
      </span>
    </div>
  );
}
