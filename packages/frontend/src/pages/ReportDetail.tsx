import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ReportDetailHeader } from "../components/reports/ReportDetailHeader";
import { ReportSummaryStats } from "../components/reports/ReportSummaryStats";
import { ReportTransactionsTable } from "../components/reports/ReportTransactionsTable";
import { ReportFormModal } from "../components/reports/ReportFormModal";
import {
  ReportDetailSkeleton,
  ReportTableSkeleton,
} from "../components/reports/ReportDetailSkeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { FileQuestion } from "lucide-react";
import { useReport, useReportTransactions } from "../hooks/useReports";
import { useReportMutations } from "../hooks/useReportMutations";
import { useExportReportPdf } from "../hooks/useExportReportPdf";

const PAGE_SIZE = 25;

export function ReportDetail() {
  const { t, i18n } = useTranslation();
  const { reportId } = useParams();
  const navigate = useNavigate();

  const id = reportId ?? "";
  const { data: report, isLoading: reportLoading } = useReport(id);
  const { data: transactionsPage, isLoading: txLoading } =
    useReportTransactions(id, { from: 0, to: PAGE_SIZE - 1 });

  const {
    updateReport,
    archiveReport,
    unarchiveReport,
    deleteReport,
    isUpdating,
    isArchiving,
    isDeleting,
  } = useReportMutations();
  const { exportPdf, isExporting } = useExportReportPdf();

  const [editOpen, setEditOpen] = useState(false);

  if (reportLoading) {
    return <ReportDetailSkeleton />;
  }

  if (!report) {
    return (
      <EmptyState
        icon={FileQuestion}
        title={t("reports.notFoundTitle")}
        description={t("reports.notFoundDescription")}
        action={{
          label: t("reports.header.back"),
          onClick: () => navigate("/reports"),
        }}
      />
    );
  }

  const handleArchive = async () => {
    try {
      await archiveReport(report.id);
      toast.success(t("reports.header.archiveSuccess"));
    } catch (error) {
      toast.error(t("reports.header.archiveError"));
      throw error;
    }
  };

  const handleUnarchive = async () => {
    try {
      await unarchiveReport(report.id);
      toast.success(t("reports.header.unarchiveSuccess"));
    } catch (error) {
      toast.error(t("reports.header.archiveError"));
      throw error;
    }
  };

  const handleDelete = async () => {
    try {
      await deleteReport(report.id);
      toast.success(t("reports.header.deleteSuccess"));
      navigate("/reports");
    } catch (error) {
      toast.error(t("reports.header.deleteError"));
      throw error;
    }
  };

  const handleSave = async (values: {
    title: string;
    description: string | null;
    dateRangeStart: string | null;
    dateRangeEnd: string | null;
  }) => {
    try {
      await updateReport(report.id, {
        title: values.title,
        description: values.description,
        dateRangeStart: values.dateRangeStart,
        dateRangeEnd: values.dateRangeEnd,
      });
      toast.success(t("reports.header.saveSuccess"));
      setEditOpen(false);
    } catch (error) {
      toast.error(t("reports.header.saveError"));
      throw error;
    }
  };

  const transactions = transactionsPage?.items ?? [];
  const total = transactionsPage?.total ?? 0;

  return (
    <div className="space-y-6">
      <ReportDetailHeader
        report={report}
        transactionCount={total}
        status={{
          updating: isUpdating,
          deleting: isDeleting,
          archiving: isArchiving,
          exporting: isExporting,
        }}
        onEdit={() => setEditOpen(true)}
        onArchive={handleArchive}
        onUnarchive={handleUnarchive}
        onDelete={handleDelete}
        onExport={() =>
          void exportPdf({
            reportId: report.id,
            title: report.title,
            locale: i18n.language.startsWith("es") ? "es" : "en",
            transactionCount: total,
          })
        }
      />

      <ReportSummaryStats perCurrency={report.perCurrency} />

      {txLoading ? (
        <ReportTableSkeleton />
      ) : (
        <ReportTransactionsTable items={transactions} total={total} />
      )}

      <ReportFormModal
        isOpen={editOpen}
        mode="edit"
        report={report}
        onClose={() => setEditOpen(false)}
        onSubmit={handleSave}
        isSubmitting={isUpdating}
      />
    </div>
  );
}
