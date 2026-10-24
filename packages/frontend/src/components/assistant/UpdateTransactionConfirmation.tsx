import { useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, CircleAlert, Loader2 } from "lucide-react";
import type { ToolUIPart } from "ai";
import { getSupabase } from "../../lib/supabase";
import { TagBadge } from "../tags/TagBadge";
import { ToolApprovalCard } from "./ToolApprovalCard";
import { useTags } from "../../hooks/useTags";
import { useReports } from "../../hooks/useReports";
import type { Tag } from "../../types/tags";

type UpdateFields = {
  category?: string;
  name?: string;
  merchant?: string;
  amount?: number;
  currency?: string;
  transaction_description?: string;
  transaction_type?: "income" | "expense";
  transaction_date?: string;
  tag_ids?: string[];
  report_id?: string | null;
};

type UpdateTransactionInput = {
  transactionId: string;
  updates: UpdateFields;
};

type UpdateTransactionToolUIPart = ToolUIPart<{
  updateTransactionTool: {
    input: UpdateTransactionInput;
    output: unknown;
  };
}>;

interface UpdateTransactionConfirmationProps {
  part: UpdateTransactionToolUIPart;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

interface TransactionDetail {
  id: string;
  name: string | null;
  merchant: string | null;
  amount: number | null;
  currency: string | null;
  transaction_date: string | null;
  transaction_type: string | null;
  category: string | null;
  transaction_description: string | null;
  report_id: string | null;
  reports: { id: string; title: string; status: string } | null;
}

const FIELD_LABELS: Partial<Record<keyof UpdateFields, string>> = {
  category: "assistant.createTransaction.category",
  name: "assistant.createTransaction.name",
  merchant: "assistant.createTransaction.merchant",
  amount: "assistant.createTransaction.amount",
  currency: "assistant.updateTransaction.fields.currency",
  transaction_description: "assistant.createTransaction.description",
  transaction_type: "assistant.createTransaction.type",
  transaction_date: "assistant.createTransaction.date",
};

function formatValue(
  field: keyof UpdateFields,
  value: string | number | null | undefined
): string {
  if (value === undefined || value === null || value === "") return "—";
  if (field === "amount" && typeof value === "number") {
    return value.toLocaleString();
  }
  if (field === "transaction_type" && typeof value === "string") {
    return value;
  }
  return String(value);
}

/** Single-pass resolution of tag ids against the user's tag catalog. */
function resolveTagIds(ids: string[], lookup: Map<string, Tag>): Tag[] {
  const out: Tag[] = [];
  for (const id of ids) {
    const tag = lookup.get(id);
    if (tag) out.push(tag);
  }
  return out;
}

/**
 * Single-pass diff of two tag-id lists against the catalog. Returns tags
 * that were added (in `after` but not `before`) and removed (vice versa).
 */
function diffTagLists(
  before: string[],
  after: string[],
  lookup: Map<string, Tag>
): { addedTags: Tag[]; removedTags: Tag[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const addedTags: Tag[] = [];
  const removedTags: Tag[] = [];

  for (const id of after) {
    if (!beforeSet.has(id)) {
      const tag = lookup.get(id);
      if (tag) addedTags.push(tag);
    }
  }
  for (const id of before) {
    if (!afterSet.has(id)) {
      const tag = lookup.get(id);
      if (tag) removedTags.push(tag);
    }
  }
  return { addedTags, removedTags };
}

interface DetailFetchResult {
  detail: TransactionDetail | null;
  currentTagIds: string[];
  currentReportId: string | null;
  loading: boolean;
  notFound: boolean;
}

/** Loads the current transaction row + its tag associations on demand. */
function useTransactionDetail(
  transactionId: string,
  enabled: boolean
): DetailFetchResult {
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [currentTagIds, setCurrentTagIds] = useState<string[]>([]);
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!enabled || !transactionId) return;

    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    void (async () => {
      const supabase = await getSupabase();
      const [detailRes, tagsRes] = await Promise.all([
        supabase
          .from("transactions")
          .select(
            "id, name, merchant, amount, currency, transaction_date, transaction_type, category, transaction_description, report_id, reports ( id, title, status )"
          )
          .eq("id", transactionId)
          .eq("discarded", false)
          .single(),
        supabase
          .from("transaction_tags")
          .select("tag_id")
          .eq("transaction_id", transactionId),
      ]);

      if (cancelled) return;
      if (detailRes.error) {
        setDetail(null);
        setNotFound(true);
      } else {
        const row = detailRes.data as unknown as TransactionDetail;
        setDetail(row);
        setCurrentReportId(row.report_id ?? null);
      }
      setCurrentTagIds(
        ((tagsRes.data ?? []) as unknown as Array<{ tag_id: string }>).map(
          r => r.tag_id
        )
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [transactionId, enabled]);

  return { detail, currentTagIds, currentReportId, loading, notFound };
}

function deriveProposedReportState(
  updates: Partial<Record<keyof UpdateFields, unknown>>,
  enabled: boolean
): {
  proposedReportId: string | null;
  proposedReportChange: boolean;
  shouldResolveProposedReport: boolean;
} {
  const proposedReportId =
    typeof updates.report_id === "string" ? updates.report_id : null;
  const proposedReportChange = updates.report_id !== undefined;
  const shouldResolveProposedReport =
    enabled && proposedReportChange && proposedReportId !== null;
  return {
    proposedReportId,
    proposedReportChange,
    shouldResolveProposedReport,
  };
}

function isProposedReportInvalid(
  shouldResolve: boolean,
  pending: boolean,
  error: boolean,
  proposedReport: { id: string } | undefined
): boolean {
  return shouldResolve && !pending && (error || !proposedReport);
}

function isUpdateApprovalBlocked(
  loading: boolean,
  notFound: boolean,
  detailLoaded: boolean,
  proposedReportPending: boolean,
  invalidProposedReport: boolean
): boolean {
  return (
    loading ||
    notFound ||
    !detailLoaded ||
    proposedReportPending ||
    invalidProposedReport
  );
}

export function UpdateTransactionConfirmation({
  part,
  onApprove,
  onReject,
}: UpdateTransactionConfirmationProps) {
  const input = part.input;
  const transactionId = input?.transactionId ?? "";
  const updates = input?.updates ?? {};
  const enabled = part.state === "approval-requested";

  const { detail, currentTagIds, currentReportId, loading, notFound } =
    useTransactionDetail(transactionId, enabled);

  const summary = detail?.name ?? detail?.merchant ?? "";

  const {
    proposedReportId,
    proposedReportChange,
    shouldResolveProposedReport,
  } = deriveProposedReportState(updates, enabled);
  const {
    data: activeReports = [],
    isLoading: proposedReportPending,
    isError: proposedReportError,
  } = useReports("active", shouldResolveProposedReport);
  const activeReportsById = useMemo(
    () => new Map(activeReports.map(report => [report.id, report])),
    [activeReports]
  );
  const currentReport = detail?.reports ?? null;
  const proposedReport = proposedReportId
    ? activeReportsById.get(proposedReportId)
    : undefined;
  const invalidProposedReport = isProposedReportInvalid(
    shouldResolveProposedReport,
    proposedReportPending,
    proposedReportError,
    proposedReport
  );

  let content: React.ReactNode;
  if (loading) {
    content = <UpdateApprovalLoading />;
  } else if (notFound || !detail) {
    content = <UpdateApprovalNotFound />;
  } else {
    content = (
      <UpdateApprovalContent
        detail={detail}
        updates={updates}
        currentTagIds={currentTagIds}
        currentReportId={currentReportId}
        currentReport={currentReport}
        proposedReportChange={proposedReportChange}
        proposedReportId={proposedReportId}
        proposedReport={proposedReport ?? null}
        proposedReportLoading={proposedReportPending}
        invalidProposedReport={invalidProposedReport}
      />
    );
  }

  const disableApprovalActions = isUpdateApprovalBlocked(
    loading,
    notFound,
    detail !== null,
    proposedReportPending,
    invalidProposedReport
  );

  return (
    <ApprovalCardShell
      part={part}
      onApprove={onApprove}
      onReject={onReject}
      summary={summary}
      disableApprovalActions={disableApprovalActions}
    >
      {content}
    </ApprovalCardShell>
  );
}

function ApprovalCardShell({
  part,
  onApprove,
  onReject,
  summary,
  disableApprovalActions,
  children,
}: {
  part: UpdateTransactionToolUIPart;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  summary: string;
  disableApprovalActions: boolean;
  children: React.ReactNode;
}) {
  return (
    <ToolApprovalCard
      part={part}
      onApprove={onApprove}
      onReject={onReject}
      i18nPrefix="assistant.updateTransaction"
      count={1}
      summary={summary}
      disableApprovalActions={disableApprovalActions}
    >
      {children}
    </ToolApprovalCard>
  );
}

function UpdateApprovalLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-[var(--text-secondary)]">
      <Loader2 className="size-4 animate-spin" />
      {t("assistant.deleteTransaction.loadingDetails")}
    </div>
  );
}

function UpdateApprovalNotFound() {
  const { t } = useTranslation();
  return (
    <p className="py-4 text-sm text-[var(--text-secondary)]">
      {t("assistant.updateTransaction.notFound")}
    </p>
  );
}

interface UpdateApprovalContentProps {
  detail: TransactionDetail;
  updates: UpdateFields;
  currentTagIds: string[];
  currentReportId: string | null;
  currentReport: { id: string; title: string; status: string } | null;
  proposedReportChange: boolean;
  proposedReportId: string | null;
  proposedReport: { id: string; title: string; status: string } | null;
  proposedReportLoading: boolean;
  invalidProposedReport: boolean;
}

function UpdateApprovalContent({
  detail,
  updates,
  currentTagIds,
  currentReportId,
  currentReport,
  proposedReportChange,
  proposedReportId,
  proposedReport,
  proposedReportLoading,
  invalidProposedReport,
}: UpdateApprovalContentProps) {
  const { t } = useTranslation();
  const { data: allTags = [] } = useTags();
  const tagsById = useMemo(
    () => new Map(allTags.map(tag => [tag.id, tag])),
    [allTags]
  );

  const changedFields = Object.keys(updates).filter(
    (k): k is keyof UpdateFields =>
      updates[k as keyof UpdateFields] !== undefined &&
      updates[k as keyof UpdateFields] !== null
  );

  const isIncome =
    updates.transaction_type === "income" ||
    (!updates.transaction_type && detail.transaction_type === "income");
  const isExpense =
    updates.transaction_type === "expense" ||
    (!updates.transaction_type && detail.transaction_type === "expense");

  const effectiveCurrency = updates.currency ?? detail.currency ?? "USD";
  const effectiveAmount = updates.amount ?? detail.amount ?? null;
  const amountDisplay =
    effectiveAmount != null ? effectiveAmount.toLocaleString() : "—";
  const amountValue = `${isIncome ? "+" : isExpense ? "-" : ""}${effectiveCurrency} ${amountDisplay}`;

  return (
    <>
      <UpdateHeader
        isIncome={isIncome}
        isExpense={isExpense}
        amountValue={amountValue}
      />
      <UpdateFieldsList
        detail={detail}
        updates={updates}
        changedFields={changedFields}
        t={t}
      />
      <UpdateReportSection
        currentReportId={currentReportId}
        currentReport={currentReport}
        proposedReportChange={proposedReportChange}
        proposedReportId={proposedReportId}
        proposedReport={proposedReport}
        proposedReportLoading={proposedReportLoading}
        invalidProposedReport={invalidProposedReport}
        t={t}
      />
      <UpdateTagsSection
        updates={updates}
        currentTagIds={currentTagIds}
        tagsById={tagsById}
        t={t}
      />
    </>
  );
}

function UpdateHeader({
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
      <div className="mb-4 flex justify-center">
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
      <div className="mb-5 text-center">
        <p className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
          {amountValue}
        </p>
      </div>
    </>
  );
}

function UpdateFieldsList({
  detail,
  updates,
  changedFields,
  t,
}: {
  detail: TransactionDetail;
  updates: UpdateFields;
  changedFields: (keyof UpdateFields)[];
  t: TFunction;
}) {
  return (
    <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      {(
        [
          "amount",
          "merchant",
          "category",
          "transaction_date",
        ] as (keyof UpdateFields)[]
      ).map(field => (
        <UpdateDiffField
          key={field}
          field={field}
          currentValue={
            (detail as unknown as Record<string, unknown>)[
              field === "transaction_date" ? "transaction_date" : field
            ] as string | number | null
          }
          newValue={updates[field] as string | number | null | undefined}
          isChanged={changedFields.includes(field)}
          t={t}
        />
      ))}
      {(changedFields.includes("name") || detail.name) && (
        <UpdateWideDiffField
          labelKey="name"
          wide
          label={t(FIELD_LABELS.name ?? "name")}
          currentDisplay={detail.name ?? "—"}
          newDisplay={updates.name}
          isChanged={changedFields.includes("name")}
        />
      )}
      {(changedFields.includes("transaction_description") ||
        detail.transaction_description) && (
        <UpdateWideDiffField
          labelKey="description"
          wide
          label={t(FIELD_LABELS.transaction_description ?? "description")}
          currentDisplay={detail.transaction_description ?? "—"}
          newDisplay={updates.transaction_description}
          isChanged={changedFields.includes("transaction_description")}
        />
      )}
    </dl>
  );
}

function UpdateDiffField({
  field,
  currentValue,
  newValue,
  isChanged,
  t,
}: {
  field: keyof UpdateFields;
  currentValue: string | number | null;
  newValue: string | number | null | undefined;
  isChanged: boolean;
  t: TFunction;
}) {
  const currentDisplay = formatValue(field, currentValue);
  const newDisplay = formatValue(field, newValue);
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-[var(--text-secondary)]">
        {t(FIELD_LABELS[field] ?? field)}
      </dt>
      {isChanged ? (
        <dd className="truncate">
          <span className="font-medium text-[var(--text-secondary)] line-through">
            {currentDisplay}
          </span>{" "}
          <span className="font-semibold text-[var(--text-primary)]">
            {newDisplay}
          </span>
        </dd>
      ) : (
        <dd className="truncate font-medium text-[var(--text-primary)]">
          {currentDisplay}
        </dd>
      )}
    </div>
  );
}

function UpdateWideDiffField({
  labelKey: _labelKey,
  wide: _wide,
  label,
  currentDisplay,
  newDisplay,
  isChanged,
}: {
  labelKey: string;
  wide: boolean;
  label: string;
  currentDisplay: string;
  newDisplay: string | undefined;
  isChanged: boolean;
}) {
  return (
    <div className="col-span-2 min-w-0">
      <dt className="text-xs font-medium text-[var(--text-secondary)]">
        {label}
      </dt>
      {isChanged ? (
        <dd>
          {currentDisplay !== "—" && (
            <span className="font-medium text-[var(--text-secondary)] line-through">
              {currentDisplay}
            </span>
          )}{" "}
          <span className="font-semibold text-[var(--text-primary)]">
            {newDisplay ?? "—"}
          </span>
        </dd>
      ) : (
        <dd className="font-medium text-[var(--text-primary)]">
          {currentDisplay}
        </dd>
      )}
    </div>
  );
}

interface UpdateReportSectionProps {
  currentReportId: string | null;
  currentReport: { title: string } | null;
  proposedReportChange: boolean;
  proposedReportId: string | null;
  proposedReport: { title: string; status: string } | null;
  proposedReportLoading: boolean;
  invalidProposedReport: boolean;
  t: TFunction;
}

function UpdateReportSection({
  currentReportId,
  currentReport,
  proposedReportChange,
  proposedReportId,
  proposedReport,
  proposedReportLoading,
  invalidProposedReport,
  t,
}: UpdateReportSectionProps) {
  if (!proposedReportChange) return null;

  const oldTitle = currentReportId
    ? (currentReport?.title ?? "—")
    : t("assistant.updateTransaction.reportNone");
  const newTitle =
    proposedReportId === null
      ? t("assistant.updateTransaction.reportNone")
      : proposedReportLoading
        ? null
        : (proposedReport?.title ?? null);

  const currentDisplay = oldTitle;
  const proposedDisplay = newTitle ?? (proposedReportLoading ? "…" : "—");

  const renderUnavailable =
    invalidProposedReport && !proposedReportLoading && proposedReportId;

  return (
    <div className="col-span-2 mb-4 min-w-0">
      <dt className="text-xs font-medium text-[var(--text-secondary)]">
        {t("assistant.updateTransaction.report")}
      </dt>
      {renderUnavailable ? (
        <dd className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-700">
          <CircleAlert className="size-4 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {t("assistant.updateTransaction.reportUnavailable")}
            </p>
            <p className="text-xs text-rose-600/80">
              {t("assistant.updateTransaction.reportUnavailableHint")}
            </p>
          </div>
        </dd>
      ) : (
        <dd className="flex flex-wrap items-center gap-2 text-sm">
          <span className="truncate font-medium text-[var(--text-secondary)]">
            {currentDisplay}
          </span>
          <span className="text-[var(--text-secondary)]">→</span>
          <span className="truncate font-semibold text-[var(--text-primary)]">
            {proposedDisplay}
          </span>
        </dd>
      )}
    </div>
  );
}

function UpdateTagsSection({
  updates,
  currentTagIds,
  tagsById,
  t,
}: {
  updates: UpdateFields;
  currentTagIds: string[];
  tagsById: Map<string, Tag>;
  t: TFunction;
}) {
  const tagsChanged = updates.tag_ids !== undefined;
  const nextTagIds: string[] = updates.tag_ids ?? currentTagIds;

  const { addedTags, removedTags } = tagsChanged
    ? diffTagLists(currentTagIds, nextTagIds, tagsById)
    : { addedTags: [], removedTags: [] };
  const finalTags = resolveTagIds(nextTagIds, tagsById);

  return (
    <div className="col-span-2 min-w-0">
      <dt className="text-xs font-medium text-[var(--text-secondary)]">
        {t("tags.title", "Tags")}
      </dt>
      {tagsChanged ? (
        <dd className="space-y-2">
          {removedTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[var(--text-secondary)]">−</span>
              {removedTags.map(tag => (
                <TagBadge
                  key={`r-${tag.id}`}
                  name={tag.name}
                  color={tag.color}
                  size="sm"
                  className="opacity-60"
                />
              ))}
            </div>
          )}
          {addedTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[var(--text-secondary)]">+</span>
              {addedTags.map(tag => (
                <TagBadge
                  key={`a-${tag.id}`}
                  name={tag.name}
                  color={tag.color}
                  size="sm"
                />
              ))}
            </div>
          )}
          {addedTags.length === 0 && removedTags.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)]">
              {t("assistant.updateTransaction.tagsUnchanged")}
            </p>
          )}
        </dd>
      ) : currentTagIds.length > 0 ? (
        <dd className="flex flex-wrap gap-1.5">
          {finalTags.map(tag => (
            <TagBadge
              key={tag.id}
              name={tag.name}
              color={tag.color}
              size="sm"
            />
          ))}
        </dd>
      ) : null}
    </div>
  );
}
