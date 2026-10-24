import { Check, Copy, Edit, Trash2, ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "../ui/Button";
import type { Transaction } from "../../services/transactions.service";
import { getTransactionType } from "../../utils/transactionUtils";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTranslateCategory } from "../../hooks/useTranslateCategory";
import { useFormatDate } from "../../hooks/useFormatDate";
import { ConfirmModal } from "../ui/ConfirmModal";
import { EditTransactionModal } from "./EditTransactionModal";
import { TransactionAttachments } from "./TransactionAttachments";
import { ReportSelector } from "../reports/ReportSelector";
import { TagSelector } from "../tags/TagSelector";
import { useTagMutations } from "../../hooks/useTagMutations";
import { useReportMutations } from "../../hooks/useReportMutations";

interface TransactionDetailProps {
  transaction: Transaction;
  onDelete?: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Transaction>) => void;
  onClose?: () => void;
}

export function TransactionDetail({
  transaction,
  onDelete,
  onUpdate,
  onClose,
}: TransactionDetailProps) {
  const { t } = useTranslation();
  const { isIncome } = getTransactionType(
    transaction.transaction_type as "income" | "expense" | "ingreso" | "egreso"
  );

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { translateCategory } = useTranslateCategory();
  const { formatDateTime } = useFormatDate();

  // Tags are read from the React Query cache (transaction.tags). The
  // `useTagMutations` mutation optimistically writes the new tag list back
  // into the same cache via `queryKeys.transactions.all`, so add/remove
  // re-renders happen there without us mirroring the value in local state.
  const { setTransactionTags, isSettingTransactionTags } = useTagMutations();
  const { assignTransactionToReport, isAssigning } = useReportMutations();

  const handleChangeTags = (ids: string[]) => {
    // The TagSelector's `onChange` passes the full new selected list
    // (toggle semantics). The mutation's onMutate writes the optimistic
    // list straight into the transactions cache; no local mirror needed.
    void setTransactionTags({
      transactionId: transaction.id,
      tagIds: ids,
    }).catch(error => {
      console.error("Error updating transaction tags:", error);
    });
  };

  const handleAssignReport = async (reportId: string | null) => {
    try {
      await assignTransactionToReport({
        transactionId: transaction.id,
        reportId,
      });
    } catch (error) {
      console.error("Failed to assign transaction to report:", error);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;

    setIsDeleting(true);
    try {
      await onDelete(transaction.id);
      setShowDeleteModal(false);
      onClose?.();
    } catch (error) {
      console.error("Error deleting transaction:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUpdate = async (updates: Partial<Transaction>) => {
    if (!onUpdate) return;
    await onUpdate(transaction.id, updates);
  };

  const dateTimeStr = formatTransactionDateTime(
    formatDateTime,
    transaction.transaction_date || transaction.date
  );
  const amountDisplay = formatTransactionAmount(transaction.amount);

  return (
    <div className="h-full flex flex-col bg-white lg:rounded-3xl relative lg:shadow-sm lg:border border-zinc-100">
      {/* Mobile Close Button */}
      {onClose && (
        <Button
          onClick={onClose}
          variant="ghost"
          size="sm"
          icon={<X size={20} />}
          className="lg:hidden absolute top-4 right-4 z-10"
        />
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">
        <TransactionDetailHero
          isIncome={isIncome}
          currency={transaction.currency}
          amountDisplay={amountDisplay}
          merchant={transaction.merchant || t("transactions.unknown")}
          categoryLabel={translateCategory(transaction.category)}
        />

        {/* Details List */}
        <div className="space-y-6 px-1">
          <DetailRow label={t("transactions.dateTime")} value={dateTimeStr} />

          <DetailRow
            label={t("transactions.type")}
            value={
              isIncome ? t("transactions.income") : t("transactions.expense")
            }
          />

          <DetailRow
            label={
              isIncome
                ? t("transactions.receivedFrom")
                : t("transactions.merchant")
            }
            value={transaction.merchant || t("transactions.unknown")}
          />

          <DetailRow
            label={t("transactions.description")}
            value={transaction.transaction_description}
          />

          <DetailRow
            label={t("transactions.amount")}
            value={`${transaction.currency} ${amountDisplay}`}
          />

          <TransactionReferenceRow
            sourceMessageId={transaction.source_message_id}
          />
        </div>

        {/* Tags */}
        <div className="mt-6 px-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[var(--text-secondary)] text-sm font-medium">
              {t("tags.title", "Tags")}
            </span>
            <TagSelector
              mode="assign"
              value={(transaction.tags ?? []).map(t => t.id)}
              onChange={handleChangeTags}
              disabled={isSettingTransactionTags}
              iconOnly
            />
          </div>
        </div>

        {/* Report */}
        <div className="mt-4 px-1">
          <ReportSelector
            label={t("reports.title", "Report")}
            value={transaction.report_id ?? null}
            disabled={isAssigning}
            onChange={handleAssignReport}
          />
        </div>

        {/* Attachments */}
        <TransactionAttachments transactionId={transaction.id} />
      </div>

      {/* Footer Actions — always visible at the bottom */}
      <div className="shrink-0 p-6 pt-4 border-t border-zinc-100">
        <div className="flex gap-3">
          <Button
            onClick={() => setShowDeleteModal(true)}
            variant="danger"
            size="md"
            icon={<Trash2 size={16} />}
            fullWidth
          >
            {t("transactions.delete")}
          </Button>
          <Button
            onClick={() => setShowEditModal(true)}
            variant="secondary"
            size="md"
            icon={<Edit size={16} />}
            fullWidth
          >
            {t("transactions.edit")}
          </Button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title={t("transactions.deleteTransaction")}
        message={t("transactions.deleteConfirmation")}
        confirmText={t("transactions.delete")}
        isDestructive={true}
        isLoading={isDeleting}
      />

      {/* Edit Modal */}
      <EditTransactionModal
        key={transaction.id}
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSave={handleUpdate}
        transaction={transaction}
      />
    </div>
  );
}

function formatTransactionDateTime(
  format: (value: string) => string,
  value: string
): string {
  try {
    return format(value);
  } catch {
    return "Invalid date";
  }
}

function formatTransactionAmount(amount: number): string {
  try {
    return amount.toLocaleString();
  } catch {
    return "error";
  }
}

function TransactionDetailHero({
  isIncome,
  currency,
  amountDisplay,
  merchant,
  categoryLabel,
}: {
  isIncome: boolean;
  currency: string;
  amountDisplay: string;
  merchant: string;
  categoryLabel: string;
}) {
  return (
    <>
      <div className="flex justify-center mb-6 mt-2">
        <div
          className={`p-4 rounded-2xl ${
            isIncome ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
          }`}
        >
          {isIncome ? (
            <ArrowDown strokeWidth={3} size={32} />
          ) : (
            <ArrowUp strokeWidth={3} size={32} />
          )}
        </div>
      </div>

      <div className="text-center mb-3">
        <h1 className="text-3xl font-semibold text-[var(--text-primary)] tracking-tight">
          {isIncome ? "+" : "-"}
          {currency} {amountDisplay}
        </h1>
      </div>

      <div className="flex justify-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-50 border border-zinc-100 rounded-full text-sm text-[var(--text-secondary)] shadow-sm">
          <div
            className={`size-2 rounded-full ${isIncome ? "bg-green-500" : "bg-red-500"}`}
          />
          <span className="font-medium text-[var(--text-primary)]">
            {merchant}
          </span>
          <span className="text-zinc-300 text-xs">•</span>
          <span className="capitalize">{categoryLabel}</span>
        </div>
      </div>
    </>
  );
}

function TransactionReferenceRow({
  sourceMessageId,
}: {
  sourceMessageId: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopyId = () => {
    if (typeof window !== "undefined" && window.navigator?.clipboard) {
      window.navigator.clipboard.writeText(sourceMessageId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[var(--text-secondary)] text-sm">
        {t("transactions.reference")}
      </span>
      <div className="flex items-center gap-2 text-[var(--text-primary)] font-medium text-sm text-right overflow-hidden pl-4">
        <span className="truncate w-32 md:w-40 font-mono text-xs opacity-70">
          {sourceMessageId}
        </span>
        <Button
          onClick={handleCopyId}
          variant="ghost"
          size="sm"
          icon={
            copied ? (
              <Check size={14} className="text-green-500" />
            ) : (
              <Copy size={14} />
            )
          }
          title={t("common.copy")}
        />
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[var(--text-secondary)] text-sm">{label}</span>
      <span className="text-[var(--text-primary)] font-medium text-sm text-right">
        {value}
      </span>
    </div>
  );
}
