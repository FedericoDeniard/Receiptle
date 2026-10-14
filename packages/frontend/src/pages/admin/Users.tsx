import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { AdminShell } from "../../components/admin/AdminShell";
import { AdminDataTable } from "../../components/admin/AdminDataTable";
import { AdminPagination } from "../../components/admin/AdminPagination";
import { PageHeader } from "../../components/admin/PageHeader";
import { RoleBadge } from "../../components/admin/RoleBadge";
import { UserIdCopy } from "../../components/admin/UserIdCopy";
import { useAdminUsers, useAdminUsersCount } from "../../hooks/useAdminUsers";
import { adminTableFeatures } from "../../lib/admin-table-features";
import { AdminInput } from "../../components/admin/AdminInput";
import type { AdminUserRow } from "../../services/admin.service";
import { formatDateSafe } from "../../utils/format";

export function Users() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const usersQuery = useAdminUsers({
    search: debouncedSearch || undefined,
    page,
    pageSize,
  });
  const totalQuery = useAdminUsersCount(debouncedSearch || undefined);

  const columns: ColumnDef<typeof adminTableFeatures, AdminUserRow, unknown>[] =
    [
      {
        id: "email",
        accessorKey: "email",
        header: () => t("admin.users.columns.email"),
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-[var(--text-primary)]">
              {row.original.email ?? "—"}
            </span>
            <UserIdCopy userId={row.original.user_id} compact />
          </div>
        ),
      },
      {
        id: "name",
        accessorKey: "name",
        header: () => t("admin.users.columns.name"),
        cell: ({ row }) => row.original.name ?? "—",
      },
      {
        id: "role",
        accessorKey: "role",
        header: () => t("admin.users.columns.role"),
        cell: ({ row }) => <RoleBadge role={row.original.role} />,
      },
      {
        id: "plan",
        accessorKey: "active_plan_key",
        header: () => t("admin.users.columns.plan"),
        cell: ({ row }) => row.original.active_plan_key ?? "—",
      },
      {
        id: "created",
        accessorKey: "created_at",
        header: () => t("admin.users.columns.createdAt"),
        cell: ({ row }) =>
          row.original.created_at
            ? formatDateSafe(row.original.created_at, i18n.language)
            : "—",
      },
    ];

  return (
    <AdminShell>
      <PageHeader
        title={t("admin.users.title")}
        description={t("admin.users.description")}
        actions={
          <AdminInput
            placeholder={t("admin.users.searchPlaceholder")}
            value={search}
            onChange={e => {
              const value = e.target.value;
              setSearch(value);
              window.clearTimeout(
                Number((window as { __adminSearchT?: number }).__adminSearchT)
              );
              (window as { __adminSearchT?: number }).__adminSearchT =
                window.setTimeout(() => {
                  setDebouncedSearch(value);
                  setPage(0);
                }, 250);
            }}
            className="w-64"
          />
        }
      />

      <div className="mt-4">
        <AdminDataTable
          loading={usersQuery.isLoading}
          error={usersQuery.error as Error | null}
          emptyMessage={t("admin.users.empty")}
          rows={usersQuery.data ?? []}
          rowKey={row => row.user_id}
          onRowClick={row => navigate(`/admin/users/${row.user_id}`)}
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
