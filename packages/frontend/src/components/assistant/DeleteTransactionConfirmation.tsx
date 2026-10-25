import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Trash2,
} from "lucide-react";
import type { ToolUIPart } from "ai";
import { getSupabase } from "../../lib/supabase";
import { Button } from "@/components/ui/Button";
import { ToolApprovalCard } from "./ToolApprovalCard";

type DeleteTransactionInput = {
  transactionIds: string[];
  reason?: string;
};

type DeleteTransactionToolUIPart = ToolUIPart<{
  deleteTransactionTool: {
    input: DeleteTransactionInput;
    output: unknown;
  };
}>;

interface DeleteTransactionConfirmationProps {
  part: DeleteTransactionToolUIPart;
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
}

function summarizeDetails(details: TransactionDetail[]): string {
  return details
    .flatMap(d => [d.name, d.merchant].filter((v): v is string => !!v))
    .join(", ");
}

function DeleteDetailsCarousel({
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
    <div className="mb-4 flex items-center justify-center gap-1">
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

function DeleteAmountHero({
  transactionType,
  currency,
  amount,
}: {
  transactionType: string | null;
  currency: string | null;
  amount: number | null;
}) {
  const isIncome = transactionType === "income";
  const amountDisplay = amount != null ? amount.toLocaleString() : "—";

  return (
    <>
      <div className="mb-4 flex justify-center">
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

      <div className="mb-5 text-center">
        <p className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
          {`${isIncome ? "+" : "-"}${currency ?? "USD"} ${amountDisplay}`}
        </p>
      </div>
    </>
  );
}

interface DeleteApprovalDetailsProps {
  loading: boolean;
  details: TransactionDetail[];
  count: number;
  currentIndex: number;
  reason?: string;
  onPrev: () => void;
  onNext: () => void;
}

function DeleteApprovalDetails({
  loading,
  details,
  count,
  currentIndex,
  reason,
  onPrev,
  onNext,
}: DeleteApprovalDetailsProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-[var(--text-secondary)]">
        <Loader2 className="size-4 animate-spin" />
        {t("assistant.deleteTransaction.loadingDetails")}
      </div>
    );
  }

  if (details.length === 0) {
    return (
      <p className="py-4 text-sm text-[var(--text-secondary)]">
        {t("assistant.deleteTransaction.notFound", { count })}
      </p>
    );
  }

  const current = details[currentIndex] ?? details[0];
  if (!current) return null;

  const total = details.length;

  return (
    <>
      {total > 1 && (
        <DeleteDetailsCarousel
          currentIndex={currentIndex}
          total={total}
          onPrev={onPrev}
          onNext={onNext}
        />
      )}

      <DeleteAmountHero
        transactionType={current.transaction_type}
        currency={current.currency}
        amount={current.amount}
      />

      <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="min-w-0">
          <dt className="text-xs font-medium text-[var(--text-secondary)]">
            {t("assistant.createTransaction.merchant")}
          </dt>
          <dd className="truncate font-medium text-[var(--text-primary)]">
            {current.merchant ?? "—"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-[var(--text-secondary)]">
            {t("assistant.createTransaction.category")}
          </dt>
          <dd className="truncate font-medium text-[var(--text-primary)]">
            {current.category ?? "—"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-[var(--text-secondary)]">
            {t("assistant.createTransaction.date")}
          </dt>
          <dd className="truncate font-medium text-[var(--text-primary)]">
            {current.transaction_date ?? "—"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-[var(--text-secondary)]">
            {t("assistant.createTransaction.type")}
          </dt>
          <dd className="truncate font-medium text-[var(--text-primary)]">
            {current.transaction_type
              ? t(
                  `assistant.createTransaction.types.${current.transaction_type}`
                )
              : "—"}
          </dd>
        </div>
        {current.name && (
          <div className="col-span-2 min-w-0">
            <dt className="text-xs font-medium text-[var(--text-secondary)]">
              {t("assistant.createTransaction.name")}
            </dt>
            <dd className="font-medium text-[var(--text-primary)]">
              {current.name}
            </dd>
          </div>
        )}
        {current.transaction_description && (
          <div className="col-span-2 min-w-0">
            <dt className="text-xs font-medium text-[var(--text-secondary)]">
              {t("assistant.createTransaction.description")}
            </dt>
            <dd className="font-medium text-[var(--text-primary)]">
              {current.transaction_description}
            </dd>
          </div>
        )}
      </dl>

      {reason && (
        <p className="text-xs text-[var(--text-secondary)]">
          <span className="font-medium">
            {t("assistant.deleteTransaction.reason")}:
          </span>{" "}
          {reason}
        </p>
      )}
    </>
  );
}

export function DeleteTransactionConfirmation({
  part,
  onApprove,
  onReject,
}: DeleteTransactionConfirmationProps) {
  const [details, setDetails] = useState<TransactionDetail[]>([]);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  const input = part.input;
  const ids = useMemo(
    () =>
      (input?.transactionIds ?? []).filter(
        (id): id is string => typeof id === "string"
      ),
    [input?.transactionIds]
  );
  const reason = input?.reason;
  const count = ids.length;
  const loading = count > 0 && fetchLoading;

  useEffect(() => {
    if (part.state !== "approval-requested") return;
    if (ids.length === 0) return;

    let cancelled = false;
    void (async () => {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from("transactions")
        .select(
          "id, name, merchant, amount, currency, transaction_date, transaction_type, category, transaction_description"
        )
        .in("id", ids)
        .eq("discarded", false)
        .order("transaction_date", { ascending: false });

      if (cancelled) return;
      if (error) {
        setDetails([]);
      } else {
        setDetails((data ?? []) as unknown as TransactionDetail[]);
      }
      setFetchLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [part.state, ids]);

  const total = details.length;

  return (
    <ToolApprovalCard
      part={part}
      onApprove={onApprove}
      onReject={onReject}
      i18nPrefix="assistant.deleteTransaction"
      count={count}
      summary={summarizeDetails(details)}
      confirmVariant="danger"
      confirmIcon={<Trash2 size={16} />}
      disableApprovalActions={!fetchLoading && details.length === 0}
    >
      <DeleteApprovalDetails
        loading={loading}
        details={details}
        count={count}
        currentIndex={currentIndex}
        reason={reason}
        onPrev={() => setCurrentIndex(i => Math.max(0, i - 1))}
        onNext={() => setCurrentIndex(i => Math.min(total - 1, i + 1))}
      />
    </ToolApprovalCard>
  );
}
