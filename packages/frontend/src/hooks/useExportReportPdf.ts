import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getSupabase } from "../lib/supabase";
import { createReportsService } from "../services/reports.service";
import { getEdgeFunctionErrorMessage } from "../utils/edge-function-errors";
import { queryKeys } from "../lib/query-client";
import { toast } from "sonner";

interface ExportReportPdfInput {
  reportId: string;
  title: string;
  locale: "en" | "es";
  transactionCount: number;
}

interface UseExportReportPdfReturn {
  exportPdf: (input: ExportReportPdfInput) => Promise<void>;
  isExporting: boolean;
}

export function useExportReportPdf(): UseExportReportPdfReturn {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: ExportReportPdfInput) => {
      if (input.transactionCount === 0) {
        toast.error(t("reports.export.error", "Could not generate PDF"));
        return;
      }
      const supabase = await getSupabase();
      const service = createReportsService(supabase);
      const blob = await service.exportReportPdf(input.reportId, input.locale);
      triggerDownload(blob, buildFilename(input.title));
    },
    onSuccess: () => {
      // The increment is post-build in export-report-pdf/index.ts:326;
      // a successful export guarantees the counter went up. Refresh
      // the usage panel so the next mount shows the new value.
      queryClient.invalidateQueries({ queryKey: queryKeys.usage.all });
      toast.success(t("reports.export.success"));
    },
    onError: err => {
      // The existing classifier maps 403 (forbidden-capability) to
      // errors.premiumFeature and 429 (usage-limit) to
      // errors.usageLimitExceeded; falls back to the raw server
      // message for network/unknown errors. No invalidation here —
      // a failed build does NOT consume quota on the server side.
      toast.error(getEdgeFunctionErrorMessage(err, t));
    },
  });

  return {
    exportPdf: mutation.mutateAsync,
    isExporting: mutation.isPending,
  };
}

function buildFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const stamp = new Date().toISOString().split("T")[0];
  return `report-${slug || "untitled"}-${stamp}.pdf`;
}

function triggerDownload(blob: Blob, filename: string): void {
  // Same pattern used in TransactionAttachments / ai-elements for blob
  // downloads. `URL.revokeObjectURL` is called on the next microtask so
  // the click is guaranteed to register against a valid URL.
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
