import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  CheckIcon,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  XIcon,
} from "lucide-react";
import type { ToolUIPart } from "ai";
import { Button } from "@/components/ui/Button";
import { TagBadge } from "../tags/TagBadge";
import { useTags } from "../../hooks/useTags";
import { useReports } from "../../hooks/useReports";
import type { ReportSummary } from "../../types/reports";
import type { Tag } from "../../types/tags";

type Txn = {
  transaction_type?: "income" | "expense";
  name?: string;
  merchant?: string;
  amount?: number;
  currency?: string;
  category?: string;
  transaction_date?: string;
  transaction_description?: string;
  tag_ids?: string[];
  report_id?: string;
};

type CreateTransactionInput = {
  transactions: Txn[];
};

type CreateTransactionOutputTxn = {
  id: string;
  transactionDate: string;
  name: string;
  merchant: string;
  amount: number;
  currency: string;
  transactionType: "income" | "expense";
  category: string;
  tagIds: string[];
  reportId: string | null;
  reportTitle: string | null;
};

type CreateTransactionOutput = {
  success: boolean;
  transactions: CreateTransactionOutputTxn[];
  totalCount: number;
  message: string;
};

type CreateTransactionToolUIPart = ToolUIPart<{
  createTransactionTool: {
    input: CreateTransactionInput;
    output: CreateTransactionOutput;
  };
}>;

interface CreateTransactionConfirmationProps {
  part: CreateTransactionToolUIPart;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

const TOOL_DENIED_RESULT = "Tool call was not approved by the user";

/**
 * Mastra does not emit a `tool-output-denied` chunk on the wire for rejected
 * tools. See `node_modules/@mastra/core/dist/chunk-*.js` — the `execution-denied`
 * branch in the tool-call approval flow. It surfaces in the UI as either:
 *
 * - `output: { type: "execution-denied", reason?: string }` (live streaming)
 * - `output: "Tool call was not approved by the user"` (persisted / reloaded)
 */
function isExecutionDeniedOutput(output: unknown): boolean {
  if (typeof output === "string") {
    return output === TOOL_DENIED_RESULT;
  }
  if (output && typeof output === "object" && "type" in output) {
    return (output as { type: unknown }).type === "execution-denied";
  }
  return false;
}

const ARTICLE_SHELL =
  "my-3 max-w-md rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-5 shadow-sm";
const ROW_SHELL =
  "my-3 flex w-full max-w-md items-center gap-3 rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4";

export function CreateTransactionConfirmation({
  part,
  onApprove,
  onReject,
}: CreateTransactionConfirmationProps) {
  const transactions = part.input?.transactions ?? [];
  const [currentIndex, setCurrentIndex] = useState(0);
  const current = transactions[currentIndex] ?? transactions[0];

  if (part.state === "input-streaming" || part.state === "input-available") {
    return null;
  }
  if (!part.input?.transactions || part.input.transactions.length === 0) {
    return null;
  }

  const isDenied =
    part.state === "output-denied" ||
    (part.state === "output-available" && isExecutionDeniedOutput(part.output));
  const total = transactions.length;

  if (part.state === "approval-requested" && current) {
    return (
      <CreateTransactionApprovalCard
        part={part}
        current={current}
        currentIndex={currentIndex}
        total={total}
        showCarousel={total > 1}
        onPrev={() => setCurrentIndex(i => Math.max(0, i - 1))}
        onNext={() => setCurrentIndex(i => Math.min(total - 1, i + 1))}
        onApprove={() => onApprove(part.approval.id)}
        onReject={() => onReject(part.approval.id)}
      />
    );
  }

  if (part.state === "approval-responded") {
    return (
      <CreateTransactionProcessingRow
        wasApproved={part.approval.approved !== false}
        total={total}
      />
    );
  }

  if (isDenied) {
    return (
      <CreateTransactionDeniedRow
        total={total}
        summary={summarizeTransactions(transactions)}
      />
    );
  }

  if (part.state === "output-error") {
    return <CreateTransactionErrorRow errorText={part.errorText} />;
  }

  if (part.state === "output-available") {
    return (
      <CreateTransactionSuccessRow
        total={total}
        summary={summarizeOutputTransactions(part.output?.transactions)}
      />
    );
  }

  return null;
}

function summarizeTransactions(transactions: Txn[]): string {
  return transactions
    .flatMap(t => [t.name, t.merchant].filter((v): v is string => !!v))
    .join(", ");
}

function summarizeOutputTransactions(
  transactions: CreateTransactionOutputTxn[] | undefined
): string {
  if (!Array.isArray(transactions)) return "";
  return transactions
    .flatMap(t => [t.name, t.merchant].filter((v): v is string => !!v))
    .join(", ");
}

interface CreateTransactionApprovalCardProps {
  part: CreateTransactionToolUIPart;
  current: Txn;
  currentIndex: number;
  total: number;
  showCarousel: boolean;
  onPrev: () => void;
  onNext: () => void;
  onApprove: () => void;
  onReject: () => void;
}

interface ReportResolution {
  resolvedCurrentReport: ReportSummary | undefined;
  currentReportResolved: boolean;
  canConfirm: boolean;
  showBatchReportError: boolean;
}

function deriveReportResolution(
  part: CreateTransactionToolUIPart,
  activeReportsById: Map<string, ReportSummary>,
  reportsLoading: boolean,
  reportsError: boolean,
  current: Txn
): ReportResolution {
  const allTransactions = (part.input?.transactions ?? []).filter(
    (t): t is Txn => t !== undefined && t !== null
  );
  const requestedReportIds = Array.from(
    new Set(
      allTransactions
        .map(txn => txn.report_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    )
  );
  const hasReportRequests = requestedReportIds.length > 0;
  const resolvedCurrentReport = current.report_id
    ? activeReportsById.get(current.report_id)
    : undefined;
  const currentReportResolved = !current.report_id || !reportsLoading;
  const anyReportInvalid =
    reportsError ||
    (!reportsLoading &&
      requestedReportIds.some(id => activeReportsById.get(id) === undefined));
  const reportsReady = !hasReportRequests || (!reportsLoading && !reportsError);

  return {
    resolvedCurrentReport,
    currentReportResolved,
    canConfirm: reportsReady && !anyReportInvalid,
    showBatchReportError:
      anyReportInvalid &&
      (!current.report_id || resolvedCurrentReport !== undefined),
  };
}

function formatAmountValue(
  amount: number | undefined,
  currency: string,
  isIncome: boolean,
  isExpense: boolean
): string {
  const amountDisplay = amount != null ? amount.toLocaleString() : "—";
  const sign = isIncome ? "+" : isExpense ? "-" : "";
  return `${sign}${currency} ${amountDisplay}`;
}

function TransactionCarousel({
  currentIndex,
  total,
  onPrev,
  onNext,
}: {
  currentIndex: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-center gap-1 mb-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={onPrev}
        disabled={currentIndex === 0}
        aria-label={t("assistant.createTransaction.previous")}
        icon={<ChevronLeft size={16} />}
      />
      <span className="min-w-12 text-center text-sm tabular-nums text-[var(--text-secondary)]">
        {t("assistant.createTransaction.counter", {
          current: currentIndex + 1,
          total,
        })}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onNext}
        disabled={currentIndex === total - 1}
        aria-label={t("assistant.createTransaction.next")}
        icon={<ChevronRight size={16} />}
      />
    </div>
  );
}

function TransactionTypeHero({
  isIncome,
  isExpense,
  amountValue,
}: {
  isIncome: boolean;
  isExpense: boolean;
  amountValue: string;
}) {
  return (
    <>
      <div className="flex justify-center mb-4">
        <div
          className={`p-4 rounded-2xl ${
            isIncome
              ? "bg-green-100 text-green-600"
              : isExpense
                ? "bg-red-100 text-red-600"
                : "bg-zinc-100 text-zinc-600"
          }`}
        >
          {isIncome ? (
            <ArrowDown strokeWidth={3} size={32} />
          ) : (
            <ArrowUp strokeWidth={3} size={32} />
          )}
        </div>
      </div>

      <div className="text-center mb-5">
        <p className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
          {amountValue}
        </p>
      </div>
    </>
  );
}

function ReportUnavailableMessage({ t }: { t: TFunction }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium">
        {t("assistant.createTransaction.reportUnavailable")}
      </p>
      <p className="text-xs text-rose-600/80">
        {t("assistant.createTransaction.reportUnavailableHint")}
      </p>
    </div>
  );
}

function ApprovalCardFooter({
  canConfirm,
  onApprove,
  onReject,
}: {
  canConfirm: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();

  return (
    <footer className="mt-5 flex items-center justify-end gap-2">
      <Button
        variant="secondary"
        size="sm"
        icon={<XIcon size={16} />}
        onClick={onReject}
      >
        {t("common.cancel")}
      </Button>
      {canConfirm && (
        <Button
          variant="primary"
          size="sm"
          icon={<CheckIcon size={16} />}
          onClick={onApprove}
        >
          {t("common.confirm")}
        </Button>
      )}
    </footer>
  );
}

function CreateTransactionApprovalCard({
  part,
  current,
  currentIndex,
  total,
  showCarousel,
  onPrev,
  onNext,
  onApprove,
  onReject,
}: CreateTransactionApprovalCardProps) {
  const { t } = useTranslation();
  const { data: allTags = [] } = useTags();
  const {
    data: activeReports = [],
    isLoading: reportsLoading,
    isError: reportsError,
  } = useReports("active");
  const activeReportsById = useMemo(
    () => new Map(activeReports.map(r => [r.id, r])),
    [activeReports]
  );
  const tagsById = useMemo(
    () => new Map(allTags.map(tag => [tag.id, tag])),
    [allTags]
  );
  const currentTags = useMemo(() => {
    const ids = current.tag_ids ?? [];
    return ids.map(id => tagsById.get(id)).filter((tag): tag is Tag => !!tag);
  }, [current, tagsById]);

  const reports = deriveReportResolution(
    part,
    activeReportsById,
    reportsLoading,
    reportsError,
    current
  );

  const isIncome = current.transaction_type === "income";
  const isExpense = current.transaction_type === "expense";
  const amountValue = formatAmountValue(
    current.amount,
    current.currency ?? "USD",
    isIncome,
    isExpense
  );

  return (
    <article
      className={ARTICLE_SHELL}
      aria-label={t("assistant.createTransaction.title", { count: total })}
    >
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
        {t("assistant.createTransaction.title", { count: total })}
      </h3>
      <p className="text-sm text-[var(--text-secondary)] mb-5">
        {t("assistant.createTransaction.subtitle", { count: total })}
      </p>

      {showCarousel && (
        <TransactionCarousel
          currentIndex={currentIndex}
          total={total}
          onPrev={onPrev}
          onNext={onNext}
        />
      )}

      <TransactionTypeHero
        isIncome={isIncome}
        isExpense={isExpense}
        amountValue={amountValue}
      />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <DetailField
          label={t("assistant.createTransaction.amount")}
          value={amountValue}
        />
        <DetailField
          label={t("assistant.createTransaction.merchant")}
          value={current.merchant ?? "—"}
        />
        <DetailField
          label={t("assistant.createTransaction.category")}
          value={current.category ?? "—"}
        />
        <DetailField
          label={t("assistant.createTransaction.date")}
          value={current.transaction_date ?? "—"}
        />
        {current.name && (
          <DetailField
            label={t("assistant.createTransaction.name")}
            value={current.name}
            wide
          />
        )}
        {current.transaction_description && (
          <DetailField
            label={t("assistant.createTransaction.description")}
            value={current.transaction_description}
            wide
          />
        )}
        {current.report_id && (
          <CreateReportField
            label={t("assistant.createTransaction.report")}
            report={reports.resolvedCurrentReport}
            resolved={reports.currentReportResolved}
            t={t}
          />
        )}
        {currentTags.length > 0 && (
          <div className="col-span-2 min-w-0">
            <dt className="text-xs font-medium text-[var(--text-secondary)]">
              {t("tags.title", "Tags")}
            </dt>
            <dd className="flex flex-wrap gap-1.5 mt-1">
              {currentTags.map(tag => (
                <TagBadge
                  key={tag.id}
                  name={tag.name}
                  color={tag.color}
                  size="sm"
                />
              ))}
            </dd>
          </div>
        )}
      </dl>

      {reports.showBatchReportError && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-700">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <ReportUnavailableMessage t={t} />
        </div>
      )}

      <ApprovalCardFooter
        canConfirm={reports.canConfirm}
        onApprove={onApprove}
        onReject={onReject}
      />
    </article>
  );
}

function CreateReportField({
  label,
  report,
  resolved,
  t,
}: {
  label: string;
  report: ReportSummary | undefined;
  resolved: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!resolved) {
    return (
      <div className="col-span-2 min-w-0">
        <dt className="text-xs font-medium text-[var(--text-secondary)]">
          {label}
        </dt>
        <dd className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Loader2 className="size-3 animate-spin" />
          <span>…</span>
        </dd>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="col-span-2 min-w-0">
        <dt className="text-xs font-medium text-[var(--text-secondary)]">
          {label}
        </dt>
        <dd className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-700">
          <CircleAlert className="size-4 shrink-0 mt-0.5" />
          <ReportUnavailableMessage t={t} />
        </dd>
      </div>
    );
  }
  return (
    <div className="col-span-2 min-w-0">
      <dt className="text-xs font-medium text-[var(--text-secondary)]">
        {label}
      </dt>
      <dd className="truncate font-medium text-[var(--text-primary)]">
        {report.title}
      </dd>
    </div>
  );
}

function DetailField({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="text-xs font-medium text-[var(--text-secondary)]">
        {label}
      </dt>
      <dd className="truncate font-medium text-[var(--text-primary)]">
        {value}
      </dd>
    </div>
  );
}

function CreateTransactionProcessingRow({
  wasApproved,
  total,
}: {
  wasApproved: boolean;
  total: number;
}) {
  const { t } = useTranslation();
  const processingKey = wasApproved
    ? "assistant.createTransaction.processing"
    : "assistant.createTransaction.canceling";
  return (
    <div className={ROW_SHELL} aria-label={t(processingKey, { count: total })}>
      <Loader2
        className={`size-4 shrink-0 animate-spin ${
          wasApproved ? "text-[var(--text-secondary)]" : "text-rose-600"
        }`}
      />
      <span className="text-sm font-medium text-[var(--text-primary)]">
        {t(processingKey, { count: total })}
      </span>
    </div>
  );
}

function CreateTransactionDeniedRow({
  total,
  summary,
}: {
  total: number;
  summary: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={ROW_SHELL}
      aria-label={t("assistant.createTransaction.rejected", { count: total })}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
        <XIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {t("assistant.createTransaction.rejected", { count: total })}
        </p>
        {summary && (
          <p className="truncate text-xs text-[var(--text-secondary)]">
            {summary}
          </p>
        )}
      </div>
    </div>
  );
}

function CreateTransactionErrorRow({
  errorText,
}: {
  errorText: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={ROW_SHELL}
      aria-label={t("assistant.createTransaction.error")}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
        <CircleAlert className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {t("assistant.createTransaction.error")}
        </p>
        {errorText && (
          <p className="truncate text-xs text-[var(--text-secondary)]">
            {errorText}
          </p>
        )}
      </div>
    </div>
  );
}

function CreateTransactionSuccessRow({
  total,
  summary,
}: {
  total: number;
  summary: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={ROW_SHELL}
      aria-label={t("assistant.createTransaction.approved", { count: total })}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <CheckIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {t("assistant.createTransaction.approved", { count: total })}
        </p>
        {summary && (
          <p className="line-clamp-2 text-xs text-[var(--text-secondary)]">
            {summary}
          </p>
        )}
      </div>
    </div>
  );
}
