import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Download,
  Pencil,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Button } from "../ui/Button";
import { ConfirmModal } from "../ui/ConfirmModal";
import type { Report } from "../../types/reports";

interface ReportDetailStatus {
  updating: boolean;
  deleting: boolean;
  archiving: boolean;
  exporting: boolean;
}

interface ReportDetailHeaderProps {
  report: Report;
  status: ReportDetailStatus;
  transactionCount: number;
  onEdit: () => void;
  onArchive: () => Promise<void>;
  onUnarchive: () => Promise<void>;
  onDelete: () => Promise<void>;
  onExport: () => void;
}

export function ReportDetailHeader({
  report,
  status,
  transactionCount,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
  onExport,
}: ReportDetailHeaderProps) {
  const { t } = useTranslation();
  const [archivePromptOpen, setArchivePromptOpen] = useState(false);
  const [deletePromptOpen, setDeletePromptOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "archive" | "unarchive" | null
  >(null);

  const archived = report.status === "archived";
  const busy =
    status.updating || status.deleting || status.archiving || status.exporting;

  const handleArchiveToggle = async () => {
    setPendingAction(archived ? "unarchive" : "archive");
    setArchivePromptOpen(false);
    try {
      if (archived) {
        await onUnarchive();
      } else {
        await onArchive();
      }
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4 md:p-6 shadow-sm">
      <Link
        to="/reports"
        className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-2"
      >
        <ArrowLeft size={12} />
        {t("reports.back", "Back to reports")}
      </Link>

      <div className="flex flex-row items-start justify-between gap-3 md:gap-4 md:items-center">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl md:text-2xl font-semibold text-[var(--text-primary)] truncate">
              {report.title}
            </h1>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs shrink-0",
                archived
                  ? "bg-zinc-100 text-zinc-700"
                  : "bg-emerald-100 text-emerald-700"
              )}
            >
              {archived
                ? t("reports.archived", "Archived")
                : t("reports.active", "Active")}
            </span>
          </div>
          {report.description && (
            <p className="text-xs md:text-sm text-[var(--text-secondary)] line-clamp-2 whitespace-pre-line">
              {report.description}
            </p>
          )}
          <p className="text-xs text-[var(--text-secondary)]">
            <RangeLabel from={report.dateRangeStart} to={report.dateRangeEnd} />
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={<Download size={14} />}
            onClick={onExport}
            disabled={busy || status.exporting || transactionCount === 0}
            loading={status.exporting}
            aria-label={t("reports.export.button")}
            title={
              transactionCount === 0
                ? t("reports.export.disabledHint", "Add transactions first")
                : undefined
            }
          >
            {t("reports.export.button", "Download PDF")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<Pencil size={14} />}
            onClick={onEdit}
            disabled={busy}
            aria-label={t("reports.edit", "Edit report")}
          >
            {t("reports.edit", "Edit")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={
              archived ? <ArchiveRestore size={14} /> : <Archive size={14} />
            }
            onClick={() => setArchivePromptOpen(true)}
            disabled={busy}
            loading={pendingAction !== null}
            aria-label={
              archived
                ? t("reports.unarchive", "Restore")
                : t("reports.archive", "Archive")
            }
          >
            {archived
              ? t("reports.unarchive", "Restore")
              : t("reports.archive", "Archive")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={() => setDeletePromptOpen(true)}
            disabled={busy}
            loading={status.deleting}
            className="text-rose-600 hover:bg-rose-50"
            aria-label={t("reports.delete", "Delete report")}
          >
            {t("reports.delete", "Delete")}
          </Button>
        </div>
      </div>

      <ConfirmModal
        isOpen={archivePromptOpen}
        onClose={() => setArchivePromptOpen(false)}
        onConfirm={handleArchiveToggle}
        title={
          archived
            ? t("reports.header.confirmUnarchive", {
                title: report.title,
                defaultValue: `Restore report "{{title}}"?`,
              })
            : t("reports.header.confirmArchive", {
                title: report.title,
                defaultValue: `Archive report "{{title}}"?`,
              })
        }
        confirmText={archived ? t("reports.unarchive") : t("reports.archive")}
        isDestructive={!archived}
        closeDisabled={busy}
      />

      <ConfirmModal
        isOpen={deletePromptOpen}
        onClose={() => setDeletePromptOpen(false)}
        onConfirm={async () => {
          setDeletePromptOpen(false);
          await onDelete();
        }}
        title={t("reports.header.confirmDelete", {
          title: report.title,
          defaultValue: `Delete report "{{title}}"?`,
        })}
        confirmText={t("common.delete")}
        isDestructive
        closeDisabled={status.deleting}
      />
    </section>
  );
}

function RangeLabel({ from, to }: { from: string | null; to: string | null }) {
  const { t } = useTranslation();
  if (!from && !to) return <>{t("reports.dateRange.none")}</>;
  if (from && to)
    return (
      <>{t("reports.dateRange.fromTo", "{{from}} → {{to}}", { from, to })}</>
    );
  if (from)
    return <>{t("reports.dateRange.openEnded", "{{from}} →", { from })}</>;
  return <>{t("reports.dateRange.toOnly", "→ {{to}}", { to: to ?? "" })}</>;
}
