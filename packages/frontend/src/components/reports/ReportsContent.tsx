import { useTranslation } from "react-i18next";
import { ReportList } from "./ReportList";
import { EmptyReportsState } from "./EmptyReportsState";
import { useReports } from "../../hooks/useReports";
import { ReportsSkeleton } from "./ReportsSkeleton";
import type { ReportStatus } from "../../types/reports";

interface ReportsContentProps {
  status: ReportStatus;
  onCreate?: () => void;
}

export function ReportsContent({ status, onCreate }: ReportsContentProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useReports(status);

  if (isLoading) {
    return <ReportsSkeleton />;
  }

  if (status === "archived") {
    if (data.length === 0) {
      return <EmptyReportsState variant="archived" />;
    }
    return <ReportList reports={data} />;
  }

  if (data.length === 0) {
    return <EmptyReportsState onCreate={onCreate} />;
  }

  return (
    <>
      <ReportList reports={data} emptyAction={onCreate} />
      <div className="sr-only">{t("reports.title")}</div>
    </>
  );
}
