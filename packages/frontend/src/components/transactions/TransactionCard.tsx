import { LazyMotion, m, domAnimation } from "framer-motion";
import type { Transaction } from "../../services/transactions.service";
import type { ReportSummary } from "../../types/reports";
import { getTransactionType } from "../../utils/transactionUtils";
import { useTranslateCategory } from "../../hooks/useTranslateCategory";
import { useFormatDate } from "../../hooks/useFormatDate";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import { gmailService } from "../../services/gmail.service";
import { getCurrencySymbol } from "../../utils/currency";
import { useEffect, useState } from "react";
import { TagBadge } from "../tags/TagBadge";
import { ReportBadge } from "../reports/ReportBadge";

const MAX_VISIBLE_TAGS = 3;

interface TransactionCardProps {
  transaction: Transaction;
  isSelected: boolean;
  onClick: () => void;
  /**
   * Resolved report summary for `transaction.report_id`. The parent page
   * passes a `reportsById` map down so every card reads from one
   * shared TanStack query instead of triggering N fetches.
   */
  report?: ReportSummary;
}

export function TransactionCard({
  transaction,
  isSelected,
  onClick,
  report,
}: TransactionCardProps) {
  const { sign, colorClass } = getTransactionType(
    transaction.transaction_type as "income" | "expense" | "ingreso" | "egreso"
  );
  const { translateCategory } = useTranslateCategory();
  const { formatShortDate } = useFormatDate();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [gmailConnections, setGmailConnections] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const checkConnections = async () => {
      if (user?.id) {
        const status = await gmailService.getConnectionStatus(user.id);
        if (!cancelled) setGmailConnections(status.total);
      }
    };
    checkConnections();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        onClick={onClick}
        className={`relative p-4 rounded-2xl transition-[color,background-color,border-color,box-shadow,opacity,transform] cursor-pointer shadow-sm hover:shadow-md ${
          isSelected ? "text-white" : "bg-white hover:bg-zinc-50"
        }`}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {isSelected && (
          <m.div
            layoutId="activeTransaction"
            className="absolute inset-0 bg-[var(--primary)] rounded-2xl shadow-md"
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        )}

        {/* Report badge — anchored to the card's top-right corner so it
            stays visible regardless of content length. z-10 keeps it
            above the active selection overlay. */}
        {report && (
          <div className="absolute top-2 right-2 z-10 pointer-events-none">
            <ReportBadge title={report.title} size="sm" />
          </div>
        )}

        <div className="relative flex items-center gap-4">
          {/* Content — pr-20 leaves room for the absolute report badge */}
          <div className="flex-1 min-w-0 pr-20">
            <h3
              className={`font-semibold truncate ${
                isSelected ? "text-white" : "text-[var(--text-primary)]"
              }`}
            >
              {transaction.name}
            </h3>
            <p
              className={`text-sm truncate ${
                isSelected ? "text-zinc-200" : "text-[var(--text-secondary)]"
              }`}
            >
              {translateCategory(transaction.category)} •{" "}
              {transaction.merchant || t("transactions.unknown")}
            </p>
            {transaction.tags && transaction.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {transaction.tags.slice(0, MAX_VISIBLE_TAGS).map(tag => (
                  <TagBadge
                    key={tag.id}
                    name={tag.name}
                    color={tag.color}
                    size="sm"
                  />
                ))}
                {transaction.tags.length > MAX_VISIBLE_TAGS && (
                  <span
                    className={`text-xs font-medium ${
                      isSelected ? "text-zinc-300" : "text-zinc-400"
                    }`}
                  >
                    +{transaction.tags.length - MAX_VISIBLE_TAGS}
                  </span>
                )}
              </div>
            )}
            <p
              className={`text-xs mt-0.5 ${
                isSelected ? "text-zinc-300" : "text-zinc-400"
              }`}
            >
              {formatShortDate(transaction.transaction_date)}
              {gmailConnections > 1 && transaction.recipient_email && (
                <> • {transaction.recipient_email}</>
              )}
            </p>
          </div>

          {/* Amount */}
          <div className="text-right shrink-0">
            <span className={`text-lg font-bold block ${colorClass}`}>
              {sign}
              {getCurrencySymbol(transaction.currency)}
              {transaction.amount}
            </span>
            <span
              className={`text-xs block ${
                isSelected ? "text-zinc-300" : "text-zinc-400"
              }`}
            >
              {transaction.currency}
            </span>
          </div>
        </div>
      </m.div>
    </LazyMotion>
  );
}
